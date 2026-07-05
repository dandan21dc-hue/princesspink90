const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full border-b border-red-500/40 bg-red-950/60 px-4 py-2 text-center text-xs text-red-200">
        Payments not configured — complete go-live to accept real purchases.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b border-primary/30 bg-primary/10 px-4 py-2 text-center text-[11px] uppercase tracking-widest text-primary">
        Test mode · use card 4242 4242 4242 4242, any future expiry &amp; CVC
      </div>
    );
  }
  return null;
}
