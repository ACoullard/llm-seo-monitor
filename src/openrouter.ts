// OpenRouter API client — adapted from the SaaS Deno implementation for Node.js

import { getPreferredProviders } from './models.js';
import type { ExecutionResult, JudgeResult, RuleType } from './types.js';

interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  provider?: { order: string[]; allow_fallbacks: boolean };
  plugins?: Array<{ id: string }>;
  web_search_options?: { search_context_size: 'low' | 'medium' | 'high' };
  temperature?: number;
  response_format?: { type: 'json_object' };
}

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export class OpenRouterClient {
  private readonly baseUrl = 'https://openrouter.ai/api/v1';

  constructor(private readonly apiKey: string) {}

  private async chat(request: OpenRouterRequest): Promise<OpenRouterResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${error}`);
    }

    return response.json() as Promise<OpenRouterResponse>;
  }

  /**
   * Execute a prompt against a specific model.
   */
  async executePrompt(
    query: string,
    model: string,
    useSearch = false,
    searchContextSize: 'low' | 'medium' | 'high' = 'medium',
  ): Promise<ExecutionResult> {
    const request: OpenRouterRequest = {
      model,
      messages: [{ role: 'user', content: query }],
    };

    // Inject preferred provider routing if defined for this model family
    const preferred = getPreferredProviders(model);
    if (preferred && preferred.length > 0) {
      request.provider = { order: preferred, allow_fallbacks: true };
    }

    if (useSearch) {
      request.plugins = [{ id: 'web' }];
      request.web_search_options = { search_context_size: searchContextSize };
    }

    const result = await this.chat(request);
    return {
      response: result.choices[0].message.content,
      tokenUsage: {
        input: result.usage.prompt_tokens,
        output: result.usage.completion_tokens,
      },
    };
  }

  /**
   * Evaluate an LLM response against a rule using the judge model.
   */
  async judge(
    responseText: string,
    ruleDescription: string,
    ruleType: RuleType,
    judgeModel = 'openai/gpt-5-nano',
  ): Promise<JudgeResult> {
    const systemPrompt = this.buildJudgePrompt(ruleType, ruleDescription);

    const request: OpenRouterRequest = {
      model: judgeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Response to evaluate:\n\n${responseText}` },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    };

    const result = await this.chat(request);
    return this.parseJudgeResponse(result.choices[0].message.content);
  }

  // ---- Private helpers ----

  private buildJudgePrompt(ruleType: RuleType, ruleDescription: string): string {
    const prompts: Record<RuleType, string> = {
      binary: `You are evaluating if a brand or topic is mentioned in an AI response.

Rule to evaluate: ${ruleDescription}

Analyze the response and return ONLY valid JSON:
{"score": 0 or 1, "reasoning": "brief explanation"}

- score: 0 if not mentioned/not present, 1 if mentioned/present
- reasoning: 1-2 sentences max

Return ONLY the JSON, no other text.`,

      ranking: `You are finding the ranking position of a brand or item in a list within an AI response.

Rule to evaluate: ${ruleDescription}

Analyze the response and return ONLY valid JSON:
{"score": <position number>, "reasoning": "brief explanation"}

- score: The position number (1 = first, 2 = second, …) or 0 if not found
- reasoning: 1-2 sentences max

If there are multiple lists, use the first relevant one. Return ONLY the JSON.`,

      sentiment: `You are evaluating the sentiment toward a brand or topic in an AI response.

Rule to evaluate: ${ruleDescription}

Analyze the response and return ONLY valid JSON:
{"score": <number from -1 to 1>, "reasoning": "brief explanation"}

- score: -1 (very negative) … 0 (neutral) … 1 (very positive)
- reasoning: 1-2 sentences max

Return ONLY the JSON, no other text.`,
    };

    return prompts[ruleType] ?? prompts.binary;
  }

  private parseJudgeResponse(response: string): JudgeResult {
    let jsonStr = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in judge response');

    const parsed = JSON.parse(match[0]) as { score: number; reasoning: string };
    return {
      score: Number(parsed.score) || 0,
      reasoning: String(parsed.reasoning || ''),
    };
  }
}
