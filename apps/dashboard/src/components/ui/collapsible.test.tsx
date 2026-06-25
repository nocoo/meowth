import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

describe('Collapsible (G1 smoke)', () => {
  it('renders Trigger and shows Content when defaultOpen', () => {
    render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger asChild>
          <button type="button">toggle</button>
        </CollapsibleTrigger>
        <CollapsibleContent>collapsible-body</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.getByRole('button', { name: 'toggle' })).toBeInTheDocument();
    expect(screen.getByText('collapsible-body')).toBeInTheDocument();
  });

  it('omits Content when closed (defaultOpen=false)', () => {
    render(
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button type="button">closed-toggle</button>
        </CollapsibleTrigger>
        <CollapsibleContent>hidden-body</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.queryByText('hidden-body')).not.toBeInTheDocument();
  });
});
