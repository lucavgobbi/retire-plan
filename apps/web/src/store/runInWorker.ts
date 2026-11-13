import type { Plan, Scenario } from "@retire-plan/engine";
import type { RunOutcome } from "../domain/run";
import type { SimulationRunner, SimulationWorkerPort, SimulationWorkerResponse } from "./simulationWorkerProtocol";

export type SimulationWorkerFactory = () => SimulationWorkerPort;

const createSimulationWorker: SimulationWorkerFactory = () =>
  new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" }) as unknown as SimulationWorkerPort;

/** Runs one scenario in an isolated worker; aborting terminates its computation. */
export function createWorkerSimulationRunner(
  workerFactory: SimulationWorkerFactory = createSimulationWorker,
): SimulationRunner {
  let nextRequestId = 1;
  return (plan: Plan, scenario: Scenario, signal?: AbortSignal): Promise<RunOutcome> => {
    if (signal?.aborted) return Promise.reject(abortError());
    if (typeof Worker === "undefined" && workerFactory === createSimulationWorker) {
      return Promise.reject(new Error("Projection workers are not supported in this browser."));
    }

    return new Promise((resolve, reject) => {
      const worker = workerFactory();
      const requestId = nextRequestId++;
      let settled = false;
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = () => finish(() => reject(abortError()));
      worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== requestId) return;
        if (response.type === "result") finish(() => resolve(response.outcome));
        else finish(() => reject(new Error(response.message)));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(() => reject(new Error(event.message || "The projection worker failed.")));
      };
      worker.onmessageerror = () => finish(() => reject(new Error("The projection worker returned an unreadable response.")));
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        worker.postMessage({ type: "run", requestId, plan, scenario });
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error("The projection could not be sent to the worker.")));
      }
    });
  };
}

export const runScenarioInWorker = createWorkerSimulationRunner();

function abortError(): Error {
  const error = new Error("Projection cancelled.");
  error.name = "AbortError";
  return error;
}
