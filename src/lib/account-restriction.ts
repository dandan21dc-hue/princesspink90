/**
 * Shared guard used by every server function that lets a user commit to a
 * booking or checkout. Admins can flip `profiles.account_restricted = true`
 * from the CRM to freeze all outbound spend/RSVP activity for a given user.
 */
export const RESTRICTED_ACCOUNT_MESSAGE =
  "Please contact support to update your account status.";

export const PENDING_VERIFICATION_MESSAGE =
  "Your account is pending ID verification. Please upload your compliance documents at /verify to unlock purchases and bookings.";

export const DECLINED_VERIFICATION_MESSAGE =
  "Your ID verification was declined. Please re-submit your documents at /verify to regain access.";

export async function assertAccountNotRestricted(
  supabase: any,
  userId: string,
): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("account_restricted")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.account_restricted) {
    throw new Error(RESTRICTED_ACCOUNT_MESSAGE);
  }
}

/**
 * Blocks purchases/bookings for accounts whose `profiles.verification_status`
 * is not `approved`. New signups default to `pending` and must complete the
 * Compliance Document Upload flow at `/verify` before spending.
 */
export async function assertProfileVerified(
  supabase: any,
  userId: string,
): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("verification_status")
    .eq("user_id", userId)
    .maybeSingle();
  const status = (data as any)?.verification_status ?? "pending";
  if (status === "approved") return;
  if (status === "declined") throw new Error(DECLINED_VERIFICATION_MESSAGE);
  throw new Error(PENDING_VERIFICATION_MESSAGE);
}
