// SQLite persistence layer using better-sqlite3
// Database file defaults to ./results.db (override with DB_PATH env variable)

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import type { Evaluation, Run } from './types.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'results.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

// ---- Schema ----

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id                 TEXT PRIMARY KEY,
      prompt_id          TEXT NOT NULL,
      model_used         TEXT NOT NULL,
      web_search_enabled INTEGER NOT NULL DEFAULT 0,
      response_text      TEXT NOT NULL DEFAULT '',
      token_usage_input  INTEGER NOT NULL DEFAULT 0,
      token_usage_output INTEGER NOT NULL DEFAULT 0,
      executed_at        TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_prompt_id   ON runs(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_runs_executed_at ON runs(executed_at);

    CREATE TABLE IF NOT EXISTS evaluations (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      rule_name   TEXT NOT NULL,
      rule_type   TEXT NOT NULL,
      score       REAL NOT NULL,
      reasoning   TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evaluations_run_id ON evaluations(run_id);
  `);
}

// ---- Run helpers ----

export function insertRun(
  promptId: string,
  modelUsed: string,
  webSearchEnabled: boolean,
  responseText: string,
  tokenIn: number,
  tokenOut: number,
): Run {
  const run: Run = {
    id: randomUUID(),
    prompt_id: promptId,
    model_used: modelUsed,
    web_search_enabled: webSearchEnabled ? 1 : 0,
    response_text: responseText,
    token_usage_input: tokenIn,
    token_usage_output: tokenOut,
    executed_at: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT INTO runs
       (id, prompt_id, model_used, web_search_enabled, response_text,
        token_usage_input, token_usage_output, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.prompt_id,
      run.model_used,
      run.web_search_enabled,
      run.response_text,
      run.token_usage_input,
      run.token_usage_output,
      run.executed_at,
    );

  return run;
}

export function getRuns(promptId?: string, limit = 50): Run[] {
  if (promptId) {
    return getDb()
      .prepare(
        `SELECT * FROM runs WHERE prompt_id = ? ORDER BY executed_at DESC LIMIT ?`,
      )
      .all(promptId, limit) as Run[];
  }
  return getDb()
    .prepare(`SELECT * FROM runs ORDER BY executed_at DESC LIMIT ?`)
    .all(limit) as Run[];
}

export function getRunById(runId: string): Run | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM runs WHERE id = ?`)
      .get(runId) as Run | undefined) ?? null
  );
}

export function deleteRun(runId: string): void {
  getDb().prepare(`DELETE FROM runs WHERE id = ?`).run(runId);
}

// ---- Evaluation helpers ----

export function insertEvaluation(
  runId: string,
  ruleName: string,
  ruleType: string,
  score: number,
  reasoning: string,
): Evaluation {
  const evaluation: Evaluation = {
    id: randomUUID(),
    run_id: runId,
    rule_name: ruleName,
    rule_type: ruleType as Evaluation['rule_type'],
    score,
    reasoning,
    created_at: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT INTO evaluations
       (id, run_id, rule_name, rule_type, score, reasoning, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      evaluation.id,
      evaluation.run_id,
      evaluation.rule_name,
      evaluation.rule_type,
      evaluation.score,
      evaluation.reasoning,
      evaluation.created_at,
    );

  return evaluation;
}

export function getEvaluationsForRun(runId: string): Evaluation[] {
  return getDb()
    .prepare(`SELECT * FROM evaluations WHERE run_id = ? ORDER BY created_at`)
    .all(runId) as Evaluation[];
}

export function getEvaluationsForPrompt(promptId: string): Array<Evaluation & { model_used: string; executed_at: string }> {
  return getDb()
    .prepare(
      `SELECT e.*, r.model_used, r.executed_at
       FROM evaluations e
       JOIN runs r ON r.id = e.run_id
       WHERE r.prompt_id = ?
       ORDER BY r.executed_at DESC`,
    )
    .all(promptId) as Array<Evaluation & { model_used: string; executed_at: string }>;
}

/** Delete all runs (and cascade evaluations) for a specific prompt. */
export function deleteRunsForPrompt(promptId: string): void {
  getDb().prepare(`DELETE FROM runs WHERE prompt_id = ?`).run(promptId);
}
