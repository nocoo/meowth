import { Github } from '@/components/icons/github';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { displayLabel } from '@/lib/labels';
import type { Agent, AgentType } from '@/viewmodels/useChatViewModel';
import { CodeXml, Compass, Pi, Sparkles } from 'lucide-react';
import { useId } from 'react';

const AGENT_PRESENTATION = {
  claude: { icon: Sparkles, description: 'Anthropic · Claude Code' },
  codex: { icon: CodeXml, description: 'OpenAI · Codex' },
  copilot: { icon: Github, description: 'GitHub · Copilot CLI' },
  hermes: { icon: Compass, description: 'Nous Research · Hermes' },
  pi: { icon: Pi, description: 'Pi coding agent' },
};

export interface AgentPickerProps {
  agents: readonly Agent[];
  selectedAgent: AgentType | null;
  onChange: (next: AgentType) => void;
  disabled?: boolean;
  hasMessages?: boolean;
}

export default function AgentPicker({
  agents,
  selectedAgent,
  onChange,
  disabled = false,
  hasMessages = false,
}: AgentPickerProps) {
  const pickerId = useId();
  return (
    <Select
      value={selectedAgent ?? ''}
      onValueChange={(next) => onChange(next as AgentType)}
      disabled={disabled}
    >
      <SelectTrigger aria-label="Choose agent" className="chat-agent-trigger">
        <SelectValue placeholder="Select an agent">
          {selectedAgent ? displayLabel(selectedAgent) : 'Select an agent'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="chat-agent-menu" align="start" collisionPadding={12}>
        <SelectGroup>
          <SelectLabel className="px-3 pt-2.5 pb-2 text-xs font-medium">
            Choose an agent
          </SelectLabel>
          {agents
            .filter((agent) => agent.installed)
            .map((agent) => {
              const { icon: Icon, description } = AGENT_PRESENTATION[agent.type];
              const name = displayLabel(agent.type);
              return (
                <SelectItem
                  key={agent.type}
                  value={agent.type}
                  textValue={name}
                  aria-labelledby={`${pickerId}-${agent.type}-name`}
                  aria-describedby={`${pickerId}-${agent.type}-description`}
                  className="chat-agent-option rounded-xl px-3 py-3"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-basalt-border/60 bg-basalt-secondary text-basalt-foreground">
                      <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span id={`${pickerId}-${agent.type}-name`} className="text-sm font-medium">
                        {name}
                      </span>
                      <span
                        id={`${pickerId}-${agent.type}-description`}
                        className="text-xs text-basalt-muted-foreground"
                      >
                        {description}
                      </span>
                    </span>
                  </span>
                </SelectItem>
              );
            })}
        </SelectGroup>
        <div className="mx-2 mt-1 space-y-1 border-t border-basalt-border/60 px-1 pt-3 pb-2 text-[11px] leading-4 text-basalt-muted-foreground">
          <p>Uses each agent's configured model.</p>
          {hasMessages ? <p>Switching agents starts a new chat.</p> : null}
        </div>
      </SelectContent>
    </Select>
  );
}
