import SecretReveal from '@/components/SecretReveal';
import useTokensViewModel from '@/viewmodels/useTokensViewModel';

// docs/architecture/06 §7.4 / 07 §7.2 — Tokens page with create
// modal. The modal owns plaintext secret state via the viewmodel
// and clears it on close.

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
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : vm.status.kind === 'error' ? (
        <p role="alert" className="text-destructive text-sm">
          {vm.status.message}
        </p>
      ) : vm.status.tokens.length === 0 ? (
        <p className="text-muted-foreground text-sm">No tokens yet.</p>
      ) : (
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
            {vm.status.tokens.map((tok) => (
              <tr key={tok.id} className="border-border border-t">
                <td className="py-2 pr-2">{tok.name}</td>
                <td className="py-2 pr-2 font-mono text-xs">{tok.prefix}</td>
                <td className="py-2 pr-2 font-mono text-xs">{tok.created_at}</td>
                <td className="py-2 pr-2 font-mono text-xs">{tok.last_used_at ?? '—'}</td>
                <td className="py-2 pr-2 text-right">
                  <button
                    type="button"
                    onClick={() => void vm.revoke(tok.id)}
                    className="border-input rounded border px-2 py-1 text-xs"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {vm.modal.open ? <CreateTokenDialog vm={vm} /> : null}
    </section>
  );
}

type VM = ReturnType<typeof useTokensViewModel>;

function CreateTokenDialog({ vm }: { vm: VM }) {
  if (!vm.modal.open) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires showModal() imperative API; sticking with role for now
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create token"
      className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-6"
    >
      <div className="bg-secondary rounded-card w-full max-w-md space-y-3 p-6">
        {vm.modal.phase === 'reveal' ? (
          <RevealStep
            createdName={vm.modal.createdName}
            secret={vm.modal.createdSecret}
            onClose={vm.closeCreateModal}
          />
        ) : (
          <NameStep vm={vm} />
        )}
      </div>
    </div>
  );
}

function NameStep({ vm }: { vm: VM }) {
  if (!vm.modal.open || vm.modal.phase === 'reveal') return null;
  const name = vm.modal.phase === 'error' ? vm.modal.name : vm.modal.name;
  const submitting = vm.modal.phase === 'submitting';
  const errorMessage = vm.modal.phase === 'error' ? vm.modal.message : null;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void vm.submitCreate();
      }}
    >
      <h3 className="text-lg font-semibold">Create token</h3>
      <label className="block text-sm">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => vm.setCreateName(e.target.value)}
          className="border-input bg-background mt-1 w-full rounded border px-3 py-2 text-sm"
          placeholder="ci-bot, laptop, ..."
        />
      </label>
      {errorMessage !== null ? (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={vm.closeCreateModal}
          className="border-input rounded border px-3 py-2 text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function RevealStep({
  createdName,
  secret,
  onClose,
}: {
  createdName: string;
  secret: string;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Token created</h3>
      <p className="text-muted-foreground text-sm">
        Copy <span className="font-mono">{createdName}</span> now. Meowth does not store the
        plaintext value; once you close this dialog, it cannot be shown again.
      </p>
      <SecretReveal secret={secret} label="New token value" />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm"
        >
          Done
        </button>
      </div>
    </div>
  );
}
