import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";
import { ensureSessionIdInReturnUrl } from "@/lib/store.functions";

type Result<T> = T | { error: string };

async function getOwnedSubscription(
  supabase: any,
  userId: string,
  environment: StripeEnv,
) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, stripe_subscription_id, stripe_customer_id, status, cancel_at_period_end, current_period_end, price_id")
    .eq("user_id", userId)
    .eq("environment", environment)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    stripe_subscription_id: string;
    stripe_customer_id: string;
    status: string;
    cancel_at_period_end: boolean | null;
    current_period_end: string | null;
    price_id: string | null;
  } | null;
}

export const getBillingSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<Result<{
    subscription: {
      status: string;
      cancel_at_period_end: boolean;
      current_period_end: string | null;
      price_id: string | null;
    } | null;
    defaultPaymentMethod: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
    hasCustomer: boolean;
  }>> => {
    try {
      const sub = await getOwnedSubscription(context.supabase, context.userId, data.environment);
      if (!sub) {
        return { subscription: null, defaultPaymentMethod: null, hasCustomer: false };
      }
      const stripe = createStripeClient(data.environment);
      const customer = await stripe.customers.retrieve(sub.stripe_customer_id);
      let pm = null as any;
      if (!("deleted" in customer) || !customer.deleted) {
        const defaultPmId =
          (customer as any).invoice_settings?.default_payment_method ?? null;
        if (defaultPmId) {
          const paymentMethod = await stripe.paymentMethods.retrieve(
            typeof defaultPmId === "string" ? defaultPmId : defaultPmId.id,
          );
          if (paymentMethod.card) {
            pm = {
              brand: paymentMethod.card.brand,
              last4: paymentMethod.card.last4,
              exp_month: paymentMethod.card.exp_month,
              exp_year: paymentMethod.card.exp_year,
            };
          }
        }
      }
      return {
        subscription: {
          status: sub.status,
          cancel_at_period_end: !!sub.cancel_at_period_end,
          current_period_end: sub.current_period_end,
          price_id: sub.price_id,
        },
        defaultPaymentMethod: pm,
        hasCustomer: true,
      };
    } catch (error) {
      return { error: getStripeErrorMessage(error) } as any;
    }
  });

export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<Result<{ ok: true }>> => {
    try {
      const sub = await getOwnedSubscription(context.supabase, context.userId, data.environment);
      if (!sub) throw new Error("No active subscription");
      const stripe = createStripeClient(data.environment);
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const resumeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<Result<{ ok: true }>> => {
    try {
      const sub = await getOwnedSubscription(context.supabase, context.userId, data.environment);
      if (!sub) throw new Error("No subscription to resume");
      const stripe = createStripeClient(data.environment);
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: false,
      });
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const listMyInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<Result<Array<{
    id: string;
    number: string | null;
    amount_paid: number;
    currency: string;
    status: string;
    hosted_invoice_url: string | null;
    invoice_pdf: string | null;
    created: number;
  }>>> => {
    try {
      const sub = await getOwnedSubscription(context.supabase, context.userId, data.environment);
      if (!sub) return [];
      const stripe = createStripeClient(data.environment);
      const invoices = await stripe.invoices.list({
        customer: sub.stripe_customer_id,
        limit: 12,
      });
      return invoices.data.map((inv) => ({
        id: inv.id ?? "",
        number: inv.number ?? null,
        amount_paid: inv.amount_paid ?? 0,
        currency: inv.currency ?? "usd",
        status: inv.status ?? "unknown",
        hosted_invoice_url: inv.hosted_invoice_url ?? null,
        invoice_pdf: inv.invoice_pdf ?? null,
        created: inv.created ?? 0,
      }));
    } catch (error) {
      return { error: getStripeErrorMessage(error) } as any;
    }
  });

/**
 * Creates a Checkout Session in `setup` mode. The user completes card
 * entry through Stripe's embedded checkout; the returned PaymentMethod
 * is captured on `setup_intent.succeeded` (fired to our regular webhook)
 * or, more reliably, on the return URL where we finalise it via
 * finaliseSetupSession below.
 */
export const createSetupSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv; returnUrl: string }) => data)
  .handler(async ({ data, context }): Promise<Result<{ clientSecret: string }>> => {
    try {
      const sub = await getOwnedSubscription(context.supabase, context.userId, data.environment);
      if (!sub) throw new Error("No subscription on file");
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        ui_mode: "embedded",
        customer: sub.stripe_customer_id,
        return_url: ensureSessionIdInReturnUrl(data.returnUrl),
        metadata: { userId: context.userId, purpose: "update_default_pm" },
      });
      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/**
 * Called from the return URL after the customer completes the setup
 * session. Reads the SetupIntent off the session, attaches the new
 * PaymentMethod as the customer's default, and updates any active
 * subscription so future renewals bill the new card.
 */
export const finaliseSetupSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv; sessionId: string }) => data)
  .handler(async ({ data, context }): Promise<Result<{ ok: true }>> => {
    try {
      const sub = await getOwnedSubscription(context.supabase, context.userId, data.environment);
      if (!sub) throw new Error("No subscription");
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId, {
        expand: ["setup_intent"],
      });
      // Security: session must belong to the caller's customer.
      const sessionCustomer =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (sessionCustomer !== sub.stripe_customer_id) throw new Error("Session mismatch");
      const setupIntent = session.setup_intent;
      if (!setupIntent || typeof setupIntent === "string") throw new Error("Setup not complete");
      const pmId =
        typeof setupIntent.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id;
      if (!pmId) throw new Error("No card returned");

      await stripe.customers.update(sub.stripe_customer_id, {
        invoice_settings: { default_payment_method: pmId },
      });
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        default_payment_method: pmId,
      });
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
