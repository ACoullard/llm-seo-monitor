// Scheduler — determines which prompts are due based on their cron expressions
// and the last time they were run.
//
// Usage: call `getDuePrompts()` and execute each one, then record the run
// so the next call won't re-execute too soon.

import parseInterval from 'cron-parser';
import { getRuns } from './db.js';
import { getActivePrompts } from './config.js';
import type { PromptConfig } from './types.js';

/**
 * Determine whether a cron expression means a prompt is due right now,
 * given the timestamp of its last run.
 *
 * A prompt is considered due when the most recent cron interval *before now*
 * falls after the last run (or there has been no run yet).
 */
export function isDue(
  scheduleCron: string,
  lastRunAt: Date | null,
  now = new Date(),
): boolean {
  try {
    const interval = parseInterval.parseExpression(scheduleCron, {
      currentDate: now,
      utc: true,
    });

    // prev() gives the most recent scheduled time that has already passed
    const prev = interval.prev().toDate();

    if (!lastRunAt) return true; // never run → always due
    return prev > lastRunAt;
  } catch {
    // Bad cron expression — skip gracefully
    return false;
  }
}

/**
 * Return all active prompts whose schedules are due.
 * Prompts without a schedule_cron are considered manually-triggered only
 * and are never returned here.
 */
export function getDuePrompts(configPath?: string): PromptConfig[] {
  const prompts = getActivePrompts(configPath);
  const now = new Date();

  return prompts.filter((prompt) => {
    if (!prompt.schedule_cron) return false;

    // Find the most recent run for this prompt
    const runs = getRuns(prompt.id, 1);
    const lastRunAt = runs.length > 0 ? new Date(runs[0].executed_at) : null;

    return isDue(prompt.schedule_cron, lastRunAt, now);
  });
}
