// Judge — evaluates a completed run against a set of rules using an LLM.

import { insertEvaluation } from './db.js';
import { OpenRouterClient } from './openrouter.js';
import type { RuleConfig, Run } from './types.js';

export interface JudgeOptions {
  /** OpenRouter API key (defaults to OPENROUTER_API_KEY env var) */
  apiKey?: string;
  /**
   * Model used as judge. Defaults to JUDGE_MODEL env var or openai/gpt-5-nano.
   * Should be a fast, inexpensive model with good instruction-following ability.
   */
  judgeModel?: string;
  /** Optional logger */
  log?: (msg: string) => void;
}

/**
 * Evaluate every rule against the response stored in `run`,
 * persisting each evaluation to the database.
 */
export async function judgeRun(
  run: Run,
  rules: RuleConfig[],
  options: JudgeOptions = {},
): Promise<void> {
  const {
    apiKey = process.env.OPENROUTER_API_KEY,
    judgeModel = process.env.JUDGE_MODEL ?? 'openai/gpt-5-nano',
    log = (msg: string) => console.log(`[judge] ${msg}`),
  } = options;

  if (!apiKey) {
    log('No API key — skipping evaluation.');
    return;
  }

  if (!run.response_text) {
    log(`Run ${run.id} has no response text — skipping.`);
    return;
  }

  const client = new OpenRouterClient(apiKey);

  for (const rule of rules) {
    try {
      log(`  Evaluating rule "${rule.name}" (${rule.type})...`);

      const result = await client.judge(
        run.response_text,
        rule.description,
        rule.type,
        judgeModel,
      );

      insertEvaluation(
        run.id,
        rule.name,
        rule.type,
        result.score,
        result.reasoning,
      );

      log(`    → score: ${result.score}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`    ✗ Rule "${rule.name}" failed: ${message}`);
    }
  }
}
