import type { OverviewData } from '@/viewmodels/useOverviewViewModel';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OverviewContent from './OverviewContent';

function makeData(over: Partial<OverviewData> = {}): OverviewData {
  return {
    health: { ok: true },
    tokens: [],
    sessions: [],
    agents: [],
    ...over,
  };
}

describe('OverviewContent (Stage C1)', () => {
  it('renders Daemon=Reachable when health.ok=true', () => {
    render(<OverviewContent data={makeData({ health: { ok: true } })} />);
    expect(screen.getByText('Daemon')).toBeInTheDocument();
    expect(screen.getByText('Reachable')).toBeInTheDocument();
  });

  it('renders Daemon=Unknown when health is null', () => {
    render(<OverviewContent data={makeData({ health: null })} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('renders Tokens count from tokens.length', () => {
    render(
      <OverviewContent
        data={makeData({
          tokens: [
            { id: 't1', name: 'a', prefix: 'mwt_A', created_at: 'x', created_via: 'init' },
            { id: 't2', name: 'b', prefix: 'mwt_B', created_at: 'y', created_via: 'dashboard' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders Recent sessions count from sessions.length', () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({
      id: `s${i}`,
      backend_type: 'claude' as const,
      backend_session_id: `bs${i}`,
      status: 'completed' as const,
      started_at: 'x',
      ended_at: null,
      thread_name: '',
      model: '',
    }));
    render(<OverviewContent data={makeData({ sessions })} />);
    expect(screen.getByText('Recent sessions')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('renders "installed / total" for Agents installed tile', () => {
    render(
      <OverviewContent
        data={makeData({
          agents: [
            { type: 'claude', installed: true, executable: '/c', version: '1' },
            { type: 'copilot', installed: false, executable: '', version: '' },
            { type: 'codex', installed: true, executable: '/x', version: '2' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Agents installed')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
});
