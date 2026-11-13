import type { Plan, Scenario } from "@retire-plan/engine";
import type { RunOutcome } from "../domain/run";

export type SimulationWorkerRequest = {
  type: "run";
  requestId: number;
  plan: Plan;
  scenario: Scenario;
};

export type SimulationWorkerResponse =
  | { type: "result"; requestId: number; outcome: RunOutcome }
  | { type: "error"; requestId: number; message: string };

export interface SimulationWorkerPort {
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: SimulationWorkerRequest): void;
  terminate(): void;
}

export type SimulationRunner = (
  plan: Plan,
  scenario: Scenario,
  signal?: AbortSignal,
) => Promise<RunOutcome>;
