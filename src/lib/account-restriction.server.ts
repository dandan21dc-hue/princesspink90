/**
 * Shared guard used by every server function that lets a user commit to a
 * booking or checkout. Admins can flip `profiles.account_restricted = true`
 * from the CRM to freeze all outbound spend/RSVP activity for a given user.
 */
export const RESTRICTED_ACCOUNT_MESSAGE =
  "Please contact support to update your account status.";

export async function assertAccountNotRestricted(
  supabase: {
    from: (t: string) => {
      select: (s: string) => {
        eq: (
          k: string,
          v: string,
        ) => { maybeSingle: () => Promise<{ data: { account_restricted: boolean } | null }> };
      };
    };
  },
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
