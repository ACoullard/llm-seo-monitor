# LLM SEO Monitor

A lightweight, locally runnable LLM SEO testing tool.  
Track how different AI models mention your brand or products over time — no cloud account required beyond an [OpenRouter](https://openrouter.ai) key.

---

## How it works

1. **Define prompts** in `prompts.json` — each prompt is a question (like a real user query), a list of LLM targets, and evaluation rules.
2. **Run them** — the tool calls each LLM via OpenRouter and saves the responses to a local SQLite database.
3. **Judge responses** — a fast LLM (default: `openai/gpt-5-nano`) scores each response against your rules automatically.
4. **View results** — browse everything in the local web UI, or use the CLI.

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your OpenRouter API key
```

### 3. Create your prompts config

```bash
cp prompts.example.json prompts.json
# Edit prompts.json to define your queries and rules
```

### 4. Start the web UI

```bash
npm run serve
# → http://localhost:3456
```

Or use the CLI directly:

```bash
npx tsx cli.ts run <promptId>
```

---

## Web UI

Start the local server:

```bash
npm run serve              # default port 3456
npx tsx server.ts 8080     # custom port
```

Then open **http://localhost:3456** in your browser.

### Sidebar — Prompts

- Lists every prompt from `prompts.json` with its query, models, schedule, and active/paused status
- **▶ Run now** fires the prompt immediately; a pulsing badge shows while it's running and results refresh automatically when complete
- Prompts are **read-only** — edit `prompts.json` directly to make changes

### Main panel — Runs

- Shows all past runs for the selected prompt with timestamps and rule scores
- Click any run to open the **detail panel** on the right with the full LLM response, token counts, and per-rule evaluation scores with reasoning
- **Delete** button removes a run and all its evaluations from the database

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/prompts` | All prompts + running status |
| `POST` | `/api/prompts/:id/run` | Trigger a run (async, returns 202) |
| `GET` | `/api/runs?promptId=&limit=` | Runs with evaluations |
| `GET` | `/api/runs/:id` | Single run detail |
| `DELETE` | `/api/runs/:id` | Delete a run |

---

## CLI commands

| Command | Description |
|---|---|
| `list` | Show all prompts in `prompts.json` |
| `run <id>` | Execute one prompt immediately |
| `run-all` | Execute all active prompts |
| `schedule-run` | Execute only the prompts whose cron is due (pipe to OS scheduler) |
| `judge <runId>` | Re-run the LLM judge on an existing run |
| `logs` | Print recent runs to the terminal |
| `detail <runId>` | Print full response + evaluations for a run |
| `report` | Generate a self-contained HTML report of recent runs |
| `models` | List all available model IDs |

### Examples

```bash
# Show last 30 runs for a specific prompt
npx tsx cli.ts logs --prompt crm-tools --limit 30

# Full response text for a specific run
npx tsx cli.ts detail <run-uuid>

# Generate HTML report file
npx tsx cli.ts report --prompt crm-tools --output crm-report.html

# Run without judging (faster, no extra API call)
npx tsx cli.ts run crm-tools --no-judge
```

---

## prompts.json schema

```json
[
  {
    "id": "unique-prompt-id",
    "query_text": "What are the best open source CRM tools?",
    "schedule_cron": "0 9 * * 1",   // optional; omit for manual-only prompts
    "is_active": true,
    "targets": [
      { "model": "openai/gpt-5-nano", "use_search": false },
      { "model": "anthropic/claude-haiku-4.5", "use_search": false }
    ],
    "rules": [
      {
        "name": "HubSpot Mentioned",
        "description": "Is HubSpot mentioned anywhere in the response?",
        "type": "binary"
      }
    ]
  }
]
```

### Rule types

| Type | Score range | Meaning |
|---|---|---|
| `binary` | `0` or `1` | Is the brand/topic present? |
| `ranking` | `1`, `2`, `3` … or `0` | Position in a ranked list (`0` = not found) |
| `sentiment` | `-1` … `1` | Tone toward the brand/topic |

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | ✓ | — | Your OpenRouter API key |
| `JUDGE_MODEL` | | `openai/gpt-5-nano` | Model used to evaluate responses |
| `DB_PATH` | | `./results.db` | Path to the SQLite results database |

---

## Available models

Run `npx tsx cli.ts models` to see all supported model IDs, or use any valid OpenRouter model string directly in `prompts.json`.
