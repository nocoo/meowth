import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from './avatar';

describe('Avatar (G1 smoke)', () => {
  it('renders Avatar root with Fallback when image is absent', () => {
    render(
      <Avatar>
        <AvatarImage alt="" src="" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('AB')).toBeInTheDocument();
  });

  it('renders AvatarBadge as a span next to the avatar', () => {
    render(
      <Avatar>
        <AvatarFallback>CD</AvatarFallback>
        <AvatarBadge data-testid="avatar-badge">online</AvatarBadge>
      </Avatar>,
    );
    expect(screen.getByTestId('avatar-badge')).toBeInTheDocument();
  });

  it('renders AvatarGroup with GroupCount slot', () => {
    render(
      <AvatarGroup>
        <Avatar>
          <AvatarFallback>EF</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>,
    );
    expect(screen.getByText('EF')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });
});
