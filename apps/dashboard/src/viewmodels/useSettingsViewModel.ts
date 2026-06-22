// docs/architecture/06 §6.3 / §7.5 — Settings viewmodel skeleton.
// 3.18+ will wire health.pingHealthz(); the skeleton returns the
// 'idle' shape so the read-only Settings page can render with no
// daemon call.

export interface SettingsViewModel {
  status: 'idle';
  daemonReachable: null;
}

export default function useSettingsViewModel(): SettingsViewModel {
  return {
    status: 'idle',
    daemonReachable: null,
  };
}
