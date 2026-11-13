import type { Plan, Scenario } from "@retire-plan/engine";
import { describe, expect, it } from "vitest";
import type { RunOutcome } from "../domain/run";
import { createWorkerSimulationRunner } from "./runInWorker";
import type { SimulationWorkerPort, SimulationWorkerRequest, SimulationWorkerResponse } from "./simulationWorkerProtocol";

class FakeWorker implements SimulationWorkerPort {
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  request: SimulationWorkerRequest | null = null;
  terminated = 0;
  postMessage(message: SimulationWorkerRequest) { this.request = message; }
  terminate() { this.terminated += 1; }
  respond(data: SimulationWorkerResponse) { this.onmessage?.({ data } as MessageEvent<SimulationWorkerResponse>); }
}

const plan = {} as Plan;
const scenario = {} as Scenario;
const outcome = { result: { years: [], summary: { success: true, finalNetWorth: 0 } } } as RunOutcome;

describe("worker simulation runner", () => {
  it("ignores stale request IDs and resolves a matching response, terminating the worker", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSimulationRunner(() => worker);
    const pending = runner(plan, scenario);
    expect(worker.request).toMatchObject({ type: "run", requestId: 1, plan, scenario });
    worker.respond({ type: "result", requestId: 0, outcome });
    worker.respond({ type: "result", requestId: 1, outcome });
    await expect(pending).resolves.toBe(outcome);
    expect(worker.terminated).toBe(1);
    expect(worker.onmessage).toBeNull();
  });

  it("rejects worker errors and always terminates", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSimulationRunner(() => worker);
    const pending = runner(plan, scenario);
    worker.respond({ type: "error", requestId: 1, message: "simulation failed" });
    await expect(pending).rejects.toThrow("simulation failed");
    expect(worker.terminated).toBe(1);
  });

  it("aborts by terminating the worker and ignores any late result", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const runner = createWorkerSimulationRunner(() => worker);
    const pending = runner(plan, scenario, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    worker.respond({ type: "result", requestId: 1, outcome });
    expect(worker.terminated).toBe(1);
  });

  it("rejects a worker runtime failure", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerSimulationRunner(() => worker);
    const pending = runner(plan, scenario);
    worker.onerror?.({ message: "worker crashed", preventDefault() {} } as ErrorEvent);
    await expect(pending).rejects.toThrow("worker crashed");
    expect(worker.terminated).toBe(1);
  });
});
