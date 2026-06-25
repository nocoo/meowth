import type { AgentsViewModel } from '@/viewmodels/useAgentsViewModel';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsPage from './AgentsPage';

// Page shell tests for Phase 2 Stage C2. Mocks
// `useAgentsViewModel` directly so the test does not depend on
// fetch ordering (reviewer correction #2).

const { mockUseAgents } = vi.hoisted(() => ({ mockUseAgents: vi.fn() }));

vi.mock('@/viewmodels/useAgentsViewModel', () => ({
  default: () => mockUseAgents() as AgentsViewModel,
}));

beforeEach(() => {
  window.localStorage.clear();
  mockUseAgents.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function vm(status: AgentsViewModel['status']): AgentsViewModel {
  return {
    status,
    refresh: () => {
      /* noop */
    },
  };
}

describe('AgentsPage (shell, Stage C2)', () => {
  it('always renders the Agents heading', () => {
    mockUseAgents.mockReturnValue(vm({ kind: 'loading' }));
    render(<AgentsPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeInTheDocument();
  });

  it('loading branch shows the AgentsSkeleton (5 row × 4 col placeholders)', () => {
    mockUseAgents.mockReturnValue(vm({ kind: 'loading' }));
    const { container } = render(<AgentsPage />);
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(5 * 4);
    expect(screen.queryByText('claude')).not.toBeInTheDocument();
  });

  it('error branch routes to EmptyState (tone="error") with the vm message', () => {
    mockUseAgents.mockReturnValue(vm({ kind: 'error', message: 'agents-boom' }));
    render(<AgentsPage />);
    expect(screen.getByText('Agents unavailable')).toBeInTheDocument();
    expect(screen.getByText('agents-boom')).toBeInTheDocument();
  });

  it('ready branch hands the agents list to AgentsContent', () => {
    mockUseAgents.mockReturnValue(
      vm({
        kind: 'ready',
        agents: [
          { type: 'claude', installed: true, executable: '/c', version: '1' },
          { type: 'codex', installed: false, executable: '', version: '' },
        ],
      }),
    );
    render(<AgentsPage />);
    expect(screen.getByRole('cell', { name: 'claude' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'codex' })).toBeInTheDocument();
  });
});
