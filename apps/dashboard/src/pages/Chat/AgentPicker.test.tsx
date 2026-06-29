import type { Agent } from '@/models/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AgentPicker from './AgentPicker';

// Five agents: 3 installed, 2 not. Tests assert that AgentPicker
// passes through only `installed === true` to the SelectContent.

const AGENTS: readonly Agent[] = [
  { type: 'claude', installed: true, executable: '/usr/bin/claude', version: '1.0.0' },
  { type: 'copilot', installed: true, executable: '/usr/bin/copilot', version: '0.9.0' },
  { type: 'codex', installed: false, executable: '', version: '' },
  { type: 'hermes', installed: true, executable: '/usr/bin/hermes', version: '1.2.3' },
  { type: 'pi', installed: false, executable: '', version: '' },
];

describe('AgentPicker', () => {
  it('lists only installed=true agents in the dropdown', () => {
    render(<AgentPicker agents={AGENTS} selectedAgent={null} onChange={() => undefined} />);
    // Open the dropdown to inspect options.
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryAllByText('claude').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('copilot').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('hermes').length).toBeGreaterThan(0);
    // Excluded — must not appear as an option anywhere.
    expect(screen.queryByText('codex')).toBeNull();
    expect(screen.queryByText('pi')).toBeNull();
  });

  it('shows the selected agent in the trigger label', () => {
    render(<AgentPicker agents={AGENTS} selectedAgent="claude" onChange={() => undefined} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('claude');
  });

  it('shows the placeholder when selectedAgent is null', () => {
    render(<AgentPicker agents={AGENTS} selectedAgent={null} onChange={() => undefined} />);
    expect(screen.getByText('Select an agent')).toBeInTheDocument();
  });

  it('invokes onChange when the user picks an option', () => {
    const onChange = vi.fn();
    render(<AgentPicker agents={AGENTS} selectedAgent={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    // Pick `hermes` — must be visible because it's installed.
    const option = screen.getByRole('option', { name: 'hermes' });
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hermes');
  });

  it('does not open the dropdown when disabled=true', () => {
    const onChange = vi.fn();
    render(<AgentPicker agents={AGENTS} selectedAgent={null} onChange={onChange} disabled />);
    // The trigger should not open; if it did, options would appear.
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'claude' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rerender from selectedAgent=<x> back to null → trigger clears to placeholder', () => {
    // Locks the controlled-Select fix: when the parent flips
    // selectedAgent to null (e.g. refresh sees the previously
    // selected agent has been uninstalled, see task #16), the
    // trigger must visibly clear instead of holding the prior
    // label as Radix's last-known internal value.
    const { rerender } = render(
      <AgentPicker agents={AGENTS} selectedAgent="claude" onChange={() => undefined} />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('claude');
    rerender(<AgentPicker agents={AGENTS} selectedAgent={null} onChange={() => undefined} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).not.toHaveTextContent('claude');
    expect(screen.getByText('Select an agent')).toBeInTheDocument();
  });
});
