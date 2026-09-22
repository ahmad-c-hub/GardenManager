// The one place the Planting Assistant talks to a language model. To switch
// provider or model, change this file only: the rest of the app just calls
// streamReply() / generateTitle() with plain { role, text, image } turns.
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const TIMEOUT_MS = 90_000;

/** Without a key the rest of the app works; the assistant just says it isn't set up. */
export const llmEnabled = Boolean(API_KEY);
if (!llmEnabled) console.warn('Planting Assistant is off: set GEMINI_API_KEY.');

const client = llmEnabled ? new GoogleGenerativeAI(API_KEY) : null;

// Gemini 2.5+ models "think" before answering, and those tokens count against
// maxOutputTokens. Keeping thinking low keeps the first words quick. Gemini 3+
// takes a level; 2.5 takes a token budget (Flash can switch it off for the
// throwaway title call). Older models reject the field, so they get neither.
const GENERATION = Number(MODEL.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
function thinking(budget) {
  if (GENERATION >= 3) return { thinkingConfig: { thinkingLevel: 'low' } };
  if (GENERATION >= 2.5) return { thinkingConfig: { thinkingBudget: /flash/.test(MODEL) ? budget : Math.max(budget, 128) } };
  return {};
}

/** Thrown for anything the user should see a friendly message for. */
export class LlmError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'busy' | 'blocked' | 'unavailable'
  }
}

function toLlmError(err) {
  if (err instanceof LlmError) return err;
  const status = err instanceof GoogleGenerativeAIFetchError ? err.status : undefined;
  if (status === 429 || /\b429\b|quota|rate limit/i.test(err.message ?? '')) {
    return new LlmError('busy', 'The assistant is busy right now. Please try again in a moment.');
  }
  if (err.name === 'AbortError' || /abort/i.test(err.message ?? '')) {
    return new LlmError('unavailable', 'The assistant took too long to answer. Please try again.');
  }
  if (status === 400 && /api key/i.test(err.message ?? '')) {
    console.error('Gemini rejected the API key:', err.message);
    return new LlmError('unavailable', 'The assistant isn’t configured correctly on the server.');
  }
  console.error('Gemini request failed:', err.message);
  return new LlmError('unavailable', 'The assistant couldn’t answer just now. Please try again.');
}

/**
 * Turns -> Gemini contents. Consecutive turns from the same side are merged
 * (e.g. a question whose earlier answer failed), since the API expects them to alternate.
 */
function toContents(turns) {
  const contents = [];
  for (const turn of turns) {
    const role = turn.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (turn.image) parts.push({ inlineData: { mimeType: turn.image.mimeType, data: turn.image.buffer.toString('base64') } });
    if (turn.text) parts.push({ text: turn.text });
    if (parts.length === 0) continue;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  // The conversation must open with the user.
  while (contents[0]?.role === 'model') contents.shift();
  return contents;
}

function blockedReason(response) {
  const reason = response?.promptFeedback?.blockReason || response?.candidates?.[0]?.finishReason;
  return ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'OTHER', 'RECITATION'].includes(reason) ? reason : null;
}

/**
 * Stream a reply. `turns` is [{ role: 'user'|'assistant', text, image?: { buffer, mimeType } }],
 * oldest first, ending with the new user turn. Calls onText(chunk) as text
 * arrives and resolves to the full reply. Throws LlmError.
 */
export async function streamReply({ system, turns, onText }) {
  if (!llmEnabled) throw new LlmError('unavailable', 'The Planting Assistant isn’t set up on this server yet.');

  const model = client.getGenerativeModel({
    model: MODEL,
    systemInstruction: system,
    generationConfig: { temperature: 0.6, maxOutputTokens: 6144, ...thinking(1024) },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let full = '';
  try {
    const result = await model.generateContentStream({ contents: toContents(turns) }, { signal: controller.signal });
    for await (const chunk of result.stream) {
      let text = '';
      try {
        text = chunk.text();
      } catch {
        // A chunk with no text part (e.g. a safety stop); checked below.
      }
      if (text) {
        full += text;
        onText(text);
      }
    }
    if (!full) {
      const response = await result.response.catch(() => null);
      if (blockedReason(response)) {
        throw new LlmError('blocked', 'I can’t help with that one. Try asking about your garden in a different way.');
      }
      throw new LlmError('unavailable', 'The assistant came back empty-handed. Please try again.');
    }
    return full;
  } catch (err) {
    const llmErr = toLlmError(err);
    llmErr.partial = full;
    throw llmErr;
  } finally {
    clearTimeout(timer);
  }
}

/** A 3–5 word title for a conversation, or null if the model can't be reached. */
export async function generateTitle(firstMessage) {
  if (!llmEnabled) return null;
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0.3, maxOutputTokens: 512, ...thinking(0) },
  });
  try {
    const result = await model.generateContent(
      {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Write a 3 to 5 word title for a gardening chat that opens with the message below. ' +
                  'Title case, no quotes, no trailing punctuation. Reply with the title only.\n\n' +
                  firstMessage.slice(0, 600),
              },
            ],
          },
        ],
      },
      { timeout: 15_000 },
    );
    const title = result.response
      .text()
      .split('\n')[0]
      .replace(/^["'*#\s]+|["'*.\s]+$/g, '')
      .trim();
    return title && title.length <= 60 ? title : null;
  } catch {
    return null; // a missing title isn't worth an error; the heuristic one stays
  }
}
