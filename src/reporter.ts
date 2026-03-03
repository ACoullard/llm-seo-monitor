// Reporter — formats and displays run results in the terminal.

import { getEvaluationsForRun, getRuns } from './db.js';
import type { Evaluation, Run } from './types.js';

// ---- Colour helpers (ANSI, works in most terminals) ----

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function colour(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${C.reset}`;
}

function scoreColour(score: number, type: string): string {
  if (type === 'binary') return score > 0 ? C.green : C.red;
  if (type === 'ranking') {
    if (score === 0) return C.dim;
    if (score <= 3) return C.green;
    if (score <= 5) return C.yellow;
    return C.red;
  }
  if (type === 'sentiment') {
    if (score > 0.3) return C.green;
    if (score < -0.3) return C.red;
    return C.yellow;
  }
  return C.white;
}

function formatScore(score: number, type: string): string {
  let label: string;
  if (type === 'ranking') label = score === 0 ? 'not found' : `#${score}`;
  else if (type === 'binary') label = score ? 'yes' : 'no';
  else label = score.toFixed(2);

  return colour(label, scoreColour(score, type), C.bold);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

// ---- Public functions ----

/** Print a summary table of recent runs for a prompt. */
export function printRunsSummary(promptId?: string, limit = 20): void {
  const runs = getRuns(promptId, limit);

  if (runs.length === 0) {
    console.log(colour('No runs found.', C.dim));
    return;
  }

  for (const run of runs) {
    printRunRow(run);
  }
}

/** Print a single run row with its evaluations. */
export function printRunRow(run: Run): void {
  const ts = new Date(run.executed_at).toLocaleString();
  const model = colour(run.model_used.split('/')[1] ?? run.model_used, C.cyan);
  const search = run.web_search_enabled ? colour(' [search]', C.yellow) : '';

  console.log(`\n${colour('▶', C.bold)} ${model}${search}  ${colour(ts, C.dim)}`);
  console.log(`  ${colour('prompt_id:', C.dim)} ${run.prompt_id}`);
  console.log(`  ${colour('run_id:   ', C.dim)} ${run.id}`);
  console.log(
    `  ${colour('tokens:   ', C.dim)} ${run.token_usage_input} in / ${run.token_usage_output} out`,
  );

  const evals = getEvaluationsForRun(run.id);
  if (evals.length > 0) {
    console.log(`  ${colour('scores:', C.dim)}`);
    for (const ev of evals) {
      const score = formatScore(ev.score, ev.rule_type);
      const reasoning = colour(truncate(ev.reasoning, 80), C.dim);
      console.log(`    • ${colour(ev.rule_name, C.bold)}: ${score}  ${reasoning}`);
    }
  }
}

/** Print the full response text of a run. */
export function printRunDetail(run: Run): void {
  printRunRow(run);

  console.log(`\n${colour('Response:', C.bold)}`);
  console.log('─'.repeat(60));
  console.log(run.response_text || colour('<no response text>', C.dim));
  console.log('─'.repeat(60));

  const evals = getEvaluationsForRun(run.id);
  if (evals.length > 0) {
    console.log(`\n${colour('Evaluations:', C.bold)}`);
    for (const ev of evals) {
      console.log(`\n  ${colour(ev.rule_name, C.bold)} (${ev.rule_type})`);
      console.log(`    Score    : ${formatScore(ev.score, ev.rule_type)}`);
      console.log(`    Reasoning: ${colour(ev.reasoning, C.dim)}`);
    }
  }
}

/** Generate a self-contained HTML report for a set of runs. */
export function generateHtmlReport(
  runs: Array<Run & { evaluations: Evaluation[] }>,
  title = 'LLM SEO Report',
): string {
  const rows = runs.map((run) => {
    const ts = new Date(run.executed_at).toLocaleString();
    const evalHtml = run.evaluations
      .map(
        (ev) =>
          `<div class="eval">
            <span class="rule-name">${esc(ev.rule_name)}</span>
            <span class="score score-${ev.rule_type}">${formatScoreHtml(ev.score, ev.rule_type)}</span>
            <span class="reasoning">${esc(ev.reasoning)}</span>
          </div>`,
      )
      .join('');

    return `<div class="run">
      <div class="run-header">
        <span class="model">${esc(run.model_used)}</span>
        ${run.web_search_enabled ? '<span class="badge search">Search</span>' : ''}
        <span class="ts">${ts}</span>
        <span class="tokens">${run.token_usage_input}/${run.token_usage_output} tokens</span>
      </div>
      <div class="prompt-id">prompt: ${esc(run.prompt_id)}</div>
      ${evalHtml}
      <details>
        <summary>Response</summary>
        <pre class="response">${esc(run.response_text)}</pre>
      </details>
    </div>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root { --bg: #0f0f0f; --surface: #1a1a1a; --border: #2a2a2a; --text: #e4e4e4; --muted: #888; --green: #4ade80; --red: #f87171; --yellow: #fbbf24; --cyan: #67e8f9; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 1.5rem; }
    h1 { color: var(--cyan); border-bottom: 1px solid var(--border); padding-bottom: .5rem; }
    .run { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
    .run-header { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; margin-bottom: .5rem; }
    .model { font-weight: bold; color: var(--cyan); }
    .ts { color: var(--muted); font-size: .85em; }
    .tokens { color: var(--muted); font-size: .85em; font-family: monospace; }
    .prompt-id { font-size: .75em; color: var(--muted); margin-bottom: .5rem; font-family: monospace; }
    .badge { font-size: .7em; padding: 2px 6px; border-radius: 4px; font-weight: bold; text-transform: uppercase; }
    .badge.search { background: rgba(251,191,36,.15); color: var(--yellow); border: 1px solid rgba(251,191,36,.3); }
    .eval { display: flex; gap: .75rem; align-items: baseline; margin: .25rem 0; font-size: .9em; }
    .rule-name { font-weight: 600; min-width: 120px; }
    .score { font-family: monospace; font-weight: bold; }
    .score-binary .positive, .score-ranking .top, .score-sentiment .positive { color: var(--green); }
    .score-red { color: var(--red); }
    .score-yellow { color: var(--yellow); }
    .score-green { color: var(--green); }
    .reasoning { color: var(--muted); font-size: .85em; }
    details summary { cursor: pointer; color: var(--muted); font-size: .85em; margin-top: .5rem; }
    .response { white-space: pre-wrap; word-break: break-word; font-size: .82em; background: #111; padding: .75rem; border-radius: 4px; max-height: 300px; overflow-y: auto; border: 1px solid var(--border); }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p style="color:var(--muted)">Generated: ${new Date().toLocaleString()} · ${runs.length} run(s)</p>
  ${rows.join('\n')}
</body>
</html>`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatScoreHtml(score: number, type: string): string {
  let label: string;
  let cls: string;
  if (type === 'ranking') {
    label = score === 0 ? 'not found' : `#${score}`;
    cls = score === 0 ? 'score-red' : score <= 3 ? 'score-green' : score <= 5 ? 'score-yellow' : 'score-red';
  } else if (type === 'binary') {
    label = score ? 'yes' : 'no';
    cls = score ? 'score-green' : 'score-red';
  } else {
    label = score.toFixed(2);
    cls = score > 0.3 ? 'score-green' : score < -0.3 ? 'score-red' : 'score-yellow';
  }
  return `<span class="${cls}">${esc(label)}</span>`;
}
