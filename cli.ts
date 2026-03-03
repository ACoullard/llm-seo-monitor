#!/usr/bin/env node
// LLM SEO Monitor CLI
// Run with: npx tsx cli.ts <command>
// Or after building: node dist/cli.js <command>

import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { writeFileSync } from 'fs';
import path from 'path';

// Load .env before anything that reads environment variables
loadEnv();

import { getEvaluationsForRun, getRuns, getRunById } from './src/db.js';
import { executePrompt } from './src/executor.js';
import { judgeRun } from './src/judge.js';
import { getActivePrompts, getPromptById, loadPrompts } from './src/config.js';
import { getDuePrompts } from './src/scheduler.js';
import {
  generateHtmlReport,
  printRunDetail,
  printRunsSummary,
} from './src/reporter.js';
import type { Evaluation, Run } from './src/types.js';

const program = new Command();

program
  .name('monitor')
  .description('Lightweight local LLM SEO testing tool')
  .version('1.0.0');

// ---- list ----

program
  .command('list')
  .description('List all prompts defined in prompts.json')
  .option('-c, --config <path>', 'Path to prompts config file', 'prompts.json')
  .action((opts) => {
    const prompts = loadPrompts(opts.config);
    if (prompts.length === 0) {
      console.log('No prompts found in config.');
      return;
    }
    console.log(`\nFound ${prompts.length} prompt(s):\n`);
    for (const p of prompts) {
      const status = p.is_active ? '✓ active' : '⏸ paused';
      const schedule = p.schedule_cron ?? 'manual only';
      console.log(`  [${status}] ${p.id}`);
      console.log(`           query   : ${truncate(p.query_text, 70)}`);
      console.log(`           schedule: ${schedule}`);
      console.log(`           targets : ${p.targets.map((t) => t.model).join(', ')}`);
      console.log(`           rules   : ${p.rules.length}`);
      console.log();
    }
  });

// ---- run ----

program
  .command('run <promptId>')
  .description('Execute a prompt immediately by ID')
  .option('-c, --config <path>', 'Path to prompts config file', 'prompts.json')
  .option('--no-judge', 'Skip LLM evaluation of responses')
  .option(
    '--search-size <size>',
    'Web search context size: low | medium | high',
    'medium',
  )
  .action(async (promptId: string, opts) => {
    const prompt = getPromptById(promptId, opts.config);
    console.log(`\nRunning prompt: "${truncate(prompt.query_text, 60)}"`);
    console.log(`Targets: ${prompt.targets.map((t) => t.model).join(', ')}\n`);

    const results = await executePrompt(prompt, {
      runJudge: opts.judge !== false,
      searchContextSize: opts.searchSize as 'low' | 'medium' | 'high',
    });

    const success = results.filter((r) => r.success).length;
    const fail = results.filter((r) => !r.success).length;
    console.log(`\nDone. ${success} succeeded, ${fail} failed.`);
  });

// ---- run-all ----

program
  .command('run-all')
  .description('Execute all active prompts (ignores schedule)')
  .option('-c, --config <path>', 'Path to prompts config file', 'prompts.json')
  .option('--no-judge', 'Skip LLM evaluation of responses')
  .action(async (opts) => {
    const prompts = getActivePrompts(opts.config);
    if (prompts.length === 0) {
      console.log('No active prompts found.');
      return;
    }
    console.log(`Running ${prompts.length} active prompt(s)...\n`);
    for (const prompt of prompts) {
      console.log(`\n── ${prompt.id} ──`);
      await executePrompt(prompt, { runJudge: opts.judge !== false });
    }
    console.log('\nAll done.');
  });

// ---- schedule-run ----

program
  .command('schedule-run')
  .description(
    'Execute all prompts whose cron schedule is due (use with OS cron/task scheduler)',
  )
  .option('-c, --config <path>', 'Path to prompts config file', 'prompts.json')
  .option('--no-judge', 'Skip LLM evaluation of responses')
  .action(async (opts) => {
    const due = getDuePrompts(opts.config);
    if (due.length === 0) {
      console.log('No prompts are due right now.');
      return;
    }
    console.log(`${due.length} prompt(s) due. Executing...\n`);
    for (const prompt of due) {
      console.log(`\n── ${prompt.id} ──`);
      await executePrompt(prompt, { runJudge: opts.judge !== false });
    }
    console.log('\nSchedule run complete.');
  });

// ---- judge ----

program
  .command('judge <runId>')
  .description('Re-run the LLM judge on an existing run')
  .option('-c, --config <path>', 'Path to prompts config file', 'prompts.json')
  .action(async (runId: string, opts) => {
    const run = getRunById(runId);
    if (!run) {
      console.error(`Run "${runId}" not found.`);
      process.exit(1);
    }

    // Find the matching prompt config to get the rules
    let rules;
    try {
      const prompt = getPromptById(run.prompt_id, opts.config);
      rules = prompt.rules;
    } catch {
      console.error(
        `Prompt "${run.prompt_id}" not found in config. ` +
          'Make sure prompts.json still contains this prompt.',
      );
      process.exit(1);
    }

    console.log(`Re-judging run ${runId}...`);
    await judgeRun(run, rules);
    console.log('Done.');
  });

// ---- logs ----

program
  .command('logs')
  .description('Show recent runs')
  .option('-p, --prompt <id>', 'Filter by prompt ID')
  .option('-n, --limit <n>', 'Number of runs to show', '20')
  .action((opts) => {
    printRunsSummary(opts.prompt, Number(opts.limit));
  });

// ---- detail ----

program
  .command('detail <runId>')
  .description('Show full response and evaluations for a run')
  .action((runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      console.error(`Run "${runId}" not found.`);
      process.exit(1);
    }
    printRunDetail(run);
  });

// ---- report ----

program
  .command('report')
  .description('Generate an HTML report of recent runs')
  .option('-p, --prompt <id>', 'Filter by prompt ID')
  .option('-n, --limit <n>', 'Number of runs to include', '50')
  .option('-o, --output <file>', 'Output file path', 'report.html')
  .option('-t, --title <title>', 'Report title', 'LLM SEO Report')
  .action((opts) => {
    const runs = getRuns(opts.prompt, Number(opts.limit));

    const runsWithEvals = runs.map((run) => ({
      ...run,
      evaluations: getEvaluationsForRun(run.id),
    })) as Array<Run & { evaluations: Evaluation[] }>;

    const html = generateHtmlReport(runsWithEvals, opts.title);
    const outPath = path.resolve(opts.output);
    writeFileSync(outPath, html, 'utf-8');
    console.log(`Report written to: ${outPath}`);
  });

// ---- models ----

program
  .command('models')
  .description('List available model IDs you can use in prompts.json')
  .action(async () => {
    const { MODEL_FAMILIES } = await import('./src/models.js');
    console.log('\nAvailable model families and variants:\n');
    for (const family of MODEL_FAMILIES) {
      console.log(`  ${family.name} (${family.provider})`);
      for (const [key, variant] of Object.entries(family.variants)) {
        console.log(`    ${key.padEnd(14)} → ${variant.id}`);
      }
      console.log();
    }
  });

// ---- Helpers ----

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
