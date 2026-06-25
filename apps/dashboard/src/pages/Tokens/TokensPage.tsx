import { EmptyState } from '@/components/ui/empty-state';
import useTokensViewModel from '@/viewmodels/useTokensViewModel';
import { AlertCircle } from 'lucide-react';
import TokensContent from './TokensContent';
import TokensCreateDialog from './TokensCreateDialog';
import TokensSkeleton from './TokensSkeleton';

// docs/architecture/06 §7.4 + features/02 §4.4 — Phase 2 Stage C4.
// Page shell: owns the viewmodel, the Create-token toolbar
// button, and the loading/error/ready branch. Business render
// (table or true-empty EmptyState) lives in TokensContent; the
// pre-data placeholder lives in TokensSkeleton; the create
// modal lives in TokensCreateDialog. The Create button is always
// rendered so the user can mint a token even when the list is
// in a loading/error/empty state.

export default function TokensPage() {
  const vm = useTokensViewModel();

  return (
    <section aria-labelledby="tokens-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="tokens-heading" className="text-xl font-semibold">
          Tokens
        </h2>
        <button
          type="button"
          onClick={vm.openCreateModal}
          className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm"
        >
          Create token
        </button>
      </div>

      {vm.status.kind === 'loading' ? (
        <TokensSkeleton />
      ) : vm.status.kind === 'error' ? (
        <EmptyState
          icon={AlertCircle}
          title="Tokens unavailable"
          description={vm.status.message}
          tone="error"
        />
      ) : (
        <TokensContent tokens={vm.status.tokens} onRevoke={vm.revoke} />
      )}

      <TokensCreateDialog vm={vm} />
    </section>
  );
}
