import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentType } from '@/models/agents';
import type { Agent } from '@/models/types';

// docs/features/03 §4.4 — list `installed === true` agents only.
// Streaming does NOT disable the picker; per §8 the parent
// viewmodel reacts to a switch by aborting + clearing turns.
// `disabled` is reserved for parent-driven states (loading, zero
// installed agents) and is independent of streaming.

export interface AgentPickerProps {
  agents: readonly Agent[];
  selectedAgent: AgentType | null;
  onChange: (next: AgentType) => void;
  disabled?: boolean;
}

export default function AgentPicker({
  agents,
  selectedAgent,
  onChange,
  disabled = false,
}: AgentPickerProps) {
  const installed = agents.filter((a) => a.installed);
  // Keep Radix's <Select> controlled even when nothing is picked.
  // A remount-driven null (refresh that uninstalls the previous
  // agent, see task #16) must visibly clear the trigger label
  // rather than fall back to Radix's last-known internal value.
  // Radix treats `value=""` as "no item matches" and falls through
  // to the placeholder; `SelectItem.value` can never be empty, so
  // the empty string is safe as a clear-marker. `onValueChange`
  // never fires with `""` because no item carries that value.

  return (
    <Select
      value={selectedAgent ?? ''}
      onValueChange={(next) => {
        if (next === '') return;
        onChange(next as AgentType);
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label="Backend agent" className="w-40">
        <SelectValue placeholder="Select an agent" />
      </SelectTrigger>
      <SelectContent>
        {installed.map((a) => (
          <SelectItem key={a.type} value={a.type}>
            {a.type}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
