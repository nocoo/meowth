import { useRegisterRefresh } from '@/components/layout/use-register-refresh';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
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
  useRegisterRefresh(vm.refresh);

  return (
    <section aria-labelledby="tokens-heading">
      <PageHeader
        title="Tokens"
        headingId="tokens-heading"
        actions={
          <Button type="button" size="xs" onClick={vm.openCreateModal}>
            Create token
          </Button>
        }
      />

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
