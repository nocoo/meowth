import useSettingsViewModel from '@/viewmodels/useSettingsViewModel';

// docs/architecture/06 §7.5 — Settings page (read-only in v1).
// Skeleton renders the daemon-reachable status placeholder;
// 3.18+ wires health.pingHealthz(). No daemon config (bind /
// remote_access mode / log level) is shown by design (06 §7.5).

export default function SettingsPage() {
  const vm = useSettingsViewModel();
  return (
    <section aria-labelledby="settings-heading" className="space-y-2">
      <h2 id="settings-heading" className="text-xl font-semibold">
        Settings
      </h2>
      <p className="text-muted-foreground text-sm">
        {vm.daemonReachable === null
          ? 'No data yet.'
          : vm.daemonReachable
            ? 'Daemon reachable.'
            : 'Daemon unreachable.'}
      </p>
    </section>
  );
}
