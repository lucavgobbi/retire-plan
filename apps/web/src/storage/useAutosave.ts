import { useCallback, useEffect, useRef, useState } from "react";
import type { Workspace } from "../domain/types";
import { storage, type StorageProvider } from "./db";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";
export interface AutosaveOptions { storage?: StorageProvider; delayMs?: number }
export interface AutosaveResult {
  status: AutosaveStatus;
  error: string | null;
  saveNow: () => void;
  /** True only when this exact editing snapshot has completed persistence. */
  isCurrentSaved: boolean;
}
type Listener = (paused: boolean, replacement?: Workspace) => void;
const listeners = new WeakMap<StorageProvider, Set<Listener>>();

/** Cancel pending autosaves before a destructive operation and drain started ones
 * through the provider queue. Successful replacements stay gated until React
 * renders that workspace, so a pre-dispatch timer cannot enqueue the old state. */
export function suspendAutosave(provider: StorageProvider): (replacement?: Workspace) => void {
  for (const listener of listeners.get(provider) ?? []) listener(true);
  return (replacement) => {
    for (const listener of listeners.get(provider) ?? []) listener(false, replacement);
  };
}

export function useAutosave(workspace: Workspace, options: AutosaveOptions = {}): AutosaveResult {
  const provider = options.storage ?? storage;
  const delayMs = options.delayMs ?? 800;
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paused = useRef(false);
  const expectedJson = useRef<string | null>(null);
  const completedJson = useRef<string | null>(null);
  const enqueuedJson = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener: Listener = (suspended, replacement) => {
      paused.current = suspended;
      generation.current += 1;
      enqueuedJson.current = null;
      if (timer.current !== null) clearTimeout(timer.current);
      if (!suspended) {
        expectedJson.current = replacement ? JSON.stringify(replacement) : null;
        completedJson.current = replacement ? JSON.stringify(replacement) : null;
        setStatus(replacement ? "saved" : "idle");
        if (replacement) setError(null);
        setRevision((value) => value + 1);
      }
    };
    const registered = listeners.get(provider) ?? new Set<Listener>();
    registered.add(listener);
    listeners.set(provider, registered);
    return () => {
      mounted.current = false;
      registered.delete(listener);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [provider]);

  const requestSave = useCallback(() => {
    const ws = workspaceRef.current;
    const serialized = JSON.stringify(ws);
    if (paused.current || (expectedJson.current !== null && serialized !== expectedJson.current)) return;
    expectedJson.current = null;
    if (serialized === completedJson.current || serialized === enqueuedJson.current) return;
    const request = ++generation.current;
    enqueuedJson.current = serialized;
    setStatus("saving");
    void provider.save(ws).then(() => {
      if (!mounted.current || generation.current !== request) return;
      completedJson.current = serialized;
      enqueuedJson.current = null;
      setError(null);
      setStatus("saved");
      // Fast providers can batch saving→saved into the existing saved state;
      // render the newly confirmed snapshot even when the status string repeats.
      setRevision(value => value + 1);
    }).catch((cause: unknown) => {
      if (!mounted.current || generation.current !== request) return;
      enqueuedJson.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    });
  }, [provider]);

  useEffect(() => {
    const serialized = JSON.stringify(workspace);
    if (expectedJson.current === serialized) expectedJson.current = null;
    if (paused.current || expectedJson.current !== null || completedJson.current === serialized || enqueuedJson.current === serialized) return;
    timer.current = setTimeout(requestSave, delayMs);
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [workspace, delayMs, requestSave, revision]);

  const saveNow = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    requestSave();
  }, [requestSave]);
  const isCurrentSaved = !paused.current && status === "saved" && completedJson.current === JSON.stringify(workspace);
  return { status, error, saveNow, isCurrentSaved };
}
