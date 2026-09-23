import type { Provider, TokenUsage } from '../src/types.ts';

export const PRICING_AS_OF = '2026-09-23';
export const PRICING_SOURCES = {
  openai: 'https://developers.openai.com/api/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
};

// USD per million tokens. These are public, standard API-equivalent prices,
// not a record of subscription spend, negotiated rates, or tool charges.
interface Rate { input: number; cached: number; write5m: number; write1h?: number; output: number }
const RATES: Record<string, Rate> = {
  'Codex:gpt-6-astra': { input: 10, cached: 1, write5m: 12.5, output: 50 },
  'Codex:gpt-6-sol': { input: 2, cached: 0.2, write5m: 2.5, output: 10 },
  'Codex:gpt-6-luna': { input: 0.1, cached: 0.01, write5m: 0.125, output: 0.5 },
  'Codex:gpt-5.6-sol': { input: 4, cached: 0.4, write5m: 5, output: 20 },
  'Claude Code:claude-sonnet-5': { input: 2, cached: 0.2, write5m: 2.5, write1h: 4, output: 10 },
  'Claude Code:claude-sonnet-4-6': { input: 3, cached: 0.3, write5m: 3.75, write1h: 6, output: 15 },
  'Claude Code:claude-sonnet-4-5-20250929': { input: 3, cached: 0.3, write5m: 3.75, write1h: 6, output: 15 },
  'Claude Code:claude-opus-4-7': { input: 5, cached: 0.5, write5m: 6.25, write1h: 10, output: 25 },
  'Claude Code:claude-opus-4-6': { input: 5, cached: 0.5, write5m: 6.25, write1h: 10, output: 25 },
  'Claude Code:claude-opus-4-5-20251101': { input: 5, cached: 0.5, write5m: 6.25, write1h: 10, output: 25 },
  'Claude Code:claude-haiku-4-5-20251001': { input: 1, cached: 0.1, write5m: 1.25, write1h: 2, output: 5 },
};

export const emptyUsage = (): TokenUsage => ({ input: 0, cachedInput: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0 });

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    output: a.output + b.output,
  };
}

export function tokenTotal(u: TokenUsage): number {
  return u.input + u.cachedInput + u.cacheWrite5m + u.cacheWrite1h + u.output;
}

export function estimateUsd(provider: Provider, model: string, u: TokenUsage): number | null {
  const rate = RATES[`${provider}:${model}`];
  if (!rate || (u.cacheWrite1h > 0 && rate.write1h === undefined)) return null;
  return (u.input * rate.input + u.cachedInput * rate.cached + u.cacheWrite5m * rate.write5m
    + u.cacheWrite1h * (rate.write1h ?? 0) + u.output * rate.output) / 1_000_000;
}

export function knownRate(provider: Provider, model: string): boolean {
  return `${provider}:${model}` in RATES;
}
