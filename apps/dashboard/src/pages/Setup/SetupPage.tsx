import { Notice } from '@/components/ui/notice';
import useSetupViewModel from '@/viewmodels/useSetupViewModel';
import { Button, Input } from '@nocoo/basalt';
import { Field } from '@nocoo/basalt/components/field';
import { useId, useState } from 'react';

const BADGE_SHADOW = [
  '0 1px 2px rgba(0,0,0,0.06)',
  '0 4px 8px rgba(0,0,0,0.04)',
  '0 12px 24px rgba(0,0,0,0.06)',
  '0 24px 48px rgba(0,0,0,0.04)',
  '0 0 0 0.5px rgba(0,0,0,0.02)',
  '0 0 60px rgba(0,0,0,0.03)',
].join(', ');

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
    <div className="bg-basalt-background relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="flex w-full max-w-sm flex-col items-center">
        <div
          data-basalt-surface-root=""
          className="bg-basalt-card ring-black/[0.08] dark:ring-white/[0.06] relative flex w-full flex-col overflow-hidden rounded-2xl ring-1"
          style={{ boxShadow: BADGE_SHADOW }}
        >
          <div className="bg-basalt-primary px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="bg-basalt-background/80 h-4 w-8 rounded-full" />
              <div className="flex items-center gap-2">
                <img src="/logo-24.png" alt="" width={16} height={16} className="shrink-0" />
                <span className="text-basalt-primary-foreground text-sm font-semibold">Meowth</span>
              </div>
              <span className="text-basalt-primary-foreground/60 text-[10px] font-medium tracking-widest uppercase">
                Setup
              </span>
            </div>
          </div>

          <div className="flex flex-1 flex-col items-center px-6 pt-6 pb-6">
            <div className="bg-basalt-secondary ring-basalt-border flex h-20 w-20 items-center justify-center overflow-hidden rounded-full p-2.5 ring-1">
              <img src="/logo-80.png" alt="" width={56} height={56} />
            </div>
            <h1 className="text-basalt-foreground mt-5 text-lg font-semibold">Meowth - Setup</h1>
            <p className="text-basalt-muted-foreground mt-1 text-xs">
              {vm.mode === 'token' ? 'Sign in with a root token' : 'Mint a token from a setup-code'}
            </p>
            <div className="bg-basalt-border mt-5 h-px w-full" />

            {vm.mode === 'token' ? (
              <form onSubmit={handleTokenSubmit} className="mt-5 w-full space-y-3" noValidate>
                <Field htmlFor={tokenId} label="Paste your root token to continue:">
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
                </Field>
                {errorMessage ? (
                  <Notice variant="destructive" role="alert">
                    {errorMessage}
                  </Notice>
                ) : null}
                <Button type="submit" className="w-full" loading={submitting}>
                  {submitting ? 'Continuing...' : 'Continue'}
                </Button>
                <div className="pt-1 text-center text-sm">
                  <p className="text-basalt-muted-foreground">Don't have a token yet?</p>
                  <Button type="button" variant="link" onClick={() => vm.setMode('mint')}>
                    I have a setup-code instead
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleMintSubmit} className="mt-5 w-full space-y-3" noValidate>
                <Field
                  htmlFor={codeId}
                  label={
                    <>
                      Paste the setup-code from <code>meowthd init --skip-token</code>:
                    </>
                  }
                >
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
                </Field>
                {errorMessage ? (
                  <Notice variant="destructive" role="alert">
                    {errorMessage}
                  </Notice>
                ) : null}
                <Button
                  type="submit"
                  className="w-full"
                  loading={submitting}
                  disabled={vm.mintDisabled}
                >
                  {submitting ? 'Minting...' : 'Mint token'}
                </Button>
                {vm.mintDisabled && vm.mintDisabledReason ? (
                  <Notice variant="info">{vm.mintDisabledReason}</Notice>
                ) : null}
                <div className="pt-1 text-center text-sm">
                  <Button type="button" variant="link" onClick={() => vm.setMode('token')}>
                    Back to "I already have a token"
                  </Button>
                </div>
              </form>
            )}
          </div>

          <div className="border-basalt-border bg-basalt-secondary/50 flex items-center justify-center border-t py-2.5">
            <span className="text-basalt-muted-foreground text-[10px]">Local daemon sign-in</span>
          </div>
        </div>
      </div>
    </div>
  );
}
