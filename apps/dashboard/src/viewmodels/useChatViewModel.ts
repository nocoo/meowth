import { execAgent, fetchAgents } from '@/models/agents';
import type { AgentType } from '@/models/agents';
import {
  buildExecRequest,
  conversationSummaries,
  deriveTurnStatusFromEnvelopes,
  extractSessionId,
  latestResumeSessionId,
} from '@/models/chat';
import type { ChatConversation, ChatConversationSummary, ChatTurn } from '@/models/chat';
import { decodeChunk } from '@/models/envelope';
import type { Agent, Envelope } from '@/models/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import useAuthErrorHandler from './useAuthErrorHandler';

export type { AgentType } from '@/models/agents';
export type { ChatConversationSummary, ChatTurn, ChatTurnStatus } from '@/models/chat';
export type { Agent, Envelope } from '@/models/types';

export type ChatAgentsStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; agents: readonly Agent[] }
  | { kind: 'error'; message: string };

export interface ChatComposer {
  canSend: boolean;
  submit(prompt: string): void;
  cancel(): void;
}

export interface ChatViewModel {
  agentsStatus: ChatAgentsStatus;
  selectedAgent: AgentType | null;
  setSelectedAgent(agent: AgentType): void;
  conversations: readonly ChatConversationSummary[];
  activeConversationId: string | null;
  selectConversation(id: string): void;
  search: string;
  setSearch(value: string): void;
  turns: readonly ChatTurn[];
  resumeSessionId: string | null;
  composer: ChatComposer;
  newChat(): void;
  retry(): void;
  refresh(): void;
}

interface Workspace {
  conversations: readonly ChatConversation[];
  activeId: string | null;
}

function emptyConversation(agent: AgentType): ChatConversation {
  return { id: crypto.randomUUID(), agent, turns: [] };
}

function activateNew(workspace: Workspace, conversation: ChatConversation): Workspace {
  return {
    conversations: [
      ...workspace.conversations.filter((item) => item.turns.length > 0),
      conversation,
    ],
    activeId: conversation.id,
  };
}

export default function useChatViewModel(): ChatViewModel {
  const handleAuthError = useAuthErrorHandler();
  const [agentsStatus, setAgentsStatus] = useState<ChatAgentsStatus>({ kind: 'loading' });
  const [workspace, setWorkspace] = useState<Workspace>({ conversations: [], activeId: null });
  const [search, setSearch] = useState('');
  const [agentsNonce, setAgentsNonce] = useState(0);
  const controllers = useRef(new Map<string, AbortController>());
  const active = workspace.conversations.find((item) => item.id === workspace.activeId);
  const turns = active?.turns ?? [];
  const streaming = turns.at(-1)?.status === 'streaming';
  const installed =
    agentsStatus.kind === 'ready' ? agentsStatus.agents.filter((agent) => agent.installed) : [];
  const selectedAgent = active?.agent ?? null;
  const agentAvailable = installed.some((agent) => agent.type === selectedAgent);

  // biome-ignore lint/correctness/useExhaustiveDependencies: agentsNonce retries the availability probe.
  useEffect(() => {
    let cancelled = false;
    setAgentsStatus({ kind: 'loading' });
    fetchAgents()
      .then(({ agents }) => {
        if (cancelled) return;
        setAgentsStatus({ kind: 'ready', agents });
        const first = agents.find((agent) => agent.installed);
        const fresh = first ? emptyConversation(first.type) : null;
        setWorkspace((previous) => {
          const current = previous.conversations.find((item) => item.id === previous.activeId);
          if (current && agents.some((agent) => agent.installed && agent.type === current.agent))
            return previous;
          return fresh ? activateNew(previous, fresh) : { ...previous, activeId: null };
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = handleAuthError(error);
        if (message !== null) setAgentsStatus({ kind: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [handleAuthError, agentsNonce]);

  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, []);

  const updateTurn = useCallback(
    (conversationId: string, turnId: string, update: (turn: ChatTurn) => ChatTurn) => {
      setWorkspace((previous) => ({
        ...previous,
        conversations: previous.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                turns: conversation.turns.map((turn) => (turn.id === turnId ? update(turn) : turn)),
              }
            : conversation,
        ),
      }));
    },
    [],
  );

  const startTurn = useCallback(
    (prompt: string, retry = false) => {
      if (!active || !agentAvailable || prompt.trim() === '' || controllers.current.has(active.id))
        return;
      const conversationId = active.id;
      const retained = retry ? active.turns.slice(0, -1) : active.turns;
      const resumeId = latestResumeSessionId(retained);
      const controller = new AbortController();
      controllers.current.set(conversationId, controller);
      const turn: ChatTurn = {
        id: crypto.randomUUID(),
        sessionId: null,
        backendSessionId: null,
        userPrompt: prompt,
        envelopes: [],
        status: 'streaming',
        startedAt: new Date().toISOString(),
        endedAt: null,
      };
      setWorkspace((previous) => ({
        ...previous,
        conversations: previous.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, turns: [...retained, turn] }
            : conversation,
        ),
      }));
      const isCurrent = () => controllers.current.get(conversationId) === controller;

      void (async () => {
        let envelopes: Envelope[] = [];
        try {
          const stream = await execAgent(
            active.agent,
            buildExecRequest({ prompt, resumeSessionId: resumeId }),
            { signal: controller.signal },
          );
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const append = (text: string) => {
            const decoded = decodeChunk(buffer, text);
            buffer = decoded.remaining;
            if (decoded.envelopes.length === 0) return;
            envelopes = [...envelopes, ...decoded.envelopes];
            const snapshot = envelopes;
            updateTurn(conversationId, turn.id, (previous) => ({
              ...previous,
              envelopes: snapshot,
              sessionId: previous.sessionId ?? extractSessionId(snapshot),
            }));
          };
          try {
            while (isCurrent()) {
              const next = await reader.read();
              if (!isCurrent()) return;
              if (next.done) break;
              append(decoder.decode(next.value, { stream: true }));
            }
            if (!isCurrent()) return;
            append(decoder.decode());
          } finally {
            reader.releaseLock();
          }
          const terminal = deriveTurnStatusFromEnvelopes(envelopes);
          updateTurn(conversationId, turn.id, (previous) => ({
            ...previous,
            status: terminal?.status ?? 'network-aborted',
            backendSessionId: terminal?.backendSessionId ?? null,
            endedAt: new Date().toISOString(),
            ...(terminal ? {} : { error: 'The connection closed before the response finished.' }),
          }));
        } catch (error: unknown) {
          if (!isCurrent()) return;
          const terminal = deriveTurnStatusFromEnvelopes(envelopes);
          const message = terminal ? null : handleAuthError(error);
          updateTurn(conversationId, turn.id, (previous) => ({
            ...previous,
            status: terminal?.status ?? (isApiError(error) ? 'failed' : 'network-aborted'),
            backendSessionId: terminal?.backendSessionId ?? null,
            ...(terminal
              ? {}
              : { error: message ?? 'Your session expired. Sign in again to continue.' }),
            endedAt: new Date().toISOString(),
          }));
        } finally {
          if (isCurrent()) controllers.current.delete(conversationId);
        }
      })();
    },
    [active, agentAvailable, handleAuthError, updateTurn],
  );

  const cancel = useCallback(() => {
    if (!active) return;
    const controller = controllers.current.get(active.id);
    const last = active.turns.at(-1);
    if (!controller || !last) return;
    controllers.current.delete(active.id);
    controller.abort();
    updateTurn(active.id, last.id, (turn) => ({
      ...turn,
      status: 'aborted-by-client',
      endedAt: new Date().toISOString(),
    }));
  }, [active, updateTurn]);

  const newChat = () => {
    const agent = installed.find((item) => item.type === selectedAgent) ?? installed[0];
    if (!agent) return;
    const conversation = emptyConversation(agent.type);
    setWorkspace((previous) => activateNew(previous, conversation));
    setSearch('');
  };

  const setSelectedAgent = (agent: AgentType) => {
    if (agent === selectedAgent || !installed.some((item) => item.type === agent)) return;
    const fresh = emptyConversation(agent);
    setWorkspace((previous) => {
      const current = previous.conversations.find((item) => item.id === previous.activeId);
      if (current && current.turns.length === 0) {
        return {
          ...previous,
          conversations: previous.conversations.map((item) =>
            item.id === current.id ? { ...item, agent } : item,
          ),
        };
      }
      return activateNew(previous, fresh);
    });
    setSearch('');
  };

  const summaries = conversationSummaries(workspace.conversations);
  const query = search.trim().toLowerCase();

  return {
    agentsStatus,
    selectedAgent,
    setSelectedAgent,
    conversations: summaries.filter((item) =>
      `${item.title} ${item.agent}`.toLowerCase().includes(query),
    ),
    activeConversationId: workspace.activeId,
    selectConversation: (id) =>
      setWorkspace((previous) =>
        previous.conversations.some((item) => item.id === id)
          ? { ...previous, activeId: id }
          : previous,
      ),
    search,
    setSearch,
    turns,
    resumeSessionId: latestResumeSessionId(turns),
    composer: {
      canSend: agentAvailable && !streaming,
      submit: (prompt) => startTurn(prompt),
      cancel,
    },
    newChat,
    retry: () => {
      const last = turns.at(-1);
      if (last && last.status !== 'streaming' && last.status !== 'completed')
        startTurn(last.userPrompt, true);
    },
    refresh: () => setAgentsNonce((value) => value + 1),
  };
}
import { isApiError } from '@/lib/api';
