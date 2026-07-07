import { useSyncExternalStore } from "react";

/**
 * Cart items — one-time, cartable SKUs only. Subscriptions, term passes and
 * private-room bookings are NOT cartable (Stripe won't put them in the same
 * session as one-time items, and bookings hold a unique time slot).
 */
export type CartItem =
  | {
      kind: "content";
      /** content_items.id */
      id: string;
      title: string;
      unit_amount_cents: number;
      currency: string;
      cover_url?: string | null;
      quantity: number;
      /** Selected size variant, e.g. "S", "M", "L". Undefined = one-size / no variant. */
      size?: string;
    }
  | {
      kind: "panty";
      /** Stripe lookup_key, e.g. "panty_24hr_aud" */
      id: "panty_24hr_aud" | "panty_48hr_aud" | "panty_72hr_aud";
      title: string;
      unit_amount_cents: number;
      currency: string;
      cover_url?: string | null;
      quantity: number;
      size?: string;
    };

/** Stable per-line identity: same product in different sizes = separate lines. */
export function cartLineKey(it: Pick<CartItem, "kind" | "id" | "size">): string {
  return `${it.kind}:${it.id}:${it.size ?? ""}`;
}


const STORAGE_KEY = "pp_cart_v1";

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it) =>
        it && (it.kind === "content" || it.kind === "panty") && typeof it.id === "string",
    ) as CartItem[];
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage disabled / full — silent.
  }
}

const listeners = new Set<() => void>();
let cache: CartItem[] = [];
let hydrated = false;

function ensureHydrated() {
  if (hydrated || typeof window === "undefined") return;
  cache = read();
  hydrated = true;
  // Sync across tabs.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    cache = read();
    listeners.forEach((l) => l());
  });
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  ensureHydrated();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  ensureHydrated();
  return cache;
}

function getServerSnapshot(): CartItem[] {
  return [];
}

function setItems(next: CartItem[]) {
  cache = next;
  write(cache);
  emit();
}

export const cart = {
  add(item: Omit<CartItem, "quantity"> & { quantity?: number }) {
    ensureHydrated();
    const qty = Math.max(1, item.quantity ?? 1);
    const idx = cache.findIndex(
      (it) => it.kind === item.kind && it.id === item.id && (it.size ?? "") === (item.size ?? ""),
    );
    if (idx >= 0) {
      const next = [...cache];
      // Panty variants are unique per Stripe session — cap at 1.
      const capped =
        item.kind === "panty" ? 1 : next[idx].quantity + qty;
      next[idx] = { ...next[idx], quantity: capped } as CartItem;
      setItems(next);
    } else {
      // Stripe session can only hold one panty row — if a different panty
      // variant is already in the cart, swap it for the newly-added one
      // rather than blocking the click (reads as "button doesn't work").
      const next =
        item.kind === "panty"
          ? cache.filter((it) => it.kind !== "panty")
          : [...cache];
      setItems([...next, { ...item, quantity: item.kind === "panty" ? 1 : qty } as CartItem]);
    }
  },
  remove(kind: CartItem["kind"], id: string, size?: string) {
    setItems(
      cache.filter(
        (it) => !(it.kind === kind && it.id === id && (it.size ?? "") === (size ?? "")),
      ),
    );
  },
  setQty(kind: CartItem["kind"], id: string, quantity: number, size?: string) {
    if (quantity <= 0) return cart.remove(kind, id, size);
    if (kind === "panty") quantity = 1;
    setItems(
      cache.map((it) =>
        it.kind === kind && it.id === id && (it.size ?? "") === (size ?? "")
          ? ({ ...it, quantity } as CartItem)
          : it,
      ),
    );
  },
  clear() {
    setItems([]);
  },
  snapshot() {
    ensureHydrated();
    return cache;
  },
};


export function useCart() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const count = items.reduce((n, it) => n + it.quantity, 0);
  const subtotalCents = items.reduce((n, it) => n + it.unit_amount_cents * it.quantity, 0);
  const hasPanty = items.some((it) => it.kind === "panty");
  const currency = items[0]?.currency ?? "aud";
  return { items, count, subtotalCents, hasPanty, currency, ...cart };
}

export function formatMoney(cents: number, currency = "aud"): string {
  const upper = currency.toUpperCase();
  const value = cents / 100;
  if (upper === "AUD") return `A$${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: upper }).format(value);
  } catch {
    return `${upper} ${value.toFixed(2)}`;
  }
}
