// Core types for the standalone LLM SEO monitor

export type RuleType = 'binary' | 'ranking' | 'sentiment';

export interface TargetConfig {
  model: string;
  use_search: boolean;
}

export interface RuleConfig {
  name: string;
  description: string;
  type: RuleType;
}

export interface PromptConfig {
  id: string;
  query_text: string;
  /** Optional cron expression, e.g. "0 9 * * 1" (every Monday at 9am) */
  schedule_cron?: string;
  is_active: boolean;
  targets: TargetConfig[];
  rules: RuleConfig[];
}

// ---- Database row shapes ----

export interface Run {
  id: string;
  prompt_id: string;
  model_used: string;
  web_search_enabled: 0 | 1;
  response_text: string;
  token_usage_input: number;
  token_usage_output: number;
  executed_at: string;
}

export interface Evaluation {
  id: string;
  run_id: string;
  rule_name: string;
  rule_type: RuleType;
  score: number;
  reasoning: string;
  created_at: string;
}

// ---- Runtime result shapes ----

export interface ExecutionResult {
  response: string;
  tokenUsage: { input: number; output: number };
}

export interface JudgeResult {
  score: number;
  reasoning: string;
}
