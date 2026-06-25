import useSetupViewModel from '@/viewmodels/useSetupViewModel';
import { useId, useState } from 'react';

// docs/architecture/06 §7.6 / §9.1 — /setup page.
//
// Two modes share one page. Mode A (default) is the paste-bearer
// flow most users hit; mode B mints via the setup-code printed
// by `meowthd init --skip-token`. The mode B button is disabled
// when the dashboard is served from a different origin than the
// daemon (Vite dev), per 04 §6.6 / 06 §9.2.

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive rounded border px-3 py-2 text-sm"
    >
      {message}
    </p>
  );
}

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
      <div className="bg-secondary rounded-card w-full max-w-md space-y-4 p-6">
        <h1 className="text-xl font-semibold">Meowth - Setup</h1>

        {vm.mode === 'token' ? (
          <form onSubmit={handleTokenSubmit} className="space-y-3" noValidate>
            <label htmlFor={tokenId} className="block text-sm">
              Paste your root token to continue:
            </label>
            <input
              id={tokenId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="mwt_..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="border-input bg-background w-full rounded border px-3 py-2 font-mono text-sm"
            />
            {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm disabled:opacity-50"
              >
                {submitting ? 'Continuing...' : 'Continue'}
              </button>
            </div>
            <div className="border-border border-t pt-3 text-sm">
              <p className="text-muted-foreground">Don't have a token yet?</p>
              <button
                type="button"
                onClick={() => vm.setMode('mint')}
                className="text-primary mt-1 underline-offset-2 hover:underline"
              >
                I have a setup-code instead
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleMintSubmit} className="space-y-3" noValidate>
            <label htmlFor={codeId} className="block text-sm">
              Paste the setup-code from <code>meowthd init --skip-token</code>:
            </label>
            <input
              id={codeId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="mws_..."
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              className="border-input bg-background w-full rounded border px-3 py-2 font-mono text-sm"
            />
            {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={submitting || vm.mintDisabled}
                className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm disabled:opacity-50"
              >
                {submitting ? 'Minting...' : 'Mint token'}
              </button>
            </div>
            {vm.mintDisabled && vm.mintDisabledReason ? (
              <p className="text-muted-foreground text-xs">{vm.mintDisabledReason}</p>
            ) : null}
            <div className="border-border border-t pt-3 text-sm">
              <button
                type="button"
                onClick={() => vm.setMode('token')}
                className="text-primary underline-offset-2 hover:underline"
              >
                Back to "I already have a token"
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
