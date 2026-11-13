import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { runScenario } from "./domain/run";
import type { SimulationWorkerPort, SimulationWorkerRequest, SimulationWorkerResponse } from "./store/simulationWorkerProtocol";

/** Test-only Worker shim: executes the real runner behind the production message boundary. */
class TestSimulationWorker implements SimulationWorkerPort {
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private terminated = false;
  postMessage(request: SimulationWorkerRequest) {
    queueMicrotask(() => {
      if (this.terminated) return;
      try {
        const outcome = runScenario(request.plan, request.scenario);
        this.onmessage?.({ data: { type: "result", requestId: request.requestId, outcome } } as MessageEvent<SimulationWorkerResponse>);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The projection could not run.";
        this.onmessage?.({ data: { type: "error", requestId: request.requestId, message } } as MessageEvent<SimulationWorkerResponse>);
      }
    });
  }
  terminate() { this.terminated = true; }
}

globalThis.Worker = TestSimulationWorker as unknown as typeof Worker;
afterEach(cleanup);
