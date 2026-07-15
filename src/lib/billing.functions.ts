/**
 * Legacy billing surface. Stripe was removed — NOWPayments is the only
 * processor and it does not implement subscriptions, saved cards, hosted
 * invoices, or a billing portal. These exports remain as stubs so existing
 * callers (`account.billing.tsx`, `AllAccessCard.tsx`) keep compiling and
 * degrade gracefully at runtime.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StripeEnv } from "@/lib/stripe.server";

type Result<T> = T | { error: string };

const NOT_AVAILABLE = "Subscription billing is not available on this account.";

export const getBillingSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async (): Promise<Result<{
    subscription: {
      status: string;
      cancel_at_period_end: boolean;
      current_period_end: string | null;
      price_id: string | null;
    } | null;
    defaultPaymentMethod: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
    hasCustomer: boolean;
  }>> => {
    return { subscription: null, defaultPaymentMethod: null, hasCustomer: false };
  });

export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async (): Promise<Result<{ ok: true }>> => {
    return { error: NOT_AVAILABLE };
  });

export const resumeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async (): Promise<Result<{ ok: true }>> => {
    return { error: NOT_AVAILABLE };
  });

export const listMyInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async (): Promise<Result<Array<{
    id: string;
    number: string | null;
    amount_paid: number;
    currency: string;
    status: string;
    hosted_invoice_url: string | null;
    invoice_pdf: string | null;
    created: number;
  }>>> => {
    return [];
  });

export const createSetupSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv; returnUrl: string }) => data)
  .handler(async (): Promise<Result<{ clientSecret: string }>> => {
    return { error: "Saved card management is not available." };
  });

export const finaliseSetupSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv; sessionId: string }) => data)
  .handler(async (): Promise<Result<{ ok: true }>> => {
    return { error: "Saved card management is not available." };
  });

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv; returnUrl?: string }) => data)
  .handler(async (): Promise<Result<{ url: string }>> => {
    return { error: "Billing portal is not available." };
  });
