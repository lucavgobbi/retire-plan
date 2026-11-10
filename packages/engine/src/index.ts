// RetirePlan simulation engine — pure TypeScript, zero runtime dependencies.
// The engine never touches DOM, network, or storage.
export * from "./types";
export { simulate } from "./simulate";
export { buildDeterministicReturns } from "./returns/deterministic";
export { runMonteCarlo } from "./returns/montecarlo";
export { seededRandom } from "./returns/seededRandom";
export { loadTables, applyIndexation, type TaxYearTables } from "./tax/tables";
