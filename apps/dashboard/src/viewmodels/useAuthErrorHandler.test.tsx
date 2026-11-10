import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiError } from '@/lib/api';
import useAuthErrorHandler from './useAuthErrorHandler';

function problem(status: number, title: string): ApiError {
  return {
    status,
    problem: { type: `/problems/${status}`, title, status },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('useAuthErrorHandler', () => {
  it('clears the token and returns null on 401', () => {
    window.localStorage.setItem('meowth_token', 'mwt_x');
    const { result } = renderHook(() => useAuthErrorHandler(), { wrapper });
    const message = result.current(problem(401, 'Unauthorized'));
    expect(message).toBeNull();
    expect(window.localStorage.getItem('meowth_token')).toBeNull();
  });

  it('returns the problem title for other ApiError statuses', () => {
    const { result } = renderHook(() => useAuthErrorHandler(), { wrapper });
    expect(result.current(problem(409, 'Conflict'))).toBe('Conflict');
  });

  it('returns the daemon-unreachable string for network rejections', () => {
    const { result } = renderHook(() => useAuthErrorHandler(), { wrapper });
    expect(result.current(new TypeError('Failed to fetch'))).toMatch(/unreachable/i);
  });
});
