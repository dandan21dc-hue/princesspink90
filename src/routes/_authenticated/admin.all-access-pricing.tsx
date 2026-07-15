import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { RoleGuard } from "@/components/RoleGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  listAllAccessTiersAdmin,
  updateAllAccessTier,
  type AllAccessTier,
} from "@/lib/all-access-tiers.functions";

export const Route = createFileRoute("/_authenticated/admin/all-access-pricing")({
  head: () => ({ meta: [{ title: "All-Access Pricing · Admin" }] }),
  component: () => (
    <RoleGuard role="admin">
      <AdminAllAccessPricing />
    </RoleGuard>
  ),
});

type Draft = {
  label: string;
  price_display: string;
  cadence: string;
  perk: string;
  price_cents: number;
  invoice_description: string;
  sort_order: number;
  is_active: boolean;
};

function toDraft(t: AllAccessTier): Draft {
  return {
    label: t.label,
    price_display: t.price_display,
    cadence: t.cadence,
    perk: t.perk ?? "",
    price_cents: t.price_cents,
    invoice_description: t.invoice_description,
    sort_order: t.sort_order,
    is_active: t.is_active,
  };
}

function centsToAud(cents: number): string {
  return (cents / 100).toFixed(2);
}

function TierRow({ tier }: { tier: AllAccessTier }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(tier));
  const [dollars, setDollars] = useState<string>(() => centsToAud(tier.price_cents));
  const qc = useQueryClient();
  const update = useServerFn(updateAllAccessTier);

  useEffect(() => {
    setDraft(toDraft(tier));
    setDollars(centsToAud(tier.price_cents));
  }, [tier]);

  const mutation = useMutation({
    mutationFn: () =>
      update({
        data: {
          id: tier.id,
          label: draft.label,
          price_display: draft.price_display,
          cadence: draft.cadence,
          perk: draft.perk.trim() ? draft.perk : null,
          price_cents: draft.price_cents,
          invoice_description: draft.invoice_description,
          sort_order: draft.sort_order,
          is_active: draft.is_active,
        },
      }),
    onSuccess: () => {
      toast.success(`Saved ${tier.label}`);
      qc.invalidateQueries({ queryKey: ["admin-all-access-tiers"] });
      qc.invalidateQueries({ queryKey: ["all-access-tiers"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(tier));

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-base font-semibold">{tier.label}</div>
          <div className="text-[11px] font-mono text-muted-foreground">
            plan_id: {tier.plan_id}
            {tier.price_id ? ` · price_id: ${tier.price_id}` : " · default 30-day"}
            {" · kind: "}{tier.kind}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Active</span>
          <Switch
            checked={draft.is_active}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Label</span>
          <Input
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </label>

        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Displayed price (e.g. A$27)</span>
          <Input
            value={draft.price_display}
            onChange={(e) => setDraft((d) => ({ ...d, price_display: e.target.value }))}
          />
        </label>

        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Charged amount (AUD)</span>
          <Input
            type="number"
            step="0.01"
            min="1"
            value={dollars}
            onChange={(e) => {
              const v = e.target.value;
              setDollars(v);
              const n = Math.round(parseFloat(v) * 100);
              if (Number.isFinite(n) && n >= 100)
                setDraft((d) => ({ ...d, price_cents: n }));
            }}
          />
          <span className="text-[10px] text-muted-foreground">
            Stored as {draft.price_cents} cents · used by the NOWPayments invoice
          </span>
        </label>

        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Cadence label</span>
          <Input
            value={draft.cadence}
            onChange={(e) => setDraft((d) => ({ ...d, cadence: e.target.value }))}
          />
        </label>

        <label className="text-xs space-y-1 sm:col-span-2">
          <span className="text-muted-foreground">Inclusions / perk blurb (shown under price)</span>
          <Textarea
            rows={2}
            value={draft.perk}
            onChange={(e) => setDraft((d) => ({ ...d, perk: e.target.value }))}
          />
        </label>

        <label className="text-xs space-y-1 sm:col-span-2">
          <span className="text-muted-foreground">Invoice description (buyer sees this at checkout)</span>
          <Input
            value={draft.invoice_description}
            onChange={(e) => setDraft((d) => ({ ...d, invoice_description: e.target.value }))}
          />
        </label>

        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Sort order</span>
          <Input
            type="number"
            value={draft.sort_order}
            onChange={(e) =>
              setDraft((d) => ({ ...d, sort_order: parseInt(e.target.value || "0", 10) }))
            }
          />
        </label>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || mutation.isPending}
          onClick={() => {
            setDraft(toDraft(tier));
            setDollars(centsToAud(tier.price_cents));
          }}
        >
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

function AdminAllAccessPricing() {
  const list = useServerFn(listAllAccessTiersAdmin);
  const q = useQuery({
    queryKey: ["admin-all-access-tiers"],
    queryFn: () => list(),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl">All-Access Pass pricing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit prices, inclusions, and visibility for every All-Access tier. Changes
          take effect immediately on <code>/all-access-pass</code> and in the NOWPayments
          checkout amount for the next invoice.
        </p>
      </header>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading tiers…</p>}
      {q.isError && (
        <p className="text-sm text-destructive">
          Couldn't load tiers: {(q.error as Error).message}
        </p>
      )}

      <div className="space-y-4">
        {(q.data ?? []).map((t) => (
          <TierRow key={t.id} tier={t} />
        ))}
      </div>
    </div>
  );
}
