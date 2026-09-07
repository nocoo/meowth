import SessionStatusBadge from '@/components/SessionStatusBadge';
import StatCard from '@/components/StatCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { displayLabel } from '@/lib/labels';
import type { OverviewData } from '@/viewmodels/useOverviewViewModel';
import { LayerCard } from '@nocoo/basalt';
import { SectionRule } from '@nocoo/basalt/components/section-rule';
import { Activity, ArrowUpRight, Bot, KeyRound, ListTree, MessageSquare } from 'lucide-react';
import { Link } from 'react-router';

export interface OverviewContentProps {
  data: OverviewData;
}

export default function OverviewContent({ data }: OverviewContentProps) {
  const { health, tokens, sessions, agents } = data;
  const installed = agents.filter((agent) => agent.installed).length;
  const reachable = health?.ok === true;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard
          title="Daemon"
          icon={Activity}
          description="Local service connection"
          body={
            <Badge variant={reachable ? 'success' : 'warning'} dot>
              {reachable ? 'Reachable' : 'Unknown'}
            </Badge>
          }
        />
        <StatCard
          title="Tokens"
          icon={KeyRound}
          body={tokens.length}
          description="Access credentials"
        />
        <StatCard
          title="Recent sessions"
          icon={ListTree}
          body={sessions.length}
          description="Most recent agent runs"
        />
        <StatCard
          title="Agents installed"
          icon={Bot}
          body={`${installed} / ${agents.length}`}
          description="Local coding backends"
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-3" aria-label="Recent activity">
          <SectionRule
            title="Recent activity"
            actions={
              <Button asChild variant="ghost" size="xs">
                <Link to="/sessions">
                  View sessions
                  <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </Link>
              </Button>
            }
          />
          <LayerCard padding="none" outlined className="overflow-hidden">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <ListTree
                  className="h-6 w-6 text-basalt-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <p className="text-sm font-medium">No sessions yet</p>
                <p className="max-w-xs text-sm text-basalt-muted-foreground">
                  Start a conversation with a local agent to see activity here.
                </p>
                <Button asChild variant="outline" size="xs">
                  <Link to="/chat">
                    <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                    Open chat
                  </Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-basalt-border/60">
                {sessions.slice(0, 5).map((session) => (
                  <li key={session.id}>
                    <Link
                      to={`/sessions/${session.id}`}
                      className="flex min-w-0 items-center gap-3 px-5 py-4 transition-colors hover:bg-basalt-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-basalt-ring"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-basalt-widget bg-basalt-accent text-basalt-muted-foreground">
                        <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {session.thread_name || `${displayLabel(session.backend_type)} session`}
                        </p>
                        <p className="mt-1 truncate text-xs text-basalt-muted-foreground">
                          {displayLabel(session.backend_type)}
                          {session.model ? ` · ${session.model}` : ''}
                        </p>
                      </div>
                      <SessionStatusBadge status={session.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </LayerCard>
        </section>

        <section className="min-w-0 space-y-3" aria-label="Agent availability">
          <SectionRule
            title="Agent availability"
            actions={
              <Button asChild variant="ghost" size="xs">
                <Link to="/agents">
                  View agents
                  <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </Link>
              </Button>
            }
          />
          <LayerCard padding="none" outlined className="overflow-hidden">
            {agents.length === 0 ? (
              <p className="p-6 text-sm text-basalt-muted-foreground">No backends reported.</p>
            ) : (
              <ul className="divide-y divide-basalt-border/60">
                {agents.map((agent) => (
                  <li key={agent.type} className="flex items-center gap-3 px-5 py-3.5">
                    <Bot
                      className="h-4 w-4 shrink-0 text-basalt-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {displayLabel(agent.type)}
                    </span>
                    <Badge variant={agent.installed ? 'success' : 'outline'} dot>
                      {agent.installed ? 'Installed' : 'Not installed'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </LayerCard>
        </section>
      </div>
    </div>
  );
}
