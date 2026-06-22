// docs/architecture/06 §6.3 / §7.3 — Session detail viewmodel.
// Skeleton echoes the path param so the page can prove the id
// reaches here; 3.18+ will swap this for sessions.getSession(id)
// + followSessionMessages(id, ...).

export interface SessionDetailViewModel {
  status: 'idle';
  sessionId: string;
  session: null;
  messages: readonly unknown[];
}

export default function useSessionDetailViewModel(sessionId: string): SessionDetailViewModel {
  return {
    status: 'idle',
    sessionId,
    session: null,
    messages: [],
  };
}
