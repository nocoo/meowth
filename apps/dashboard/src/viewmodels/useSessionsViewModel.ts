// docs/architecture/06 §6.3 / §7.3 — Sessions list viewmodel.
// 3.18+ will wire sessions.listSessions(...); the skeleton just
// exposes the shape the page expects so MVVM boundaries hold.

export interface SessionsViewModel {
  status: 'idle';
  sessions: readonly unknown[];
}

export default function useSessionsViewModel(): SessionsViewModel {
  return {
    status: 'idle',
    sessions: [],
  };
}
