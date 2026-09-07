import SecretReveal from '@/components/SecretReveal';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import type { TokensViewModel } from '@/viewmodels/useTokensViewModel';
import { type ReactElement, useId } from 'react';

export interface TokensCreateDialogProps {
  vm: TokensViewModel;
  trigger: ReactElement;
}

export default function TokensCreateDialog({ vm, trigger }: TokensCreateDialogProps) {
  return (
    <Dialog
      open={vm.modal.open}
      onOpenChange={(open) => {
        if (open) vm.openCreateModal();
        else vm.closeCreateModal();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {vm.modal.open ? (
        <DialogContent aria-label="Create token">
          <DialogTitle className={vm.modal.phase === 'reveal' ? 'sr-only' : undefined}>
            Create token
          </DialogTitle>
          {vm.modal.phase === 'reveal' ? (
            <RevealStep
              createdName={vm.modal.createdName}
              secret={vm.modal.createdSecret}
              onClose={vm.closeCreateModal}
            />
          ) : (
            <NameStep vm={vm} />
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function NameStep({ vm }: { vm: TokensViewModel }) {
  const nameId = useId();
  if (!vm.modal.open || vm.modal.phase === 'reveal') return null;
  const name = vm.modal.name;
  const submitting = vm.modal.phase === 'submitting';
  const errorMessage = vm.modal.phase === 'error' ? vm.modal.message : null;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void vm.submitCreate();
      }}
    >
      <DialogHeader>
        <DialogDescription>
          Name the token so you can tell it apart later. The secret is shown only once.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => vm.setCreateName(e.target.value)}
          placeholder="ci-bot, laptop, ..."
        />
      </div>
      {errorMessage !== null ? (
        <Notice variant="destructive" role="alert">
          {errorMessage}
        </Notice>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={vm.closeCreateModal}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create'}
        </Button>
      </DialogFooter>
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
    <div className="space-y-4">
      <DialogHeader>
        <h3 className="text-lg font-semibold leading-none tracking-tight">Token created</h3>
        <DialogDescription>
          Copy <span className="font-mono">{createdName}</span> now. Meowth does not store the
          plaintext value; once you close this dialog, it cannot be shown again.
        </DialogDescription>
      </DialogHeader>
      <SecretReveal secret={secret} label="New token value" />
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
