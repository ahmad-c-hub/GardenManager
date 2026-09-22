import { Router } from 'express';
import { query } from '../db.js';
import { cloudinaryEnabled, deleteImage, uploadImage } from '../lib/cloudinary.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { buildGardenContext } from '../lib/gardenContext.js';
import { acceptImage, looksLikeImage } from '../lib/imageUpload.js';
import { LlmError, generateTitle, llmEnabled, streamReply } from '../lib/llm.js';
import { rateLimit } from '../lib/rateLimit.js';
import { parseId } from '../lib/validate.js';

const router = Router();

const MAX_TEXT = 4000;
const HISTORY_LIMIT = 20; // earlier turns sent to the model with each message
const PHOTO_FOLDER = 'garden-manager/assistant';
const DEFAULT_PHOTO_PROMPT = 'Identify this and tell me what you can about it in the context of my garden.';
const DEFAULT_TITLE = 'New conversation';

const SYSTEM_INSTRUCTION = `You are a master horticulturist and planting expert with deep, comprehensive knowledge of plants — species and varieties, germination and sowing, spacing, soil and fertility, watering, sunlight, companion planting, crop rotation, pest and disease identification and treatment, pruning, and harvest timing. You advise a home garden in the Bekaa Valley region of Lebanon: a continental Mediterranean climate with cold, sometimes frosty winters, hot dry summers, and a distinct seasonal planting calendar — tailor timing and variety advice to this climate specifically. Draw on your full horticultural knowledge to give precise, practical, actionable guidance, and ground recommendations in the user's actual garden data provided below (their beds, current plantings, and harvest history). Recommend specific varieties and exact timing where possible. When shown a photo, identify the plant/pest/disease and assess health. If information is uncertain or region-dependent, say so briefly. If asked something entirely outside gardening, gently redirect.

Format replies in Markdown: short paragraphs, bullet lists for steps or options, **bold** for key varieties and dates. Keep it scannable; avoid long preambles.`;

// The free Gemini tier allows ~15 requests a minute across everyone; this keeps
// one enthusiastic user from using it all up.
const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 8,
  key: (req) => req.user.id,
  message: 'The assistant is busy right now. Please try again in a moment.',
});

async function findConversation(id, userId) {
  const { rows } = await query(
    'SELECT id, title, created_at, updated_at FROM assistant_conversations WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  if (rows.length === 0) throw notFound('That conversation could not be found.');
  return rows[0];
}

/** First ~6 words of the opening message, until the model suggests something better. */
function quickTitle(text) {
  if (!text) return 'Photo from the garden';
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const title = words.slice(0, 6).join(' ').replace(/[\s,.;:!?]+$/, '');
  return (words.length > 6 ? `${title}…` : title).slice(0, 80);
}

const SELECT_MESSAGE = 'SELECT id, role, content, image_url, created_at FROM assistant_messages';

router.get('/conversations', async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, created_at, updated_at FROM assistant_conversations
     WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 100`,
    [req.user.id],
  );
  res.json({ conversations: rows, enabled: llmEnabled });
});

router.post('/conversations', async (req, res) => {
  const raw = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
  const { rows } = await query(
    'INSERT INTO assistant_conversations (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at',
    [req.user.id, raw || DEFAULT_TITLE],
  );
  res.status(201).json(rows[0]);
});

router.get('/conversations/:id', async (req, res) => {
  const conversation = await findConversation(parseId(req.params.id), req.user.id);
  const { rows } = await query(`${SELECT_MESSAGE} WHERE conversation_id = $1 ORDER BY id LIMIT 500`, [conversation.id]);
  res.json({ ...conversation, messages: rows });
});

router.delete('/conversations/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await query(
    `DELETE FROM assistant_conversations WHERE id = $1 AND user_id = $2
     RETURNING (SELECT array_remove(array_agg(image_public_id), NULL) FROM assistant_messages WHERE conversation_id = $1) AS photos`,
    [id, req.user.id],
  );
  if (rows.length === 0) throw notFound('That conversation could not be found.');
  res.status(204).end();
  // Messages go with the conversation (ON DELETE CASCADE); tidy up their photos afterwards.
  await Promise.all((rows[0].photos ?? []).map(deleteImage));
});

/**
 * Send a message and stream the reply as newline-delimited JSON events:
 *   { type: 'start', message }      the saved user message
 *   { type: 'delta', text }         the next piece of the reply
 *   { type: 'done', message }       the saved assistant message
 *   { type: 'title', title }        the conversation's new title (first message only)
 *   { type: 'error', error, kind }  nothing was saved; the client restores the draft
 */
router.post('/conversations/:id/chat', chatLimiter, acceptImage, async (req, res) => {
  const conversation = await findConversation(parseId(req.params.id), req.user.id);

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (text.length > MAX_TEXT) throw badRequest(`Messages can be at most ${MAX_TEXT} characters.`);
  const file = req.file;
  if (file && !looksLikeImage(file.buffer)) throw badRequest('That file doesn’t look like a JPEG, PNG or WebP image.');
  if (!text && !file) throw badRequest('Type a question or add a photo.');
  if (!llmEnabled) throw new HttpError(503, 'The Planting Assistant isn’t set up on this server yet.');

  // Earlier turns (newest first from the query), the garden snapshot and the
  // photo upload don't depend on each other.
  const [history, garden, photo] = await Promise.all([
    query(`SELECT role, content, image_url FROM assistant_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2`, [
      conversation.id,
      HISTORY_LIMIT,
    ]),
    buildGardenContext(),
    file && cloudinaryEnabled
      ? uploadImage(file.buffer, { folder: PHOTO_FOLDER }).catch((err) => {
          // The assistant can still see the photo; it just won't appear in the saved history.
          console.error('Assistant photo upload failed:', err.message);
          return null;
        })
      : null,
  ]);
  const isFirst = history.rows.length === 0;

  const {
    rows: [userMessage],
  } = await query(
    `INSERT INTO assistant_messages (conversation_id, role, content, image_url, image_public_id)
     VALUES ($1, 'user', $2, $3, $4) RETURNING id, role, content, image_url, created_at`,
    [conversation.id, text, photo?.url ?? null, photo?.publicId ?? null],
  );

  res.status(200);
  res.set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  // If the phone locks mid-answer, keep going: the reply is saved and waiting when they return.
  const send = (event) => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  send({ type: 'start', message: userMessage });

  const turns = history.rows.reverse().map((m) => ({
    role: m.role,
    // Older photos are described, not re-sent, to keep requests small.
    text: m.image_url || (m.role === 'user' && !m.content) ? `[photo] ${m.content}`.trim() : m.content,
  }));
  turns.push({
    role: 'user',
    text: text || DEFAULT_PHOTO_PROMPT,
    image: file ? { buffer: file.buffer, mimeType: file.mimetype } : undefined,
  });

  try {
    let reply;
    let cutShort = false;
    try {
      reply = await streamReply({
        system: `${SYSTEM_INSTRUCTION}\n\n--- The user's garden right now ---\n${garden}`,
        turns,
        onText: (chunk) => send({ type: 'delta', text: chunk }),
      });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      if (!err.partial) {
        // Nothing to show for it: undo the user's message so they can simply resend.
        await query('DELETE FROM assistant_messages WHERE id = $1', [userMessage.id]);
        if (photo) deleteImage(photo.publicId);
        send({ type: 'error', error: err.message, kind: err.kind });
        return;
      }
      // Keep what arrived, and say it was cut off.
      reply = err.partial;
      cutShort = true;
    }
    if (cutShort) reply += '\n\n_…the answer was cut short. Ask me to continue._';

    const title = isFirst && conversation.title === DEFAULT_TITLE ? quickTitle(text) : null;
    const [
      {
        rows: [assistantMessage],
      },
    ] = await Promise.all([
      query(
        `INSERT INTO assistant_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)
         RETURNING id, role, content, image_url, created_at`,
        [conversation.id, reply],
      ),
      query('UPDATE assistant_conversations SET updated_at = now(), title = COALESCE($2, title) WHERE id = $1', [
        conversation.id,
        title,
      ]),
    ]);
    send({ type: 'done', message: assistantMessage });
    if (title) send({ type: 'title', title });

    // A nicer title from the model, if it can spare a moment.
    if (title && text) {
      const better = await generateTitle(text);
      if (better) {
        await query('UPDATE assistant_conversations SET title = $2 WHERE id = $1', [conversation.id, better]);
        send({ type: 'title', title: better });
      }
    }
  } catch (err) {
    console.error('[assistant chat]', err);
    send({ type: 'error', error: 'Something went wrong on our side. Please try again.', kind: 'server' });
  } finally {
    res.end();
  }
});

export default router;
