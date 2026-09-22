// The one place the Planting Assistant talks to a language model. To switch
// provider or model, change this file only: the rest of the app just calls
// streamReply() / generateTitle() with plain { role, text, image } turns.
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY;
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.5-flash-lite';
// Tried in order. Set GEMINI_FALLBACK_MODEL to an empty value to turn the fallback off.
const MODELS = [PRIMARY_MODEL, FALLBACK_MODEL].filter((m, i, all) => m && all.indexOf(m) === i);

// One deadline covers every attempt, every model and every wait in between.
const REPLY_DEADLINE_MS = 90_000;
const TITLE_DEADLINE_MS = 25_000;

// The free tier often answers 503 ("high demand") or 429 for a moment.
// Each model gets up to MAX_ATTEMPTS tries, waiting roughly this long in between.
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [500, 1500, 3000, 6000];
const RETRYABLE = new Set([429, 503]);

/** Without a key the rest of the app works; the assistant just says it isn't set up. */
export const llmEnabled = Boolean(API_KEY);
if (!llmEnabled) console.warn('Planting Assistant is off: set GEMINI_API_KEY.');

const client = llmEnabled ? new GoogleGenerativeAI(API_KEY) : null;

// Gemini 2.5+ models "think" before answering, and those tokens count against
// maxOutputTokens. Keeping thinking low keeps the first words quick. Gemini 3+
// takes a level; 2.5 takes a token budget (Flash can switch it off for the
// throwaway title call). Older models reject the field, so they get neither.
function thinking(model, budget) {
  const generation = Number(model.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  if (generation >= 3) return { thinkingConfig: { thinkingLevel: 'low' } };
  if (generation >= 2.5) return { thinkingConfig: { thinkingBudget: /flash/.test(model) ? budget : Math.max(budget, 128) } };
  return {};
}

/** Thrown for anything the user should see a friendly message for. */
export class LlmError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'busy' | 'blocked' | 'unavailable'
  }
}

/** HTTP status behind an SDK error, including errors that arrive mid-stream as text. */
function statusOf(err) {
  if (err instanceof GoogleGenerativeAIFetchError && err.status) return err.status;
  const message = err?.message ?? '';
  const code = /\[(\d{3})[ \]]/.exec(message);
  if (code) return Number(code[1]);
  if (/high demand|overloaded|UNAVAILABLE/i.test(message)) return 503;
  if (/RESOURCE_EXHAUSTED|rate limit/i.test(message)) return 429;
  return undefined;
}

const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Run attempt(model, signal) until it succeeds. 503s and 429s are retried with
 * backoff; a model still overloaded (503) after all its attempts hands the whole
 * request to the next model. An error marked `committed` (the user has already
 * seen part of the answer) is never retried, since a retry would repeat it.
 */
async function withResilience(label, deadlineMs, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Deadline exceeded', 'AbortError')), deadlineMs);
  let lastErr;
  try {
    for (const [m, model] of MODELS.entries()) {
      for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
        try {
          const result = await attempt(model, controller.signal);
          const note = m > 0 ? ` (fallback, attempt ${n})` : n > 1 ? ` (attempt ${n})` : '';
          console.log(`[llm] ${label} served by ${model}${note}`);
          return result;
        } catch (err) {
          lastErr = err;
          const status = statusOf(err);
          if (err.committed || controller.signal.aborted || !RETRYABLE.has(status)) throw err;
          if (n === MAX_ATTEMPTS) break;
          const delay = jitter(BACKOFF_MS[n - 1]);
          console.warn(`[llm] ${label}: ${model} returned ${status} (attempt ${n}/${MAX_ATTEMPTS}), retrying in ${delay}ms`);
          await sleep(delay, controller.signal);
        }
      }
      const next = MODELS[m + 1];
      if (!next || statusOf(lastErr) !== 503) break;
      console.warn(`[llm] ${label}: ${model} still overloaded after ${MAX_ATTEMPTS} attempts, falling back to ${next}`);
    }
    throw lastErr;
  } catch (err) {
    if (!(err instanceof LlmError)) console.error(`[llm] ${label} failed: ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function toLlmError(err) {
  if (err instanceof LlmError) return err;
  const status = statusOf(err);
  if (status === 503) {
    return new LlmError('unavailable', 'The assistant is in high demand right now. Please try again in a minute.');
  }
  if (status === 429) {
    return new LlmError('busy', 'The assistant is busy right now. Please try again in a moment.');
  }
  if (err.name === 'AbortError' || /abort/i.test(err.message ?? '')) {
    return new LlmError('unavailable', 'The assistant took too long to answer. Please try again.');
  }
  if (status === 400 && /api key/i.test(err.message ?? '')) {
    return new LlmError('unavailable', 'The assistant isn’t configured correctly on the server.');
  }
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
 * arrives and resolves to the full reply. Throws LlmError (with `.partial`).
 */
export async function streamReply({ system, turns, onText }) {
  if (!llmEnabled) throw new LlmError('unavailable', 'The Planting Assistant isn’t set up on this server yet.');

  const contents = toContents(turns);
  let full = '';
  try {
    return await withResilience('reply', REPLY_DEADLINE_MS, async (modelName, signal) => {
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction: system,
        generationConfig: { temperature: 0.6, maxOutputTokens: 6144, ...thinking(modelName, 1024) },
      });
      try {
        const result = await model.generateContentStream({ contents }, { signal });
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
        if (full) err.committed = true;
        throw err;
      }
    });
  } catch (err) {
    const llmErr = toLlmError(err);
    llmErr.partial = full;
    throw llmErr;
  }
}

/** A 3–5 word title for a conversation, or null if the model can't be reached. */
export async function generateTitle(firstMessage) {
  if (!llmEnabled) return null;
  const prompt =
    'Write a 3 to 5 word title for a gardening chat that opens with the message below. ' +
    'Title case, no quotes, no trailing punctuation. Reply with the title only.\n\n' +
    firstMessage.slice(0, 600);
  try {
    const result = await withResilience('title', TITLE_DEADLINE_MS, (modelName, signal) =>
      client
        .getGenerativeModel({
          model: modelName,
          generationConfig: { temperature: 0.3, maxOutputTokens: 512, ...thinking(modelName, 0) },
        })
        .generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }, { signal }),
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
