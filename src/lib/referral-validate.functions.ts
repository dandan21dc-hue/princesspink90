import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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

    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const supabase = createClient<Database>(process.env.SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
            h.delete("Authorization");
          }
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    const { data: rpc, error } = await supabase.rpc("validate_referral_code", {
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
