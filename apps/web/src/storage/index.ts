/** Lane B public contract. Lanes import storage services, types, and autosave here. */
export { SCHEMA_VERSION, validateWorkspace } from "./schema";
export { migratePlanFile, migrateWorkspaceRow } from "./migrations";
export {
  buildPlanFile,
  parsePlanFile,
  planFileToText,
  workspaceToText,
} from "./exportImport";
export {
  storage,
  startFresh,
  createStorageProvider,
  DB_NAME,
  DB_VERSION,
} from "./db";
export type { LoadOutcome, RecoveryOutcome, LoadResult, StorageProvider, RowDb } from "./core";
export { createMemoryStorageProvider } from "./memory";
export { useAutosave, type AutosaveStatus, type AutosaveOptions, type AutosaveResult } from "./useAutosave";
