import { createServerFn } from "@tanstack/react-start";

export type ReferralValidation = {
  code: string;
  exists: boolean;
  is_self: boolean;
};

export const validateReferralCode = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string; email?: string }) => ({
    code: String(input.code ?? "").trim().toUpperCase().slice(0, 12),
    email: String(input.email ?? "").trim().toLowerCase().slice(0, 255),
  }))
  .handler(async ({ data }): Promise<ReferralValidation> => {
    if (!data.code) return { code: "", exists: false, is_self: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rpc, error } = await supabaseAdmin.rpc("validate_referral_code", {
      _code: data.code,
      _email: data.email,
    });
    if (error) throw error;
    const result = (rpc ?? {}) as { exists?: boolean; is_self?: boolean };
    return {
      code: data.code,
      exists: !!result.exists,
      is_self: !!result.is_self,
    };
  });
