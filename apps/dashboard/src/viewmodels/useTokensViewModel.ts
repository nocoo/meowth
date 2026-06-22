// docs/architecture/06 §6.3 / §7.4 — Tokens viewmodel skeleton.
// 3.18+ will wire tokens.listTokens / createToken / revokeToken
// and the createdSecret transient state (§7.4 modal flow).

export interface TokensViewModel {
  status: 'idle';
  tokens: readonly unknown[];
  createdSecret: string | null;
}

export default function useTokensViewModel(): TokensViewModel {
  return {
    status: 'idle',
    tokens: [],
    createdSecret: null,
  };
}
