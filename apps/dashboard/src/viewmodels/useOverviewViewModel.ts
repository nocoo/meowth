// docs/architecture/06 §6.3 — viewmodel hook.
//
// 3.17 skeleton only: returns a stable placeholder shape so the
// page can render without depending on `models/` or `lib/api`,
// which land in 3.18+. The status field will graduate to a real
// 'loading' | 'ready' | 'error' machine once api wiring exists.

export interface OverviewViewModel {
  status: 'idle';
  health: null;
  tokens: readonly unknown[];
  sessions: readonly unknown[];
  agents: readonly unknown[];
}

export default function useOverviewViewModel(): OverviewViewModel {
  return {
    status: 'idle',
    health: null,
    tokens: [],
    sessions: [],
    agents: [],
  };
}
