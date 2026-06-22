import useSessionDetailViewModel from '@/viewmodels/useSessionDetailViewModel';
import { useParams } from 'react-router';

// docs/architecture/06 §7.3 — Session detail page.
// Reads :id from the path and hands it to the viewmodel; 3.18+
// will trigger sessions.getSession(id) + followSessionMessages.
// When the path param is missing we render an empty body and
// surface a stable accessible heading; 3.18 routing guards will
// redirect away from the bad URL.

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? '';
  const vm = useSessionDetailViewModel(sessionId);
  return (
    <section aria-labelledby="session-detail-heading" className="space-y-2">
      <h2 id="session-detail-heading" className="text-xl font-semibold">
        Session
      </h2>
      <p className="text-muted-foreground font-mono text-xs" data-testid="session-detail-id">
        {vm.sessionId}
      </p>
      <p className="text-muted-foreground text-sm">No data yet.</p>
    </section>
  );
}
