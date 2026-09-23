import { Router } from 'express';
import { query } from '../db.js';
import { cloudinaryEnabled, deleteImage, uploadImage } from '../lib/cloudinary.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { acceptImage, looksLikeImage } from '../lib/imageUpload.js';
import { notifyActivity } from '../lib/push.js';
import { parseId } from '../lib/validate.js';

const router = Router();

const MAX_NOTE = 1000;

const SELECT_MOMENT = `
  SELECT m.id, m.user_id, m.image_url, m.note, m.created_at, u.display_name
  FROM moments m
  JOIN users u ON u.id = m.user_id`;

function parsePaging(q) {
  const limit = q.limit === undefined ? 20 : Number(q.limit);
  const offset = q.offset === undefined ? 0 : Number(q.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw badRequest('limit must be between 1 and 50.');
  if (!Number.isInteger(offset) || offset < 0) throw badRequest('offset must be 0 or more.');
  return { limit, offset };
}

router.get('/', async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  // Fetch one extra row to know whether there's another page.
  const { rows } = await query(`${SELECT_MOMENT} ORDER BY m.created_at DESC, m.id DESC LIMIT $1 OFFSET $2`, [
    limit + 1,
    offset,
  ]);
  res.json({ moments: rows.slice(0, limit), hasMore: rows.length > limit });
});

router.post('/', acceptImage, async (req, res) => {
  if (!req.file) throw badRequest('Please choose a photo to share.');
  if (!looksLikeImage(req.file.buffer)) throw badRequest('That file doesn’t look like a JPEG, PNG or WebP image.');

  const rawNote = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (rawNote.length > MAX_NOTE) throw badRequest(`The note can be at most ${MAX_NOTE} characters.`);
  const note = rawNote || null;
  if (!cloudinaryEnabled) throw new HttpError(503, 'Photo uploads aren’t set up on this server yet.');

  let image;
  try {
    image = await uploadImage(req.file.buffer);
  } catch (err) {
    console.error('Cloudinary upload failed:', err.message);
    throw new HttpError(502, 'The photo couldn’t be uploaded. Please try again.');
  }

  let created;
  try {
    const { rows } = await query(
      'INSERT INTO moments (user_id, image_url, image_public_id, note) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.id, image.url, image.publicId, note],
    );
    ({ rows: [created] } = await query(`${SELECT_MOMENT} WHERE m.id = $1`, [rows[0].id]));
  } catch (err) {
    await deleteImage(image.publicId); // don't leave an orphaned upload behind
    throw err;
  }

  res.status(201).json(created);
  notifyActivity(req.user.id, 'New garden moment', `${req.user.display_name} shared a new garden moment 🌿`, {
    url: `/moments?moment=${created.id}`,
    tag: 'moment',
  });
});

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await query('SELECT user_id, image_public_id FROM moments WHERE id = $1', [id]);
  if (rows.length === 0) throw notFound('That moment could not be found.');
  if (rows[0].user_id !== req.user.id) throw new HttpError(403, 'You can only delete your own moments.');

  await query('DELETE FROM moments WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  await deleteImage(rows[0].image_public_id);
  res.status(204).end();
});

export default router;
