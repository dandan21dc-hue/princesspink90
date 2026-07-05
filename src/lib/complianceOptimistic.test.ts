/**
 * Integration tests for the compliance re-acknowledge optimistic-update flow.
 *
 * We assert the observable contract the UI depends on:
 *   1. Immediately after `onMutate`, `isDocumentStale` flips to `false`
 *      for the affected event and `current_agreement_accepted_at` is set —
 *      no server round-trip required.
 *   2. On mutation error, the cache rolls back to the pre-mutation snapshot,
 *      so the stale badge and timestamp return to their prior values.
 *   3. On mutation success, once the reconcile refetch resolves, the cache
 *      reflects the SERVER truth (not the optimistic ISO), and the stale
 *      badge stays cleared.
 *   4. Unrelated events in the same list are never touched.
 *
 * The mutation logic in `src/routes/compliance.tsx` is inlined into the route
 * (it's tightly coupled to `useServerFn` / route hooks), so these tests
 * exercise the SAME optimistic-patch shape via a local QueryClient — the
 * contract the UI reads is what matters, not the transport wrapper.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { isDocumentStale } from "./complianceStale";

type DocRow = {
  id: string;
  event_id: string | null;
  file_name: string;
  policy_version_id: string | null;
  policy_version_label: string | null;
  current_policy_version_id: string | null;
  current_policy_version_label: string | null;
  current_agreement_accepted_at: string | null;
  current_agreement_accepted_by_display_name: string | null;
  uploaded_by_display_name: string | null;
};

const DOCS_KEY = ["my-compliance-documents"] as const;
const CURRENT_VERSION_ID = "v2";
const CURRENT_VERSION_LABEL = "2.0";

function makeDoc(overrides: Partial<DocRow> & Pick<DocRow, "id" | "event_id">): DocRow {
  return {
    file_name: "waiver.pdf",
    policy_version_id: "v1",
    policy_version_label: "1.0",
    current_policy_version_id: CURRENT_VERSION_ID,
    current_policy_version_label: CURRENT_VERSION_LABEL,
    current_agreement_accepted_at: null,
    current_agreement_accepted_by_display_name: null,
    uploaded_by_display_name: "Alice",
    ...overrides,
  };
}

function staleFor(row: DocRow): boolean {
  return isDocumentStale({
    docPolicyVersionId: row.policy_version_id,
    currentPolicyVersionId: row.current_policy_version_id,
    reAcknowledged: row.current_agreement_accepted_at,
  });
}

/**
 * Mirrors the `onMutate` patch in `reAck` — same shape, same fields.
 * Returns the pre-mutation snapshot so `rollback` can restore it verbatim.
 */
function applyOptimisticReAck(
  qc: QueryClient,
  vars: { policy_version_id: string; event_id: string | null },
  currentLabel: string | null,
  nowIso: string,
) {
  const previous = qc.getQueryData<DocRow[]>(DOCS_KEY);
  if (previous) {
    qc.setQueryData<DocRow[]>(
      DOCS_KEY,
      previous.map((row) =>
        row.event_id === vars.event_id
          ? {
              ...row,
              current_policy_version_id: vars.policy_version_id,
              current_policy_version_label:
                row.current_policy_version_label ?? currentLabel,
              current_agreement_accepted_at: nowIso,
              current_agreement_accepted_by_display_name:
                row.current_agreement_accepted_by_display_name ??
                row.uploaded_by_display_name ??
                null,
            }
          : row,
      ),
    );
  }
  return { previous };
}

function rollback(qc: QueryClient, previous: DocRow[] | undefined) {
  if (previous) qc.setQueryData(DOCS_KEY, previous);
}

describe("compliance re-acknowledge optimistic flow", () => {
  let qc: QueryClient;
  let target: DocRow;
  let other: DocRow;

  beforeEach(() => {
    qc = new QueryClient();
    target = makeDoc({ id: "doc-1", event_id: "evt-A" });
    other = makeDoc({ id: "doc-2", event_id: "evt-B" });
    qc.setQueryData<DocRow[]>(DOCS_KEY, [target, other]);
  });

  it("flips the stale badge and sets the timestamp instantly on onMutate", () => {
    const before = qc.getQueryData<DocRow[]>(DOCS_KEY)!;
    expect(staleFor(before[0])).toBe(true);
    expect(before[0].current_agreement_accepted_at).toBeNull();

    const nowIso = "2026-07-05T12:00:00.000Z";
    applyOptimisticReAck(
      qc,
      { policy_version_id: CURRENT_VERSION_ID, event_id: "evt-A" },
      CURRENT_VERSION_LABEL,
      nowIso,
    );

    const after = qc.getQueryData<DocRow[]>(DOCS_KEY)!;
    expect(staleFor(after[0])).toBe(false);
    expect(after[0].current_agreement_accepted_at).toBe(nowIso);
    // Unrelated event is untouched.
    expect(after[1]).toEqual(other);
    expect(staleFor(after[1])).toBe(true);
  });

  it("rolls back to the previous snapshot when the mutation errors", () => {
    const ctx = applyOptimisticReAck(
      qc,
      { policy_version_id: CURRENT_VERSION_ID, event_id: "evt-A" },
      CURRENT_VERSION_LABEL,
      "2026-07-05T12:00:00.000Z",
    );
    // Optimistic patch is live.
    expect(staleFor(qc.getQueryData<DocRow[]>(DOCS_KEY)![0])).toBe(false);

    // Server fails — restore snapshot.
    rollback(qc, ctx.previous);

    const restored = qc.getQueryData<DocRow[]>(DOCS_KEY)!;
    expect(restored[0]).toEqual(target);
    expect(staleFor(restored[0])).toBe(true);
    expect(restored[0].current_agreement_accepted_at).toBeNull();
    expect(restored[1]).toEqual(other);
  });

  it("reconciles to server truth after refetch on success", async () => {
    const optimisticIso = "2026-07-05T12:00:00.000Z";
    applyOptimisticReAck(
      qc,
      { policy_version_id: CURRENT_VERSION_ID, event_id: "evt-A" },
      CURRENT_VERSION_LABEL,
      optimisticIso,
    );
    // Optimistic state is visible immediately.
    expect(qc.getQueryData<DocRow[]>(DOCS_KEY)![0].current_agreement_accepted_at).toBe(
      optimisticIso,
    );

    // Server persists at a different (authoritative) timestamp — the refetch
    // must overwrite the optimistic ISO with the real one, not merge them.
    const serverIso = "2026-07-05T12:00:00.500Z";
    const serverName = "Alice Server";
    const refetched: DocRow[] = [
      {
        ...target,
        current_agreement_accepted_at: serverIso,
        current_agreement_accepted_by_display_name: serverName,
      },
      other,
    ];

    // Simulate `reconcileAgreementCaches` -> invalidate + refetch. This test's
    // QueryClient has no mounted observers, so we drive the refetch directly
    // via `fetchQuery` with `staleTime: 0` to guarantee the queryFn runs and
    // overwrites the optimistic cache with server truth.
    await qc.fetchQuery({
      queryKey: DOCS_KEY,
      queryFn: async () => refetched,
      staleTime: 0,
    });

    const reconciled = qc.getQueryData<DocRow[]>(DOCS_KEY)!;
    expect(reconciled[0].current_agreement_accepted_at).toBe(serverIso);
    expect(reconciled[0].current_agreement_accepted_by_display_name).toBe(serverName);
    // Stale badge stays cleared because the server confirmed the agreement.
    expect(staleFor(reconciled[0])).toBe(false);
    // Sibling row is still untouched.
    expect(reconciled[1]).toEqual(other);
  });

  it("keeps sibling rows stale when only one event is re-acknowledged", () => {
    applyOptimisticReAck(
      qc,
      { policy_version_id: CURRENT_VERSION_ID, event_id: "evt-A" },
      CURRENT_VERSION_LABEL,
      "2026-07-05T12:00:00.000Z",
    );
    const after = qc.getQueryData<DocRow[]>(DOCS_KEY)!;
    expect(staleFor(after[0])).toBe(false);
    expect(staleFor(after[1])).toBe(true);
  });

  it("preserves a pre-existing accepted_by display name over the fallback", () => {
    // Row already has a server-assigned display name; optimistic patch must
    // not clobber it with the uploader fallback.
    const withName: DocRow = {
      ...target,
      current_agreement_accepted_by_display_name: "Server Name",
    };
    qc.setQueryData<DocRow[]>(DOCS_KEY, [withName, other]);
    applyOptimisticReAck(
      qc,
      { policy_version_id: CURRENT_VERSION_ID, event_id: "evt-A" },
      CURRENT_VERSION_LABEL,
      "2026-07-05T12:00:00.000Z",
    );
    const after = qc.getQueryData<DocRow[]>(DOCS_KEY)!;
    expect(after[0].current_agreement_accepted_by_display_name).toBe("Server Name");
  });
});
