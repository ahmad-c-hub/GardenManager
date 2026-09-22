import { v2 as cloudinary } from 'cloudinary';

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

/** Photo uploads are optional: without credentials the rest of the app still works. */
export const cloudinaryEnabled = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

if (cloudinaryEnabled) {
  // The secret stays on the server; the browser only ever sees delivery URLs.
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
} else {
  console.warn('Photo uploads (Moments, assistant history) are off: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
}

const DEFAULT_FOLDER = 'garden-manager/moments';

/**
 * Upload an image buffer. The stored original is capped at 1600px on its long
 * edge; the returned URL also asks Cloudinary for automatic format and quality
 * (WebP/AVIF where supported), so the feed stays light.
 * Returns { url, publicId }.
 */
export function uploadImage(buffer, { folder = DEFAULT_FOLDER } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          url: cloudinary.url(result.public_id, {
            version: result.version,
            format: result.format,
            fetch_format: 'auto',
            quality: 'auto',
          }),
          publicId: result.public_id,
        });
      },
    );
    stream.end(buffer);
  });
}

/** Delete an uploaded image. Never throws: a leftover asset isn't worth failing a request over. */
export async function deleteImage(publicId) {
  if (!cloudinaryEnabled || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
  } catch (err) {
    console.error(`Could not delete Cloudinary image ${publicId}:`, err.message);
  }
}
