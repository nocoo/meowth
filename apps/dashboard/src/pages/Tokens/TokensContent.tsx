import { ConfirmDialog, LayerCard } from '@nocoo/basalt';
import { Button } from '@nocoo/basalt/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nocoo/basalt/components/table';
import { KeyRound } from '@nocoo/basalt/icons';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import type { TokenView } from '@/viewmodels/useTokensViewModel';

export interface TokensContentProps {
  tokens: readonly TokenView[];
  onRevoke: (id: string) => Promise<void>;
}

export default function TokensContent({ tokens, onRevoke }: TokensContentProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const pending = tokens.find((tok) => tok.id === pendingId);

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
    <>
      <LayerCard padding="none" outlined className="overflow-x-auto">
        <div data-slot="table-container" className="relative w-full overflow-x-auto">
          <Table className="whitespace-nowrap">
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
                  <TableCell className="font-mono text-xs text-basalt-muted-foreground">
                    {tok.prefix}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-basalt-muted-foreground">
                    {tok.created_at}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-basalt-muted-foreground">
                    {tok.last_used_at ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingId(tok.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </LayerCard>
      <ConfirmDialog
        open={pendingId !== null}
        loading={revoking}
        onOpenChange={(open) => {
          if (!open && !revoking) setPendingId(null);
        }}
        onConfirm={async () => {
          if (pendingId === null || revoking) return;
          setRevoking(true);
          try {
            await onRevoke(pendingId);
            setPendingId(null);
          } finally {
            setRevoking(false);
          }
        }}
        title="Revoke token?"
        description={
          pending
            ? `Clients using ${pending.name} (${pending.prefix}) will stop immediately.`
            : 'Clients using this token will stop immediately.'
        }
        variant="destructive"
        confirmLabel="Revoke"
      />
    </>
  );
}
