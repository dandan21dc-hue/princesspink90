/**
 * Shared stale-badge computation for compliance documents.
 *
 * A document is considered STALE (i.e. still needs re-acknowledgement /
 * re-upload under the current policy) only when both:
 *   1. It was uploaded under a policy version that is not the current one, AND
 *   2. No agreement has yet been recorded against the current policy for the
 *      context we care about (the doc's event, or the user globally).
 *
 * `current_agreement_accepted_at` on a per-document row (from
 * `listMyComplianceDocuments`) or an event-scoped `hasAgreedToCurrent` boolean
 * (from the event editor's `listMyPolicyAgreements` query) both satisfy (2).
 */
export interface StaleInput {
  /** Policy version id the document was uploaded under. */
  docPolicyVersionId: string | null | undefined;
  /** Current active policy version id. */
  currentPolicyVersionId: string | null | undefined;
  /**
   * Truthy when the user has already re-acknowledged the current policy for
   * the relevant context (event or global). Accepts a boolean or a timestamp
   * string so callers can pass either shape verbatim.
   */
  reAcknowledged?: boolean | string | null;
}

export function isDocumentStale(input: StaleInput): boolean {
  const { docPolicyVersionId, currentPolicyVersionId, reAcknowledged } = input;
  if (!docPolicyVersionId || !currentPolicyVersionId) return false;
  if (docPolicyVersionId === currentPolicyVersionId) return false;
  if (reAcknowledged) return false;
  return true;
}
