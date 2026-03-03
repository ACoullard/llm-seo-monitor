// Config loader — reads prompts.json and resolves the active prompt configs.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { PromptConfig } from './types.js';

export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'prompts.json');

/**
 * Load and parse the prompts config file.
 * Throws if the file does not exist or JSON is invalid.
 */
export function loadPrompts(configPath = DEFAULT_CONFIG_PATH): PromptConfig[] {
  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}\n` +
        'Copy prompts.example.json → prompts.json and fill in your prompts.',
    );
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as PromptConfig[];

  if (!Array.isArray(parsed)) {
    throw new Error('prompts.json must be a JSON array of prompt objects.');
  }

  return parsed;
}

/** Return only active prompts. */
export function getActivePrompts(configPath = DEFAULT_CONFIG_PATH): PromptConfig[] {
  return loadPrompts(configPath).filter((p) => p.is_active);
}

/** Find a single prompt by ID; throws if not found. */
export function getPromptById(
  id: string,
  configPath = DEFAULT_CONFIG_PATH,
): PromptConfig {
  const all = loadPrompts(configPath);
  const found = all.find((p) => p.id === id);
  if (!found) {
    const ids = all.map((p) => p.id).join(', ');
    throw new Error(`Prompt "${id}" not found. Available: ${ids}`);
  }
  return found;
}
