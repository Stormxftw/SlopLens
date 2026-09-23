export type Provider = 'Codex' | 'Claude Code';

export interface TokenUsage {
  input: number;
  cachedInput: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
}

export interface ModelUsage {
  provider: Provider;
  model: string;
  usage: TokenUsage;
  tokens: number;
  estimatedUsd: number | null;
  priceKnown: boolean;
}

export interface SessionSummary {
  id: string;
  provider: Provider;
  startedAt: string | null;
  endedAt: string | null;
  activeMs: number;
  activePartial: boolean;
  spanMs: number | null;
  tokens: number;
  usageMissing: boolean;
  estimatedUsd: number;
  unpricedTokens: number;
  models: string[];
}

export interface LanguageSummary {
  name: string;
  lines: number;
  files: number;
}

export interface CodeMetrics {
  status: 'ready' | 'missing' | 'partial';
  lines: number | null;
  files: number | null;
  languages: LanguageSummary[];
  note?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  isGit: boolean;
  lastCommitAt: string | null;
  lastAgentAt: string | null;
  providers: Provider[];
  sessionCount: number;
  tokens: number;
  usageMissing: boolean;
  estimatedUsd: number;
  unpricedTokens: number;
  activeMs: number;
  activePartial: boolean;
  spanMs: number;
  spanPartial: boolean;
  code: CodeMetrics;
  models: ModelUsage[];
  sessions: SessionSummary[];
}

export interface DashboardData {
  generatedAt: string;
  pricingAsOf: string;
  projects: ProjectSummary[];
  sources: { provider: Provider; files: number; errors: number }[];
}
