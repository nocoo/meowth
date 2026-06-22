// docs/architecture/06 §6.3 / §7.2 — Agents viewmodel skeleton.
// 3.18+ will replace this with a real models/agents.fetchAgents()
// call. v1 skeleton returns an empty agent list so the page can
// render without daemon round-trips.

export interface AgentsViewModel {
  status: 'idle';
  agents: readonly unknown[];
}

export default function useAgentsViewModel(): AgentsViewModel {
  return {
    status: 'idle',
    agents: [],
  };
}
