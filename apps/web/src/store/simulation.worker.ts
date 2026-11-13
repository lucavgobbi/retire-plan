/// <reference lib="webworker" />
import { runScenario } from "../domain/run";
import type { SimulationWorkerRequest, SimulationWorkerResponse } from "./simulationWorkerProtocol";

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "run") return;
  try {
    const outcome = runScenario(request.plan, request.scenario);
    const response: SimulationWorkerResponse = { type: "result", requestId: request.requestId, outcome };
    scope.postMessage(response);
  } catch (error) {
    const response: SimulationWorkerResponse = {
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "The projection could not run.",
    };
    scope.postMessage(response);
  }
};
