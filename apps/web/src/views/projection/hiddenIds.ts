/**
 * Normalizes a stored hidden-id selection (columns or charts) against the known
 * ids: unknown or stale ids are dropped, duplicates removed, canonical order
 * enforced. Returns null when the value is absent/invalid — meaning the default
 * "everything visible" (also the backward-compatible default for old saved or
 * exported JSON). An empty result means every selectable id is hidden; pinned
 * or essential items still render.
 */
export function sanitizeHiddenIds(value: unknown, knownIds: readonly string[]): string[] | null {
  if (!Array.isArray(value)) return null;
  const wanted = new Set(value.filter((id): id is string => typeof id === "string" && knownIds.includes(id)));
  return knownIds.filter(id => wanted.has(id));
}
