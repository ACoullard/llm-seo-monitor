// Executor — runs a prompt against each configured target model,
// saves results to the local SQLite database, and then triggers the judge.

import { insertRun } from './db.js';
import { judgeRun } from './judge.js';
import { OpenRouterClient } from './openrouter.js';
import type { PromptConfig, Run } from './types.js';

export interface ExecutorOptions {
  /** OpenRouter API key (defaults to OPENROUTER_API_KEY env var) */
  apiKey?: string;
  /** Search context size for web-search-enabled targets */
  searchContextSize?: 'low' | 'medium' | 'high';
  /** Whether to run the judge after execution (default: true) */
  runJudge?: boolean;
  /** Optional logger (defaults to console) */
  log?: (msg: string) => void;
}

export interface TargetResult {
  model: string;
  success: boolean;
  runId?: string;
  error?: string;
}

/**
 * Execute a prompt config against all its targets, persisting runs and
 * triggering the judge for each successful run.
 *
 * @returns Array of per-target results.
 */
export async function executePrompt(
  prompt: PromptConfig,
  options: ExecutorOptions = {},
): Promise<TargetResult[]> {
  const {
    apiKey = process.env.OPENROUTER_API_KEY,
    searchContextSize = 'medium',
    runJudge = true,
    log = (msg: string) => console.log(`[executor] ${msg}`),
  } = options;

  if (!apiKey) {
    throw new Error(
      'No OpenRouter API key provided. Set OPENROUTER_API_KEY in your .env file ' +
      'or pass apiKey in options.',
    );
  }

  const client = new OpenRouterClient(apiKey);
  const results: TargetResult[] = [];

  for (const target of prompt.targets) {
    log(`Running model: ${target.model} (web_search=${target.use_search})`);

    try {
      const execResult = await client.executePrompt(
        prompt.query_text,
        target.model,
        target.use_search,
        searchContextSize,
      );

      log(
        `  ✓ ${target.model} — ${execResult.tokenUsage.input}/${execResult.tokenUsage.output} tokens`,
      );

      const run: Run = insertRun(
        prompt.id,
        target.model,
        target.use_search,
        execResult.response,
        execResult.tokenUsage.input,
        execResult.tokenUsage.output,
      );

      results.push({ model: target.model, success: true, runId: run.id });

      if (runJudge && prompt.rules.length > 0) {
        log(`  Judging run ${run.id} against ${prompt.rules.length} rule(s)...`);
        await judgeRun(run, prompt.rules, { apiKey, log });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  ✗ ${target.model} — ${message}`);
      results.push({ model: target.model, success: false, error: message });
    }
  }

  return results;
}
