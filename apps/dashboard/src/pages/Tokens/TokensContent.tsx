import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { useState } from 'react';

export interface TokensContentProps {
  tokens: readonly TokenView[];
  onRevoke: (id: string) => Promise<void>;
}

export default function TokensContent({ tokens, onRevoke }: TokensContentProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
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
      <Card className="overflow-hidden">
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
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setPendingId(tok.id)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <ConfirmDialog
        open={pendingId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingId(null);
        }}
        onConfirm={async () => {
          if (pendingId === null) return;
          await onRevoke(pendingId);
          setPendingId(null);
        }}
        title="Revoke token?"
        description={
          pending
            ? `Clients using ${pending.name} (${pending.prefix}) will stop immediately.`
            : 'Clients using this token will stop immediately.'
        }
        variant="destructive"
        confirmText="Revoke"
      />
    </>
  );
}
