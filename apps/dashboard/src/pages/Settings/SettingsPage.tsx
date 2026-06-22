import useSettingsViewModel from '@/viewmodels/useSettingsViewModel';

// docs/architecture/06 §7.5 — Settings page (read-only v1).
// Only shows healthz status + dashboard build version. Daemon
// config (bind / mode / log level) is intentionally not exposed
// because no /v1/settings endpoint exists.

export default function SettingsPage() {
  const vm = useSettingsViewModel();

  let healthLine: string;
  if (vm.status.kind === 'loading') {
    healthLine = 'Checking daemon...';
  } else if (vm.status.kind === 'error') {
    healthLine = vm.status.message;
  } else if (vm.status.daemonReachable) {
    healthLine = 'Daemon reachable.';
  } else {
    healthLine = 'Daemon unreachable.';
  }

  return (
    <section aria-labelledby="settings-heading" className="space-y-3">
      <h2 id="settings-heading" className="text-xl font-semibold">
        Settings
      </h2>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[auto,1fr]">
        <dt className="text-muted-foreground">Daemon</dt>
        <dd>{healthLine}</dd>
        <dt className="text-muted-foreground">Dashboard build</dt>
        <dd className="font-mono">{vm.version}</dd>
      </dl>
      <p className="text-muted-foreground text-xs">
        Daemon configuration (bind address, remote-access mode, log level) is not exposed in this
        page. Read <code>~/.meowth/config.toml</code> or the daemon startup log to inspect it.
      </p>
    </section>
  );
}
