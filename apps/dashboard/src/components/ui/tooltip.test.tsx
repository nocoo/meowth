import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

describe('Tooltip (G1 smoke)', () => {
  it('renders Provider + Trigger + Content with open via defaultOpen', () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">trigger-button</button>
          </TooltipTrigger>
          <TooltipContent>tooltip-body-text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'trigger-button' })).toBeInTheDocument();
    expect(screen.getAllByText('tooltip-body-text').length).toBeGreaterThan(0);
  });
});
