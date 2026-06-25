import SecretReveal from '@/components/SecretReveal';
import type { TokensViewModel } from '@/viewmodels/useTokensViewModel';

// docs/architecture/06 §7.4 + 07 §7.2 + features/02 §4.4 —
// Phase 2 Stage C4. Create-token dialog extracted from TokensPage.
//
// Not a G3 alert-dialog: this is a non-destructive create flow.
// Manual `role="dialog" + aria-modal + aria-label="Create token"`
// keeps the contract used by existing tests and L3 specs.
//
// Plaintext lifecycle (07 §7.2 #5): the freshly-minted secret
// lives only in `vm.modal.createdSecret` during the reveal phase.
// `closeCreateModal` (Cancel/Done) resets vm.modal to
// `{ open: false }`, which unmounts SecretReveal, so plaintext is
// no longer in the DOM and its timers/listeners are cleaned up.

export interface TokensCreateDialogProps {
  vm: TokensViewModel;
}

export default function TokensCreateDialog({ vm }: TokensCreateDialogProps) {
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

function NameStep({ vm }: { vm: TokensViewModel }) {
  if (!vm.modal.open || vm.modal.phase === 'reveal') return null;
  const name = vm.modal.name;
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
