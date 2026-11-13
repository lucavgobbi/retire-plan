// RetirePlan simulation engine — pure TypeScript, zero runtime dependencies.
// The engine never touches DOM, network, or storage.
export * from "./types";
export { simulate } from "./simulate";
export { planWithdrawalPolicy, type PlannerOutput } from "./strategy/withdrawalPlanner";
export { buildDeterministicReturns } from "./returns/deterministic";
export { runMonteCarlo } from "./returns/montecarlo";
export { buildHistoricalReturns, runHistorical, type HistoricalReturnObservation, type HistoricalSummary } from "./returns/historical";
export { HISTORICAL_DATASET, HISTORICAL_OBSERVATIONS } from "./returns/historicalDataset";
export { seededRandom } from "./returns/seededRandom";
export { loadTables, applyIndexation, type TaxYearTables } from "./tax/tables";
