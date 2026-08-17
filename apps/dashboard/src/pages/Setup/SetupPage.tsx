import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import useSetupViewModel from '@/viewmodels/useSetupViewModel';
import { useId, useState } from 'react';

export default function SetupPage() {
  const vm = useSetupViewModel();
  const tokenId = useId();
  const codeId = useId();
  const [tokenInput, setTokenInput] = useState('');
  const [codeInput, setCodeInput] = useState('');

  const submitting = vm.status.kind === 'submitting';
  const errorMessage = vm.status.kind === 'error' ? vm.status.message : null;

  function handleTokenSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void vm.submitToken(tokenInput);
  }
  function handleMintSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void vm.submitMint(codeInput);
  }

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h1 className="text-xl font-semibold">Meowth - Setup</h1>

        {vm.mode === 'token' ? (
          <form onSubmit={handleTokenSubmit} className="space-y-3" noValidate>
            <Label htmlFor={tokenId} className="text-muted-foreground">
              Paste your root token to continue:
            </Label>
            <Input
              id={tokenId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="mwt_..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="font-mono"
            />
            {errorMessage ? (
              <Notice variant="destructive" role="alert">
                {errorMessage}
              </Notice>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Continuing...' : 'Continue'}
              </Button>
            </div>
            <div className="border-border border-t pt-3 text-sm">
              <p className="text-muted-foreground">Don't have a token yet?</p>
              <Button
                type="button"
                variant="link"
                className="h-auto px-0"
                onClick={() => vm.setMode('mint')}
              >
                I have a setup-code instead
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleMintSubmit} className="space-y-3" noValidate>
            <Label htmlFor={codeId} className="text-muted-foreground">
              Paste the setup-code from <code>meowthd init --skip-token</code>:
            </Label>
            <Input
              id={codeId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="mws_..."
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              className="font-mono"
            />
            {errorMessage ? (
              <Notice variant="destructive" role="alert">
                {errorMessage}
              </Notice>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={submitting || vm.mintDisabled}>
                {submitting ? 'Minting...' : 'Mint token'}
              </Button>
            </div>
            {vm.mintDisabled && vm.mintDisabledReason ? (
              <Notice variant="info">{vm.mintDisabledReason}</Notice>
            ) : null}
            <div className="border-border border-t pt-3 text-sm">
              <Button
                type="button"
                variant="link"
                className="h-auto px-0"
                onClick={() => vm.setMode('token')}
              >
                Back to "I already have a token"
              </Button>
            </div>
          </form>
        )}
      </Card>
    </main>
  );
}
