// Mask an email address for safe logging.
//
// Keeps the first character of the local part + the full domain so support
// can still correlate a log line with a specific mailbox, while never
// writing the raw address to a log store.
//
// Examples:
//   alice@example.com        → a***@example.com
//   a@example.com            → a***@example.com
//   Alice.Smith+tag@X.co     → A***@X.co
//   ""                       → ***
//   "not-an-email"           → ***
export function maskEmail(input: string | null | undefined): string {
  if (typeof input !== 'string') return '***'
  const trimmed = input.trim()
  if (!trimmed) return '***'
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return '***'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  // A domain must contain at least one dot (e.g. `example.com`).
  if (!domain.includes('.')) return '***'
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}
