import { createFileRoute } from "@tanstack/react-router";
import { verifyNowPaymentsSignature } from "@/lib/nowpayments.server";

/**
 * NOWPayments IPN webhook.
 *
 * URL: /api/public/payments/nowpayments-webhook
 *   (Configure this exact URL in NOWPayments dashboard → Store Settings → IPN callback URL.)
 *
 * Security:
 *  - `/api/public/*` bypasses Lovable's published-site auth, so security is enforced here by
 *    verifying the `x-nowpayments-sig` header (HMAC-SHA512 over the JSON body with keys
 *    sorted alphabetically, using NOWPAYMENTS_IPN_SECRET). Anything unverified is rejected.
 *  - Entitlements are only granted when `payment_status === "finished"`.
 *  - Idempotency lives in the database function (`grant_all_access_pass_30d`): the
 *    NOWPayments `payment_id` is stored as `external_payment_reference` with a unique
 *    constraint, so a webhook redelivered twice grants the pass only once.
 *
 * Order ID contract (set when creating the invoice, see nowpayments.functions.ts):
 *   All-Access Pass:  aap30d:<userId>:<sandbox|live>:<amountCents>
 * Anything else is logged and acknowledged (200) so NOWPayments stops retrying it.
 */

type NowPaymentsIpn = {
  payment_id?: number | string;
  payment_status?: string;
  order_id?: string;
  order_description?: string;
  price_amount?: number | string;
  price_currency?: string;
  pay_amount?: number | string;
  pay_currency?: string;
  actually_paid?: number | string;
  purchase_id?: string;
  [k: string]: unknown;
};


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParsedOrder =
  | { kind: "aap30d"; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | { kind: "aap90d"; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | { kind: "aap180d"; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | { kind: "aap365d"; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | { kind: "lifetime"; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | {
      kind: "panty";
      pantyListingId: string;
      userId: string;
      environment: "sandbox" | "live";
      amountCents: number;
      pointsApplied?: number;
    }
  | {
      kind: "booking";
      bookingId: string;
      userId: string;
      environment: "sandbox" | "live";
      amountCents: number;
    };

const TIME_PASS_KINDS = new Set(["aap30d", "aap90d", "aap180d", "aap365d", "lifetime"]);

function parseEnv(v: string): "sandbox" | "live" | null {
  return v === "sandbox" || v === "live" ? v : null;
}

function parseAmount(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

function parsePointsSuffix(v: string): number | null {
  const m = /^p(\d+)$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

export function parseOrderId(orderId: string | undefined): ParsedOrder | null {
  if (!orderId) return null;
  const parts = orderId.split(":");

  // aap30d / lifetime — 4 parts: <kind>:<userId>:<env>:<amountCents>
  if (parts.length === 4) {
    const [kind, userId, envRaw, amountRaw] = parts;
    if (!TIME_PASS_KINDS.has(kind)) return null;
    if (!UUID_RE.test(userId)) return null;
    const environment = parseEnv(envRaw);
    if (!environment) return null;
    const amountCents = parseAmount(amountRaw);
    if (amountCents == null) return null;
    return { kind: kind as "aap30d" | "aap90d" | "aap180d" | "aap365d" | "lifetime", userId, environment, amountCents };
  }

  // panty / booking — 5 parts: <kind>:<uuid>:<userId>:<env>:<amountCents>
  // panty with reward-point discount — 6 parts, trailing `p<N>` suffix.
  if (parts.length === 5 || parts.length === 6) {
    const [kind, entityId, userId, envRaw, amountRaw, ptsRaw] = parts;
    if (kind !== "panty" && kind !== "booking") return null;
    if (parts.length === 6 && kind !== "panty") return null;
    if (!UUID_RE.test(entityId) || !UUID_RE.test(userId)) return null;
    const environment = parseEnv(envRaw);
    if (!environment) return null;
    const amountCents = parseAmount(amountRaw);
    if (amountCents == null) return null;
    if (kind === "panty") {
      let pointsApplied: number | undefined;
      if (parts.length === 6) {
        const pts = parsePointsSuffix(ptsRaw);
        if (pts == null) return null;
        pointsApplied = pts;
      }
      return {
        kind: "panty",
        pantyListingId: entityId,
        userId,
        environment,
        amountCents,
        ...(pointsApplied != null ? { pointsApplied } : {}),
      };
    }
    return { kind: "booking", bookingId: entityId, userId, environment, amountCents };
  }

  return null;
}

async function raiseAlert(
  supabaseAdmin: { from: (t: string) => any },
  args: {
    severity: "info" | "warning" | "critical";
    kind: string;
    detail: Record<string, unknown>;
    throttleWindowMinutes?: number;
  },
): Promise<void> {
  try {
    if (args.throttleWindowMinutes && args.throttleWindowMinutes > 0) {
      const since = new Date(Date.now() - args.throttleWindowMinutes * 60_000).toISOString();
      const { data: recent } = await supabaseAdmin
        .from("admin_activity_audit_alerts")
        .select("id")
        .eq("kind", args.kind)
        .gte("detected_at", since)
        .limit(1);
      if (recent && recent.length > 0) return;
    }
    await supabaseAdmin
      .from("admin_activity_audit_alerts")
      .insert({
        severity: args.severity,
        kind: args.kind,
        detail: args.detail,
      });
  } catch (e) {
    // Never let alert failures break webhook processing.
    console.warn("nowpayments alert insert failed:", e);
  }
}

const MEMBERSHIP_LABELS: Record<string, string> = {
  term_pass_all_access_30d: "30-day All-Access Pass",
  term_pass_3: "3-month All-Access Pass",
  term_pass_6: "6-month All-Access Pass",
  term_pass_12: "12-month All-Access Pass",
  lifetime: "Lifetime All-Access Pass",
};

function membershipLabel(kind: string | null | undefined): string {
  if (!kind) return "All-Access Pass";
  return MEMBERSHIP_LABELS[kind] ?? "All-Access Pass";
}

function reasonLabel(status: string): string {
  if (status === "chargeback") return "Payment dispute (chargeback)";
  if (status === "disputed" || status === "dispute") return "Payment dispute";
  if (status === "reversed") return "Payment reversed";
  return "Payment refunded";
}

/**
 * Notify each end-user whose All-Access membership was revoked/suspended by a
 * NOWPayments reversal callback: writes an in-app notification and enqueues an
 * email. Best-effort — failures are logged but never rethrown so the webhook
 * itself always finalizes.
 */
async function notifyAffectedMembers(
  supabaseAdmin: any,
  args: {
    affected: Array<Record<string, unknown>>;
    mode: "revoked" | "suspended";
    status: string;
    paymentId: string;
  },
): Promise<void> {
  const memberships = args.affected.filter(
    (a) => a?.kind === "membership" && typeof a.user_id === "string",
  );
  if (memberships.length === 0) return;

  const { enqueueTemplateEmail } = await import("@/lib/email/enqueue.server");
  const origin =
    process.env.PUBLIC_SITE_URL ??
    process.env.VITE_PUBLIC_SITE_URL ??
    "https://princesspink90.com";
  const reason = reasonLabel(args.status);
  const effective = new Date().toISOString().slice(0, 10);
  const title =
    args.mode === "revoked"
      ? "All-Access Pass revoked"
      : "All-Access Pass suspended";

  for (const m of memberships) {
    const userId = m.user_id as string;
    const label = membershipLabel(m.membership_kind as string | undefined);
    const body =
      args.mode === "revoked"
        ? `Your ${label} has been revoked (${reason.toLowerCase()}).`
        : `Your ${label} has been suspended pending resolution of a payment dispute.`;

    try {
      await supabaseAdmin.from("notifications").insert({
        user_id: userId,
        kind: `all_access_${args.mode}`,
        title,
        body,
        link_url: "/account",
        metadata: {
          payment_id: args.paymentId,
          status: args.status,
          mode: args.mode,
          membership_id: m.id ?? null,
          membership_kind: m.membership_kind ?? null,
        },
      });
    } catch (e) {
      console.warn("notifyAffectedMembers: notification insert failed", e);
    }

    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
      const email = userData?.user?.email as string | undefined;
      if (!email) continue;
      const displayName =
        (userData?.user?.user_metadata as { name?: string; full_name?: string } | undefined)
          ?.name ??
        (userData?.user?.user_metadata as { full_name?: string } | undefined)?.full_name ??
        undefined;
      await enqueueTemplateEmail({
        templateName: "all-access-revoked",
        recipientEmail: email,
        idempotencyKey: `aap-${args.mode}-${args.paymentId}-${m.id ?? userId}`,
        templateData: {
          name: displayName,
          mode: args.mode,
          reasonLabel: reason,
          membershipLabel: label,
          effectiveDateLabel: effective,
          supportUrl: `mailto:support@princesspink90.com`,
          dashboardUrl: `${origin}/account`,
        },
      });
    } catch (e) {
      console.warn("notifyAffectedMembers: email enqueue failed", e);
    }
  }
}


export async function processIpn(event: NowPaymentsIpn): Promise<{ handled: boolean; reason?: string; duplicate?: boolean }> {
  const status = String(event.payment_status ?? "").toLowerCase();
  const paymentIdRaw = event.payment_id != null ? String(event.payment_id) : null;

  if (!paymentIdRaw) {
    return { handled: false, reason: "missing_payment_id" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const statusKey = status || "unknown";


  // Ledger-first idempotency: composite PK (payment_id, last_status) records
  // every distinct status transition once. A redelivery of the SAME status
  // returns the original outcome without re-invoking any grant path; a new
  // status for the same payment (waiting → confirming → finished) is a fresh
  // row and processes normally. This defeats concurrent retries racing past
  // the per-RPC external_payment_reference check.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("nowpayments_ipn_events")
    .insert({
      payment_id: paymentIdRaw,
      last_status: statusKey,
      order_id: event.order_id ?? null,
      payload: event as unknown as never,
    })
    .select("payment_id")
    .maybeSingle();

  const duplicateCode = insertErr && (insertErr as { code?: string }).code === "23505";
  if (!inserted || duplicateCode) {
    if (insertErr && !duplicateCode) {
      throw new Error(`ipn ledger insert failed: ${insertErr.message}`);
    }
    // Same (payment_id, status) already recorded — return prior outcome.
    const { data: prior } = await supabaseAdmin
      .from("nowpayments_ipn_events")
      .select("handled, reason, received_count")
      .eq("payment_id", paymentIdRaw)
      .eq("last_status", statusKey)
      .maybeSingle();
    await supabaseAdmin
      .from("nowpayments_ipn_events")
      .update({
        last_seen_at: new Date().toISOString(),
        received_count: (prior?.received_count ?? 1) + 1,
      })
      .eq("payment_id", paymentIdRaw)
      .eq("last_status", statusKey);
    return {
      handled: Boolean(prior?.handled),
      reason: prior?.reason ?? "duplicate_ipn",
      duplicate: true,
    };
  }

  const awardPurchasePoints = async (
    userId: string,
    amountCents: number,
    source: string,
  ) => {
    try {
      const { error: pointsErr } = await supabaseAdmin.rpc(
        "grant_purchase_reward_points" as never,
        {
          _user_id: userId,
          _amount_cents: amountCents,
          _external_payment_reference: paymentRef,
          _source: source,
        } as never,
      );
      if (pointsErr) {
        console.warn(
          `[nowpayments] grant_purchase_reward_points failed source=${source} ref=${paymentRef}: ${pointsErr.message}`,
        );
      }
    } catch (e) {
      console.warn(
        `[nowpayments] grant_purchase_reward_points threw source=${source} ref=${paymentRef}:`,
        e,
      );
    }
  };

  const finalize = async (outcome: { handled: boolean; reason?: string }) => {
    await supabaseAdmin
      .from("nowpayments_ipn_events")
      .update({
        handled: outcome.handled,
        reason: outcome.reason ?? null,
        processed_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("payment_id", paymentIdRaw)
      .eq("last_status", statusKey);

    // Raise an admin alert whenever a signature-verified `finished` payment
    // fails to grant. This is the money-losing failure mode: the buyer paid
    // but did not get their entitlement. Naturally deduped per (payment_id,
    // status) by the ledger, so no throttle needed.
    if (status === "finished" && !outcome.handled) {
      await raiseAlert(supabaseAdmin, {
        severity: "critical",
        kind: "nowpayments_finished_ungranted",
        detail: {
          payment_id: paymentIdRaw,
          order_id: event.order_id ?? null,
          reason: outcome.reason ?? null,
          price_amount: event.price_amount ?? null,
          price_currency: event.price_currency ?? null,
          pay_amount: event.pay_amount ?? null,
          pay_currency: event.pay_currency ?? null,
          count: 1,
        },
      });
    }

    return outcome;
  };


  const paymentRef = `nowpayments:${paymentIdRaw}`;

  // Reversal statuses: revoke or suspend any entitlement previously granted
  // against this payment reference. NOWPayments crypto flows produce
  // `refunded`; some processor variants surface `chargeback`/`disputed`.
  // Refunds fully revoke; disputes suspend pending resolution.
  const REVOKE_STATUSES = new Set(["refunded", "refund", "reversed"]);
  const SUSPEND_STATUSES = new Set(["chargeback", "disputed", "dispute"]);
  const isRevoke = REVOKE_STATUSES.has(status);
  const isSuspend = SUSPEND_STATUSES.has(status);

  // Load the ledger history for this payment (all statuses OTHER than the row
  // we just inserted). We use this to enforce out-of-order rules deterministically
  // regardless of delivery order — the ledger, not wall-clock ordering, is the
  // source of truth.
  const { data: historyRows } = await supabaseAdmin
    .from("nowpayments_ipn_events")
    .select("last_status, handled, processed_at")
    .eq("payment_id", paymentIdRaw)
    .neq("last_status", statusKey);
  const history = (historyRows ?? []) as Array<{
    last_status: string;
    handled: boolean | null;
    processed_at: string | null;
  }>;
  const priorRevoke = history.find((h) => REVOKE_STATUSES.has(h.last_status));
  const priorSuspend = history.find((h) => SUSPEND_STATUSES.has(h.last_status));
  const priorFinished = history.find((h) => h.last_status === "finished");

  if (isRevoke || isSuspend) {
    const mode: "revoked" | "suspended" = isRevoke ? "revoked" : "suspended";

    // Out-of-order guard: once fully revoked, do NOT downgrade to suspended if
    // a stray chargeback/dispute callback arrives later. The refund is a
    // stronger, terminal action; suspending back would look like re-activation
    // to any UI that only reads `suspended_at`.
    if (mode === "suspended" && priorRevoke) {
      await raiseAlert(supabaseAdmin, {
        severity: "warning",
        kind: "nowpayments_suspend_after_revoke_ignored",
        detail: {
          payment_id: paymentIdRaw,
          order_id: event.order_id ?? null,
          incoming_status: status,
          prior_revoke_status: priorRevoke.last_status,
        },
      });
      return finalize({
        handled: true,
        reason: `ignored_suspend_after_revoke:${priorRevoke.last_status}`,
      });
    }

    // Idempotency guard: another reversal-alias of the SAME mode was already
    // applied (e.g. `refunded` then `reversed`). Re-running the RPC is safe
    // (revoked_at uses COALESCE, panty/booking updates carry status guards)
    // but reporting "affected" a second time is misleading. Short-circuit.
    const priorSameMode = mode === "revoked" ? priorRevoke : priorSuspend;
    if (priorSameMode) {
      return finalize({
        handled: true,
        reason: `duplicate_${mode}:${priorSameMode.last_status}`,
      });
    }

    const { data: revokeResult, error: revokeErr } = await supabaseAdmin.rpc(
      "revoke_entitlement_by_payment_reference",
      {
        _reference: paymentRef,
        _mode: mode,
        _reason: `nowpayments_${status}`,
      },
    );
    if (revokeErr) {
      throw new Error(`revoke_entitlement_by_payment_reference failed: ${revokeErr.message}`);
    }
    const affectedCount =
      (revokeResult as { affected_count?: number } | null)?.affected_count ?? 0;

    // Always alert admins on a reversal — even when no rows matched (which
    // usually means the payment never granted, but staff should still see it).
    await raiseAlert(supabaseAdmin, {
      severity: mode === "revoked" ? "warning" : "critical",
      kind: `nowpayments_${mode}`,
      detail: {
        payment_id: paymentIdRaw,
        order_id: event.order_id ?? null,
        status,
        mode,
        affected_count: affectedCount,
        affected: (revokeResult as { affected?: unknown } | null)?.affected ?? [],
        prior_finished: Boolean(priorFinished),
        upgraded_from_suspend: mode === "revoked" && Boolean(priorSuspend),
        price_amount: event.price_amount ?? null,
        price_currency: event.price_currency ?? null,
      },
    });

    // Notify each affected end-user (in-app + email). Idempotency key on the
    // email side ensures a redelivery — should one ever bypass the ledger
    // guard — doesn't spam the buyer twice.
    const affectedList = ((revokeResult as { affected?: unknown } | null)?.affected ?? []) as Array<
      Record<string, unknown>
    >;
    await notifyAffectedMembers(supabaseAdmin, {
      affected: affectedList,
      mode,
      status,
      paymentId: paymentIdRaw,
    });


    return finalize({
      handled: affectedCount > 0,
      reason: affectedCount > 0
        ? `${mode}:${affectedCount}_entitlement(s)`
        : `${mode}:no_matching_entitlement`,
    });
  }

  // Only grant entitlements on a confirmed, settled payment. All other statuses
  // (waiting, confirming, confirmed, sending, partially_paid, failed, expired)
  // are acknowledged with 200 so NOWPayments stops retrying, but grant nothing.
  if (status !== "finished") {
    return finalize({ handled: false, reason: `ignored_status:${status || "missing"}` });
  }

  // Out-of-order guard: a `finished` arriving AFTER a reversal must NOT
  // re-grant or re-activate access. This is the critical case for bookings,
  // whose grant path unconditionally sets status='confirmed' (the memberships
  // and panty-order RPCs already short-circuit on external_payment_reference
  // returning the existing revoked row, but the defence-in-depth check makes
  // the intent explicit and audits the refusal).
  const priorReversal = priorRevoke ?? priorSuspend;
  if (priorReversal) {
    await raiseAlert(supabaseAdmin, {
      severity: "critical",
      kind: "nowpayments_finished_after_reversal_refused",
      detail: {
        payment_id: paymentIdRaw,
        order_id: event.order_id ?? null,
        prior_reversal_status: priorReversal.last_status,
        prior_processed_at: priorReversal.processed_at,
      },
    });
    return finalize({
      handled: false,
      reason: `refused_finished_after_reversal:${priorReversal.last_status}`,
    });
  }

  const order = parseOrderId(event.order_id);
  if (!order) {
    return finalize({ handled: false, reason: "unrecognised_order_id" });
  }

  if (order.kind === "aap30d") {
    const { error } = await supabaseAdmin.rpc("grant_all_access_pass_30d", {
      _user_id: order.userId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
    });
    if (error) throw new Error(`grant_all_access_pass_30d failed: ${error.message}`);
    await awardPurchasePoints(order.userId, order.amountCents, "aap30d");
    return finalize({ handled: true });
  }

  if (order.kind === "aap90d" || order.kind === "aap180d" || order.kind === "aap365d") {
    const days = order.kind === "aap90d" ? 90 : order.kind === "aap180d" ? 180 : 365;
    const { error } = await supabaseAdmin.rpc("grant_all_access_pass_term" as any, {
      _user_id: order.userId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
      _days: days,
    });
    if (error) throw new Error(`grant_all_access_pass_term failed: ${error.message}`);
    await awardPurchasePoints(order.userId, order.amountCents, order.kind);
    return finalize({ handled: true });
  }

  if (order.kind === "lifetime") {
    const chargedAud = (order.amountCents / 100).toFixed(2);
    const priceAmount = event.price_amount != null ? String(event.price_amount) : null;
    const priceCurrency = event.price_currency ? String(event.price_currency).toLowerCase() : null;
    const payAmount = event.pay_amount != null ? String(event.pay_amount) : null;
    const payCurrency = event.pay_currency ? String(event.pay_currency).toLowerCase() : null;
    console.log(
      `[nowpayments] lifetime grant starting payment_id=${paymentIdRaw} user=${order.userId} env=${order.environment} charged=A$${chargedAud} (${order.amountCents}c) invoice_price=${priceAmount}${priceCurrency ?? ""} pay=${payAmount}${payCurrency ?? ""}`,
    );

    // AUD-amount sanity check: any mismatch between the invoice's AUD price
    // and the amount encoded in order_id (60000 c = A$600 for Lifetime) means
    // either the tier price changed mid-checkout or the order_id was crafted.
    if (priceAmount && priceCurrency === "aud") {
      const invoiceCents = Math.round(Number(priceAmount) * 100);
      if (Number.isFinite(invoiceCents) && invoiceCents !== order.amountCents) {
        console.warn(
          `[nowpayments] lifetime amount mismatch payment_id=${paymentIdRaw} order_id_cents=${order.amountCents} invoice_cents=${invoiceCents}`,
        );
        await raiseAlert(supabaseAdmin, {
          severity: "warning",
          kind: "nowpayments_lifetime_amount_mismatch",
          detail: {
            payment_id: paymentIdRaw,
            order_id: event.order_id ?? null,
            order_id_amount_cents: order.amountCents,
            invoice_price_cents: invoiceCents,
            price_amount: priceAmount,
            price_currency: priceCurrency,
          },
        });
      }
    }

    const { data: granted, error } = await supabaseAdmin.rpc("grant_lifetime_membership", {
      _user_id: order.userId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
    });
    if (error) {
      console.error(
        `[nowpayments] lifetime grant FAILED payment_id=${paymentIdRaw} user=${order.userId} charged=A$${chargedAud}: ${error.message}`,
      );
      throw new Error(`grant_lifetime_membership failed: ${error.message}`);
    }

    // The RPC returns the memberships row (new or existing/idempotent). Log
    // enough to distinguish a fresh grant from a replayed webhook, and to
    // confirm the amount stored on the row matches what the buyer paid.
    const row = (granted ?? null) as
      | { id?: string; user_id?: string; amount_cents?: number | null; expires_at?: string | null; created_at?: string; updated_at?: string; external_payment_reference?: string | null }
      | null;
    const idempotent = Boolean(
      row?.external_payment_reference && row.external_payment_reference !== paymentRef,
    );
    console.log(
      `[nowpayments] lifetime grant OK payment_id=${paymentIdRaw} user=${order.userId} charged=A$${chargedAud} membership_id=${row?.id ?? "?"} amount_cents=${row?.amount_cents ?? "?"} expires_at=${row?.expires_at ?? "never"} idempotent=${idempotent}`,
    );
    await awardPurchasePoints(order.userId, order.amountCents, "lifetime");
    return finalize({
      handled: true,
      reason: idempotent
        ? `lifetime_granted:idempotent:${row?.id ?? "unknown"}`
        : `lifetime_granted:${row?.id ?? "unknown"}:A$${chargedAud}`,
    });
  }

  if (order.kind === "panty") {
    const { error } = await supabaseAdmin.rpc("grant_panty_listing_order", {
      _user_id: order.userId,
      _panty_listing_id: order.pantyListingId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
    });
    if (error) throw new Error(`grant_panty_listing_order failed: ${error.message}`);
    // Deduct any reward points reserved for this order. Idempotent: the
    // RPC no-ops if the reservation was already consumed on a prior
    // redelivery of the same finished status.
    if (order.pointsApplied && order.pointsApplied > 0 && event.order_id) {
      const { error: consumeErr } = await supabaseAdmin.rpc(
        "consume_reward_points_reservation",
        { _order_id: event.order_id },
      );
      if (consumeErr) {
        console.warn(
          "consume_reward_points_reservation failed:",
          consumeErr.message,
        );
      }
    }
    await awardPurchasePoints(order.userId, order.amountCents, "panty");
    return finalize({ handled: true });
    // Idempotent: external_payment_reference is UNIQUE on
    // private_room_bookings. If this payment ref already claimed the row
    // (or another) the update returns 0 rows and we no-op.
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("private_room_bookings")
      .select("id, status, external_payment_reference, amount_cents, environment, user_id")
      .eq("id", order.bookingId)
      .maybeSingle();
    if (fetchErr) throw new Error(`booking lookup failed: ${fetchErr.message}`);
    if (!existing) return finalize({ handled: false, reason: "booking_not_found" });
    if (existing.user_id !== order.userId) {
      return finalize({ handled: false, reason: "booking_user_mismatch" });
    }
    if (existing.external_payment_reference && existing.external_payment_reference !== paymentRef) {
      return finalize({ handled: false, reason: "booking_already_paid" });
    }
    // Terminal-state guard: a cancelled booking claimed by this same payment
    // ref was revoked by a prior reversal callback. Do NOT re-confirm it —
    // the priorReversal check above already refuses this path, but keep the
    // guard local to the booking write for defence-in-depth.
    if (existing.status === "cancelled" && existing.external_payment_reference === paymentRef) {
      return finalize({ handled: false, reason: "booking_cancelled_after_reversal" });
    }
    if (existing.status === "confirmed" && existing.external_payment_reference === paymentRef) {
      return finalize({ handled: true }); // already processed
    }
    const { error } = await supabaseAdmin
      .from("private_room_bookings")
      .update({
        status: "confirmed",
        external_payment_reference: paymentRef,
        amount_cents: order.amountCents,
        environment: order.environment,
      })
      .eq("id", order.bookingId);
    if (error) throw new Error(`confirm booking failed: ${error.message}`);
    return finalize({ handled: true });
  }

  return finalize({ handled: false, reason: "unhandled_kind" });
}

export async function handleWebhookRequest(request: Request): Promise<Response> {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) {
    console.error("NOWPAYMENTS_IPN_SECRET is not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-nowpayments-sig");

  if (!verifyNowPaymentsSignature(rawBody, signature, secret)) {
    console.warn("NOWPayments webhook: invalid signature");

    // Alert admins: unsigned/tampered requests hitting the IPN endpoint are a
    // security signal. Throttle to 1 per hour so a burst of retries or a
    // scanner doesn't flood the alert channel.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Snapshot a small, safe slice of the body (never log the whole payload).
      let bodySample: string | null = null;
      try {
        bodySample = rawBody.slice(0, 500);
      } catch {
        bodySample = null;
      }
      await raiseAlert(supabaseAdmin, {
        severity: "critical",
        kind: "nowpayments_invalid_signature",
        detail: {
          signature_present: Boolean(signature),
          signature_length: signature ? signature.length : 0,
          user_agent: request.headers.get("user-agent") ?? null,
          content_length: rawBody.length,
          body_sample: bodySample,
          count: 1,
        },
        throttleWindowMinutes: 60,
      });
    } catch (e) {
      console.warn("nowpayments invalid-signature alert failed:", e);
    }

    return new Response("Invalid signature", { status: 401 });
  }


  let event: NowPaymentsIpn;
  try {
    event = JSON.parse(rawBody) as NowPaymentsIpn;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const result = await processIpn(event);
    // Always return 200 for verified events so NOWPayments does not retry
    // (retries on non-2xx last up to several days).
    return Response.json({
      received: true,
      handled: result.handled,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  } catch (e) {
    // Only genuine processing errors (e.g. RPC failure) return 5xx so NOWPayments retries.
    console.error("NOWPayments webhook processing error:", e);
    return new Response("Webhook processing error", { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/payments/nowpayments-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleWebhookRequest(request),
    },
  },
});
