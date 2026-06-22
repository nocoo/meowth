import useTokensViewModel from '@/viewmodels/useTokensViewModel';

// docs/architecture/06 §7.4 — Tokens page.
// Skeleton renders an empty list; 3.18+ wires
// tokens.listTokens()/createToken/revokeToken and the Create
// modal flow (which carries the one-shot secret reveal).

export default function TokensPage() {
  const vm = useTokensViewModel();
  return (
    <section aria-labelledby="tokens-heading" className="space-y-2">
      <h2 id="tokens-heading" className="text-xl font-semibold">
        Tokens
      </h2>
      <p className="text-muted-foreground text-sm">
        {vm.tokens.length === 0 ? 'No data yet.' : 'Loading…'}
      </p>
    </section>
  );
}
