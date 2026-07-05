/**
 * Shared normalization for `rsvps.entry_phrase`.
 *
 * Mirrors the semantics of the `rsvps_assign_entry_phrase` BEFORE INSERT
 * trigger so client-facing writes never persist a blank/whitespace-only
 * value: the trigger only fills in a phrase when the incoming value IS
 * NULL or `btrim(...) = ''`. Server code that accepts an entry_phrase
 * from user input MUST run it through this helper before writing.
 *
 *   - `null` / `undefined` → `null`
 *   - `''` / `'   '` / any whitespace-only string → `null`
 *   - otherwise → the trimmed string
 */
export function normalizeEntryPhrase(
  input: string | null | undefined,
): string | null {
  if (input == null) return null
  const trimmed = String(input).trim()
  return trimmed.length === 0 ? null : trimmed
}
