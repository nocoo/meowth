import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TokenView } from '@/models/types';
import { KeyRound } from 'lucide-react';

// docs/architecture/06 §7.4 + features/02 §4.4 — Phase 2 Stage C4.
// Pure-props Content for the Tokens table. Receives the resolved
// token list (TokenView is already secret-free by construction —
// see 03 §3) and a revoke handler. Renders the table when
// non-empty, EmptyState (icon=KeyRound) when the daemon
// legitimately reports zero tokens.
//
// Bug fix Commit 2 — wraps the table in a `rounded-card
// bg-secondary overflow-hidden` L2 surface. Revoke button +
// cell semantics unchanged.

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
    <div className="rounded-card bg-secondary overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Prefix</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((tok) => (
            <TableRow key={tok.id}>
              <TableCell>{tok.name}</TableCell>
              <TableCell className="font-mono text-xs">{tok.prefix}</TableCell>
              <TableCell className="font-mono text-xs">{tok.created_at}</TableCell>
              <TableCell className="font-mono text-xs">{tok.last_used_at ?? '—'}</TableCell>
              <TableCell className="text-right">
                <button
                  type="button"
                  onClick={() => void onRevoke(tok.id)}
                  className="border-input rounded border px-2 py-1 text-xs"
                >
                  Revoke
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
