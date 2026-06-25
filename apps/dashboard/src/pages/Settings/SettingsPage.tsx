import useSettingsViewModel from '@/viewmodels/useSettingsViewModel';
import SettingsContent from './SettingsContent';
import SettingsSkeleton from './SettingsSkeleton';

// docs/architecture/06 §7.5 + features/02 §4.4 — Phase 2 Stage C5.
// Page shell: owns the viewmodel + loading/error/ready branch.
// Heading and the Dashboard build row are always rendered — the
// build version is a compile-time constant, orthogonal to the
// healthz probe, so we surface its real value even while the
// daemon health is still loading.

export default function SettingsPage() {
  const vm = useSettingsViewModel();

  return (
    <section aria-labelledby="settings-heading" className="space-y-3">
      <h2 id="settings-heading" className="text-xl font-semibold">
        Settings
      </h2>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[auto,1fr]">
        <dt className="text-muted-foreground">Dashboard build</dt>
        <dd className="font-mono">{vm.version}</dd>
      </dl>
      {vm.status.kind === 'loading' ? <SettingsSkeleton /> : <SettingsContent status={vm.status} />}
    </section>
  );
}
