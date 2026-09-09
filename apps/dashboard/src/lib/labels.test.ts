import { describe, expect, it } from 'vitest';
import { chatStatusLabel, displayLabel } from './labels';

describe('displayLabel', () => {
  it('sentence-cases underscored values', () => {
    expect(displayLabel('session_ended')).toBe('Session ended');
  });
});

describe('chatStatusLabel', () => {
  it('maps streaming and abort statuses', () => {
    expect(chatStatusLabel('streaming')).toBe('Responding');
    expect(chatStatusLabel('aborted-by-client')).toBe('Stopped');
    expect(chatStatusLabel('network-aborted')).toBe('Connection lost');
  });

  it('falls back to displayLabel', () => {
    expect(chatStatusLabel('completed')).toBe('Completed');
  });
});
