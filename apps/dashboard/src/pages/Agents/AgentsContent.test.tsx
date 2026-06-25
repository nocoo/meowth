import type { Agent } from '@/models/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AgentsContent from './AgentsContent';

function makeAgents(over: Partial<Agent>[] = []): Agent[] {
  return over.map((o, i) => ({
    type: 'claude',
    installed: true,
    executable: `/x${i}`,
    version: '1',
    ...o,
  }));
}

describe('AgentsContent (Stage C2)', () => {
  it('renders a 4-column table when agents are present', () => {
    render(
      <AgentsContent
        agents={makeAgents([
          { type: 'claude', installed: true, executable: '/c', version: '1' },
          { type: 'codex', installed: false, executable: '', version: '' },
        ])}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Installed' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Executable' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Version' })).toBeInTheDocument();
  });

  it('renders one row per agent with cell-level values', () => {
    render(
      <AgentsContent
        agents={makeAgents([
          { type: 'claude', installed: true, executable: '/c', version: '1' },
          { type: 'codex', installed: false, executable: '', version: '' },
        ])}
      />,
    );
    expect(screen.getByRole('cell', { name: 'claude' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'codex' })).toBeInTheDocument();
  });

  it('maps installed booleans to "yes" / "no" cell text', () => {
    render(
      <AgentsContent
        agents={makeAgents([
          { type: 'claude', installed: true, executable: '/c', version: '1' },
          { type: 'pi', installed: false, executable: '', version: '' },
        ])}
      />,
    );
    expect(screen.getByRole('cell', { name: 'yes' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'no' })).toBeInTheDocument();
  });

  it('shows an EmptyState (not the table) when no agents are reported', () => {
    render(<AgentsContent agents={[]} />);
    expect(screen.getByText('No agents installed')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Type' })).not.toBeInTheDocument();
  });

  it('wraps the populated table in a rounded-card bg-secondary L2 surface', () => {
    const { container } = render(
      <AgentsContent
        agents={makeAgents([{ type: 'claude', installed: true, executable: '/c', version: '1' }])}
      />,
    );
    // The L2 wrap is the parent of the table-container div (added by Commit 2).
    const wrap = container.querySelector('.rounded-card.bg-secondary');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('[data-slot="table-container"]')).not.toBeNull();
  });
});
