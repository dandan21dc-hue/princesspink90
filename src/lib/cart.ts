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
      /**
       * `panty_listings.id` — a real database UUID. The checkout server
       * function (`createNowpaymentsInvoice`) looks up the listing row by
       * this id to derive amount + currency, so it MUST be a UUID, not a
       * SKU / Stripe lookup key. Legacy carts that stored lookup keys
       * like `panty_24hr_aud` are dropped by `read()`.
       */
      id: string;
      title: string;
      unit_amount_cents: number;
      currency: string;
      cover_url?: string | null;
      quantity: number;
      size?: string;
    };

/** Standard UUID v1-5 shape — must match the server-side `pantyListingId` schema. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCartItemIdValid(it: Pick<CartItem, "kind" | "id">): boolean {
  // Content and panty lines both reference database UUIDs on the server.
  // A non-UUID here means the entry is stale/legacy and cannot check out.
  return typeof it.id === "string" && UUID_RE.test(it.id);
}


/** Stable per-line identity: same product in different sizes = separate lines. */
export function cartLineKey(it: Pick<CartItem, "kind" | "id" | "size">): string {
  return `${it.kind}:${it.id}:${it.size ?? ""}`;
}


const STORAGE_KEY = "pp_cart_v1";

// Items dropped by `read()` because their `id` no longer matches the
// server-side UUID contract. Buffered here so the next mounted UI can
// surface a single toast explaining what was removed (see
// `consumePrunedItems`) instead of having every hydration silently drop
// the item and leave the user staring at a suddenly-empty cart.
let pendingPruned: CartItem[] = [];

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cleaned: CartItem[] = [];
    const removed: CartItem[] = [];
    for (const it of parsed) {
      const looksLikeCartItem =
        it &&
        (it.kind === "content" || it.kind === "panty") &&
        typeof it.id === "string";
      if (!looksLikeCartItem) continue;
      // Drop legacy panty entries whose id was a Stripe lookup key
      // (e.g. "panty_24hr_aud") — the checkout server function rejects
      // anything that isn't a `panty_listings.id` UUID.
      if (UUID_RE.test(it.id)) cleaned.push(it as CartItem);
      else removed.push(it as CartItem);
    }
    // If we pruned anything, persist the cleaned list so we don't re-check
    // on every mount and so other tabs see the same state, AND queue the
    // removed items so the next mounted UI can surface a single toast
    // explaining what happened (see `consumePrunedItems`).
    if (removed.length > 0) {
      pendingPruned.push(...removed);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      } catch {
        // ignore — next write() will re-serialize
      }
    }
    return cleaned;
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
