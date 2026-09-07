import ThemeToggle from '@/components/ThemeToggle';
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

const RADIAL_GLOW = [
  'radial-gradient(ellipse 70% 55% at 50% 50%,',
  'hsl(var(--basalt-foreground) / 0.045) 0%,',
  'hsl(var(--basalt-foreground) / 0.042) 10%,',
  'hsl(var(--basalt-foreground) / 0.036) 20%,',
  'hsl(var(--basalt-foreground) / 0.028) 32%,',
  'hsl(var(--basalt-foreground) / 0.020) 45%,',
  'hsl(var(--basalt-foreground) / 0.012) 58%,',
  'hsl(var(--basalt-foreground) / 0.006) 72%,',
  'hsl(var(--basalt-foreground) / 0.002) 86%,',
  'transparent 100%)',
].join(' ');

function Barcode() {
  const bars = [2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1];
  return (
    <div className="flex h-full items-stretch gap-[1.5px]">
      {bars.map((w, i) => (
        <div
          key={`${i}-${w}`}
          className="bg-basalt-primary-foreground rounded-[0.5px]"
          style={{ width: `${w * 1.5}px`, opacity: i % 3 === 0 ? 0.9 : 0.5 }}
        />
      ))}
    </div>
  );
}

export default function SetupPage() {
  const vm = useSetupViewModel();
  const tokenId = useId();
  const codeId = useId();
  const [tokenInput, setTokenInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

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
    <div className="bg-basalt-background relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0" style={{ background: RADIAL_GLOW }} />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex flex-col items-center">
          <div
            data-basalt-surface-root=""
            className="bg-basalt-card ring-black/[0.08] dark:ring-white/[0.06] relative flex aspect-[54/86] w-72 flex-col overflow-hidden rounded-2xl ring-1"
            style={{ boxShadow: BADGE_SHADOW }}
          >
            <div className="bg-basalt-primary px-5 py-4">
              <div className="flex items-center justify-between">
                <div
                  className="bg-basalt-background/80 h-4 w-8 rounded-full"
                  style={{
                    boxShadow:
                      'inset 0 1.5px 3px rgba(0,0,0,0.35), inset 0 -0.5px 1px rgba(255,255,255,0.1)',
                  }}
                />
                <div className="flex items-center gap-2">
                  <img src="/logo-24.png" alt="" width={16} height={16} className="shrink-0" />
                  <span className="text-basalt-primary-foreground text-sm font-semibold">
                    Meowth
                  </span>
                </div>
                <span className="text-basalt-primary-foreground/60 text-[10px] font-medium tracking-widest uppercase">
                  Setup
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-basalt-primary-foreground/40 font-mono text-[9px] tracking-wider">
                  ID {year}-{today.slice(4)}
                </span>
                <div className="h-6">
                  <Barcode />
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-6 pb-14">
              <h1 className="sr-only">Meowth - Setup</h1>
              <div className="bg-basalt-secondary ring-basalt-border flex h-24 w-24 items-center justify-center overflow-hidden rounded-full p-5 ring-1">
                <img
                  src="/logo-80.png"
                  alt=""
                  width={56}
                  height={56}
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="bg-basalt-border mt-5 h-px w-full" />
              <div className="flex-1" />

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
                  <Button type="submit" className="w-full rounded-xl py-3" loading={submitting}>
                    {submitting ? 'Continuing...' : 'Continue'}
                  </Button>
                  <div className="pt-1 text-center">
                    <p className="text-basalt-muted-foreground text-xs">Don't have a token yet?</p>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto text-xs"
                      onClick={() => vm.setMode('mint')}
                    >
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
                    className="w-full rounded-xl py-3"
                    loading={submitting}
                    disabled={vm.mintDisabled}
                  >
                    {submitting ? 'Minting...' : 'Mint token'}
                  </Button>
                  {vm.mintDisabled && vm.mintDisabledReason ? (
                    <Notice variant="info">{vm.mintDisabledReason}</Notice>
                  ) : null}
                  <div className="pt-1 text-center">
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto text-xs"
                      onClick={() => vm.setMode('token')}
                    >
                      Back to "I already have a token"
                    </Button>
                  </div>
                </form>
              )}
            </div>

            <div className="border-basalt-border bg-basalt-secondary/50 absolute right-0 bottom-0 left-0 flex items-center justify-center border-t py-2.5">
              <div className="flex items-center gap-1.5">
                <div className="bg-basalt-heatmap-green-3 motion-reduce:animate-none h-1.5 w-1.5 animate-pulse rounded-full" />
                <span className="text-basalt-muted-foreground text-[10px]">
                  Local daemon sign-in
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
