import { Notice } from '@/components/ui/notice';
import type { SettingsStatus } from '@/viewmodels/useSettingsViewModel';

// docs/architecture/06 §7.5 + features/02 §4.4 — Phase 2 Stage C5.
// Pure-props Content for Settings (read-only v1). Owns the
// healthz Notice (ready+reachable → success; ready+unreachable →
// warning [polite]; error → destructive with role=alert) and the
// bottom read-only daemon-config note. Loading is handled by
// Page/Skeleton; this component never receives kind: 'loading'.
//
// Note on the typed error branch: today useSettingsViewModel
// converts ordinary healthz failures into ready+unreachable, so
// status.kind === 'error' is reachable only via handleAuthError's
// non-401, non-Problem fallthroughs. The branch still has to
// render correctly here; we keep the assertion at the Page/Content
// level but do not change the VM behavior in C5.

export type SettingsResolvedStatus = Extract<SettingsStatus, { kind: 'ready' | 'error' }>;

export interface SettingsContentProps {
  status: SettingsResolvedStatus;
}

export default function SettingsContent({ status }: SettingsContentProps) {
  return (
    <>
      {status.kind === 'error' ? (
        <Notice variant="destructive" role="alert">
          {status.message}
        </Notice>
      ) : status.daemonReachable ? (
        <Notice variant="success">Daemon reachable.</Notice>
      ) : (
        <Notice variant="warning">Daemon unreachable.</Notice>
      )}
      <p className="text-muted-foreground text-xs">
        Daemon configuration (bind address, remote-access mode, log level) is not exposed in this
        page. Read <code>~/.meowth/config.toml</code> or the daemon startup log to inspect it.
      </p>
    </>
  );
}
