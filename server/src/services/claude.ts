import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const DEFAULT_MODEL = 'claude-opus-4-6';

export interface ThinkResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Run a think prompt against note texts.
 * Returns the full response text and token counts.
 */
export async function runThinkPrompt(
  promptText: string,
  noteTexts: string[],
  model: string = DEFAULT_MODEL
): Promise<ThinkResult> {
  const userMessage = noteTexts.length === 1
    ? noteTexts[0]
    : noteTexts.map((t, i) => `--- Note ${i + 1} ---\n${t}`).join('\n\n');

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = await client.messages.stream({
    model,
    max_tokens: 4096,
    system: promptText,
    messages: [{ role: 'user', content: userMessage }],
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullText += chunk.delta.text;
    }
    if (chunk.type === 'message_delta' && chunk.usage) {
      outputTokens = chunk.usage.output_tokens;
    }
    if (chunk.type === 'message_start' && chunk.message.usage) {
      inputTokens = chunk.message.usage.input_tokens;
    }
  }

  return { text: fullText, inputTokens, outputTokens };
}

/**
 * Parse Claude's response as JSON (for structured thought outputs).
 * Falls back to wrapping in a free-form thought if not valid JSON.
 */
export function parseThoughtResponse(text: string, outputType: string): Array<{
  type: string;
  title?: string;
  body: string;
  source_anchor?: string;
}> {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object') return [parsed];
    } catch {
      // fall through
    }
  }

  // Fallback: wrap the whole response as a single thought
  return [{
    type: outputType,
    title: null as any,
    body: text,
  }];
}
