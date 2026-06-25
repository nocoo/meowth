import { EmptyState } from '@/components/ui/empty-state';
import type { TokenView } from '@/models/types';
import { KeyRound } from 'lucide-react';

// docs/architecture/06 §7.4 + features/02 §4.4 — Phase 2 Stage C4.
// Pure-props Content for the Tokens table. Receives the resolved
// token list (TokenView is already secret-free by construction —
// see 03 §3) and a revoke handler. Renders the table when
// non-empty, EmptyState (icon=KeyRound) when the daemon
// legitimately reports zero tokens.

export interface TokensContentProps {
  tokens: readonly TokenView[];
  onRevoke: (id: string) => Promise<void>;
}

export default function TokensContent({ tokens, onRevoke }: TokensContentProps) {
  if (tokens.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No tokens yet"
        description="Create a token to authenticate the dashboard, the CLI, or any other client against this daemon."
      />
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="py-1 pr-2">Name</th>
          <th className="py-1 pr-2">Prefix</th>
          <th className="py-1 pr-2">Created</th>
          <th className="py-1 pr-2">Last used</th>
          <th className="py-1 pr-2" />
        </tr>
      </thead>
      <tbody>
        {tokens.map((tok) => (
          <tr key={tok.id} className="border-border border-t">
            <td className="py-2 pr-2">{tok.name}</td>
            <td className="py-2 pr-2 font-mono text-xs">{tok.prefix}</td>
            <td className="py-2 pr-2 font-mono text-xs">{tok.created_at}</td>
            <td className="py-2 pr-2 font-mono text-xs">{tok.last_used_at ?? '—'}</td>
            <td className="py-2 pr-2 text-right">
              <button
                type="button"
                onClick={() => void onRevoke(tok.id)}
                className="border-input rounded border px-2 py-1 text-xs"
              >
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
