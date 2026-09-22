import multer from 'multer';
import { HttpError, badRequest } from './errors.js';

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Kept in memory only as long as the request needs it; nothing touches disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 5, fieldSize: 64 * 1024 },
  fileFilter(_req, file, cb) {
    if (IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(badRequest('Please choose a JPEG, PNG or WebP image.'));
  },
});

/** Middleware: accept one optional photo in the "image" field, with friendly errors. */
export function acceptImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof HttpError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'That photo is too large. The limit is 8 MB.'));
    if (err instanceof multer.MulterError) return next(badRequest('Send one photo in the "image" field.'));
    next(err);
  });
}

/** Magic-byte check, so a renamed non-image can't slip past the MIME type. */
export function looksLikeImage(buf) {
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || webp;
}
