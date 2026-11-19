import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import {
  cloudinaryEnabled,
  deleteAsset,
  deliveryUrl,
  getAsset,
  signUpload,
  videoPosterUrl,
} from '../lib/cloudinary.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { notifyActivity } from '../lib/push.js';
import { parseId, validate } from '../lib/validate.js';

// Garden Walk: a photo of the garden with pins, each holding photos/videos.
// Files go browser → Cloudinary directly (signed uploads); this router only
// signs uploads, verifies what landed in Cloudinary, and records it.

const router = Router();

const FOLDER = 'garden-manager/garden-walk';
const IMAGE_TRANSFORMATION = 'c_limit,h_1600,w_1600'; // cap the stored original at 1600px on its long edge
const MB = 1024 * 1024;
const LIMITS = {
  image: { formats: new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']), maxBytes: 8 * MB, label: 'Photo' },
  video: { formats: new Set(['mp4', 'mov', 'webm']), maxBytes: 50 * MB, label: 'Video' },
};
const MAX_MEDIA_PER_REQUEST = 20;

// Serialises "which map is current" between map replacement and pin creation,
// so a pin can never be attached to a map that is being replaced.
const MAP_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('garden_walk_map'))";

const pinSchema = {
  label: { type: 'string', required: true, max: 80 },
  note: { type: 'string', max: 1000 },
  x_percent: { type: 'number', required: true, min: 0, max: 100 },
  y_percent: { type: 'number', required: true, min: 0, max: 100 },
};

function requireCloudinary() {
  if (!cloudinaryEnabled) throw new HttpError(503, 'Photo uploads aren’t set up on this server yet.');
}

const formatMb = (bytes) => `${Math.round(bytes / MB)} MB`;

/** Parse `media: [{ public_id, resource_type }]` from a request body. */
function parseMediaList(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest('Add at least one photo or video.');
  if (raw.length > MAX_MEDIA_PER_REQUEST) throw badRequest(`Add at most ${MAX_MEDIA_PER_REQUEST} files at a time.`);
  const seen = new Set();
  return raw.map((item) => {
    const publicId = item?.public_id;
    const resourceType = item?.resource_type;
    if (typeof publicId !== 'string' || publicId.length === 0 || publicId.length > 255) {
      throw badRequest('Each file needs its Cloudinary public_id.');
    }
    if (resourceType !== 'image' && resourceType !== 'video') {
      throw badRequest('Each file’s resource_type must be "image" or "video".');
    }
    if (seen.has(publicId)) throw badRequest('The same file was sent twice.');
    seen.add(publicId);
    return { publicId, resourceType };
  });
}

/**
 * Look the upload up in Cloudinary and check it against our limits.
 * Returns the row fields to store. An asset that is ours but breaks the limits
 * is deleted from Cloudinary; one that isn't ours (wrong folder, or already
 * used by another row) is left alone.
 */
async function verifyUpload({ publicId, resourceType }) {
  const [inUse] = (
    await query(
      'SELECT 1 FROM garden_pin_media WHERE public_id = $1 UNION ALL SELECT 1 FROM garden_maps WHERE public_id = $1',
      [publicId],
    )
  ).rows;
  if (inUse) throw new HttpError(409, 'That file has already been added.');

  let asset;
  try {
    asset = await getAsset(publicId, resourceType);
  } catch (err) {
    console.error(`Cloudinary lookup of ${publicId} failed:`, err.message ?? err.error?.message);
    throw new HttpError(502, 'Couldn’t check the upload with Cloudinary. Please try again.');
  }
  if (!asset) throw badRequest('That upload couldn’t be found. Please upload it again.');

  // Fixed-folder accounts put the folder in the public id; dynamic-folder ones report asset_folder.
  const inFolder = publicId.startsWith(`${FOLDER}/`) || asset.asset_folder === FOLDER || asset.folder === FOLDER;
  if (!inFolder) throw badRequest('That file wasn’t uploaded for Garden Walk.');

  const limits = LIMITS[resourceType];
  const format = String(asset.format ?? '').toLowerCase();
  let problem = null;
  if (!limits.formats.has(format)) {
    problem =
      resourceType === 'image'
        ? `Photos must be JPEG, PNG, WebP or HEIC (this one is ${format || 'unknown'}).`
        : `Videos must be MP4, MOV or WebM (this one is ${format || 'unknown'}).`;
  } else if (asset.bytes > limits.maxBytes) {
    problem = `${limits.label} is ${formatMb(asset.bytes)} — max is ${formatMb(limits.maxBytes)}.`;
  }
  if (problem) {
    await deleteAsset(publicId, resourceType);
    throw badRequest(problem);
  }

  return {
    publicId,
    mediaType: resourceType,
    url: deliveryUrl(publicId, { resourceType, version: asset.version }),
    width: asset.width ?? null,
    height: asset.height ?? null,
    duration: resourceType === 'video' && asset.duration != null ? Number(asset.duration) : null,
  };
}

/**
 * Verify every upload. If any fails, the failing ones are already deleted;
 * the valid ones are kept so the client can resubmit them without re-uploading.
 */
async function verifyUploads(items) {
  const results = await Promise.allSettled(items.map(verifyUpload));
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map((r) => r.value);
}

/** Best-effort cleanup of assets that never made it into the database. */
function discardAssets(assets) {
  return Promise.allSettled(assets.map((a) => deleteAsset(a.publicId, a.mediaType)));
}

async function insertMedia(client, pinId, assets) {
  const {
    rows: [{ next }],
  } = await client.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM garden_pin_media WHERE pin_id = $1', [
    pinId,
  ]);
  for (const [i, a] of assets.entries()) {
    await client.query(
      `INSERT INTO garden_pin_media (pin_id, media_url, public_id, media_type, width, height, duration, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [pinId, a.url, a.publicId, a.mediaType, a.width, a.height, a.duration, next + i],
    );
  }
}

const MEDIA_JSON = `json_build_object(
  'id', m.id, 'media_url', m.media_url, 'public_id', m.public_id, 'media_type', m.media_type,
  'width', m.width, 'height', m.height, 'duration', m.duration, 'position', m.position)`;

const PIN_JSON = `json_build_object(
  'id', p.id, 'label', p.label, 'note', p.note, 'x_percent', p.x_percent, 'y_percent', p.y_percent,
  'created_by', p.created_by, 'created_by_name', u.display_name, 'created_at', p.created_at,
  'media_count', mm.media_count, 'media', mm.media)`;

const PIN_FROM = `
  FROM garden_pins p
  LEFT JOIN users u ON u.id = p.created_by
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS media_count,
           COALESCE(json_agg(${MEDIA_JSON} ORDER BY m.position, m.id), '[]'::json) AS media
    FROM garden_pin_media m
    WHERE m.pin_id = p.id
  ) mm`;

/** Add poster URLs for videos and drop the internal public ids. */
function shapePin(pin) {
  return {
    ...pin,
    media: pin.media.map(({ public_id: publicId, ...m }) =>
      m.media_type === 'video' ? { ...m, poster_url: videoPosterUrl(publicId) } : m,
    ),
  };
}

async function loadPin(id) {
  const { rows } = await query(`SELECT ${PIN_JSON} AS pin ${PIN_FROM} WHERE p.id = $1`, [id]);
  if (rows.length === 0) throw notFound('That spot could not be found.');
  return shapePin(rows[0].pin);
}

router.post('/upload-signature', (req, res) => {
  requireCloudinary();
  const kind = req.body?.kind;
  if (!['map', 'image', 'video'].includes(kind)) throw badRequest('kind must be "map", "image" or "video".');
  res.json(
    kind === 'video'
      ? signUpload({ folder: FOLDER, resourceType: 'video' })
      : signUpload({ folder: FOLDER, resourceType: 'image', transformation: IMAGE_TRANSFORMATION }),
  );
});

router.get('/map', async (_req, res) => {
  const { rows } = await query(`
    WITH cur AS (
      SELECT id, image_url, width, height FROM garden_maps ORDER BY created_at DESC, id DESC LIMIT 1
    )
    SELECT
      (SELECT row_to_json(cur) FROM cur) AS map,
      COALESCE(
        (SELECT json_agg(${PIN_JSON} ORDER BY p.created_at, p.id) ${PIN_FROM} JOIN cur ON cur.id = p.map_id),
        '[]'::json
      ) AS pins`);
  const { map, pins } = rows[0];
  res.json({ map, pins: pins.map(shapePin) });
});

router.post('/map', async (req, res) => {
  requireCloudinary();
  const publicId = req.body?.public_id;
  const [image] = await verifyUploads(parseMediaList([{ public_id: publicId, resource_type: 'image' }]));

  let map;
  let oldPublicIds;
  try {
    ({ map, oldPublicIds } = await withTransaction(async (client) => {
      await client.query(MAP_LOCK_SQL);
      const { rows: old } = await client.query('SELECT id, public_id FROM garden_maps');
      const {
        rows: [created],
      } = await client.query(
        `INSERT INTO garden_maps (image_url, public_id, width, height) VALUES ($1, $2, $3, $4)
         RETURNING id, image_url, width, height`,
        [image.url, image.publicId, image.width, image.height],
      );
      if (old.length > 0) {
        const oldIds = old.map((m) => m.id);
        // Pins keep their percentages, so they stay put on the new photo.
        await client.query('UPDATE garden_pins SET map_id = $1 WHERE map_id = ANY($2::int[])', [created.id, oldIds]);
        await client.query('DELETE FROM garden_maps WHERE id = ANY($1::int[])', [oldIds]);
      }
      return { map: created, oldPublicIds: old.map((m) => m.public_id) };
    }));
  } catch (err) {
    await discardAssets([image]);
    throw err;
  }

  res.status(201).json({ map });
  // The DB is the source of truth: old images are cleaned up after commit, best effort.
  oldPublicIds.forEach((id) => deleteAsset(id, 'image'));
});

router.post('/pins', async (req, res) => {
  requireCloudinary();
  const fields = validate(pinSchema, req.body);
  const assets = await verifyUploads(parseMediaList(req.body.media));

  let pinId;
  try {
    pinId = await withTransaction(async (client) => {
      await client.query(MAP_LOCK_SQL);
      const { rows: maps } = await client.query('SELECT id FROM garden_maps ORDER BY created_at DESC, id DESC LIMIT 1');
      if (maps.length === 0) throw new HttpError(409, 'Upload a photo of the garden before adding spots.');
      const {
        rows: [pin],
      } = await client.query(
        `INSERT INTO garden_pins (map_id, label, x_percent, y_percent, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [maps[0].id, fields.label, fields.x_percent, fields.y_percent, fields.note, req.user.id],
      );
      await insertMedia(client, pin.id, assets);
      return pin.id;
    });
  } catch (err) {
    await discardAssets(assets);
    throw err;
  }

  const pin = await loadPin(pinId);
  res.status(201).json(pin);
  notifyActivity(req.user.id, 'New garden spot', `📍 ${req.user.display_name} added a new spot: ${pin.label}`, {
    url: `/garden-walk?pin=${pin.id}`,
    tag: 'garden-walk',
  });
});

router.put('/pins/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const fields = validate(pinSchema, req.body, { partial: true });
  const cols = Object.keys(fields); // only known schema keys, safe to interpolate
  const { rowCount } = await query(
    `UPDATE garden_pins SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [id, ...cols.map((c) => fields[c])],
  );
  if (rowCount === 0) throw notFound('That spot could not be found.');
  res.json(await loadPin(id));
});

router.post('/pins/:id/media', async (req, res) => {
  requireCloudinary();
  const id = parseId(req.params.id);
  const items = parseMediaList(req.body?.media);
  const { rows: exists } = await query('SELECT 1 FROM garden_pins WHERE id = $1', [id]);
  if (exists.length === 0) throw notFound('That spot could not be found.');
  const assets = await verifyUploads(items);

  try {
    await withTransaction(async (client) => {
      // Lock the pin so concurrent appends/deletes can't hand out the same position.
      const { rows } = await client.query('SELECT id FROM garden_pins WHERE id = $1 FOR UPDATE', [id]);
      if (rows.length === 0) throw notFound('That spot could not be found.');
      await insertMedia(client, id, assets);
    });
  } catch (err) {
    await discardAssets(assets);
    throw err;
  }
  res.status(201).json(await loadPin(id));
});

router.delete('/pins/:id/media/:mediaId', async (req, res) => {
  const id = parseId(req.params.id);
  const mediaId = parseId(req.params.mediaId);

  const removed = await withTransaction(async (client) => {
    const { rows: pins } = await client.query('SELECT id FROM garden_pins WHERE id = $1 FOR UPDATE', [id]);
    if (pins.length === 0) throw notFound('That spot could not be found.');
    const { rows } = await client.query(
      'DELETE FROM garden_pin_media WHERE id = $1 AND pin_id = $2 RETURNING public_id, media_type',
      [mediaId, id],
    );
    if (rows.length === 0) throw notFound('That photo or video could not be found on this spot.');
    const {
      rows: [{ remaining }],
    } = await client.query('SELECT count(*)::int AS remaining FROM garden_pin_media WHERE pin_id = $1', [id]);
    if (remaining === 0) {
      throw badRequest('A spot needs at least one photo or video. Delete the spot instead.');
    }
    await client.query(
      `UPDATE garden_pin_media m SET position = r.pos
       FROM (SELECT id, row_number() OVER (ORDER BY position, id) - 1 AS pos FROM garden_pin_media WHERE pin_id = $1) r
       WHERE m.id = r.id AND m.position <> r.pos`,
      [id],
    );
    return rows[0];
  });

  // After commit: a failed Cloudinary delete only leaves an orphaned file, never a broken row.
  await deleteAsset(removed.public_id, removed.media_type);
  res.status(204).end();
});

router.delete('/pins/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await withTransaction(async (client) => {
    const { rows: pins } = await client.query('SELECT id FROM garden_pins WHERE id = $1 FOR UPDATE', [id]);
    if (pins.length === 0) throw notFound('That spot could not be found.');
    const media = await client.query('SELECT public_id, media_type FROM garden_pin_media WHERE pin_id = $1', [id]);
    await client.query('DELETE FROM garden_pins WHERE id = $1', [id]); // media rows cascade
    return media;
  });

  res.status(204).end();
  // deleteAsset logs its own failures and never rejects; nothing here can block the response.
  Promise.allSettled(rows.map((m) => deleteAsset(m.public_id, m.media_type)));
});

export default router;
