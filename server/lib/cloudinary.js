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
export function deleteImage(publicId) {
  return deleteAsset(publicId, 'image');
}

/** Delete an uploaded image or video. Never throws (failures are logged). */
export async function deleteAsset(publicId, resourceType = 'image') {
  if (!cloudinaryEnabled || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  } catch (err) {
    console.error(`Could not delete Cloudinary ${resourceType} ${publicId}:`, err.message);
  }
}

/**
 * Sign a browser → Cloudinary direct upload. Only the signature leaves the
 * server; the secret never does. Every param signed here must be sent by the
 * browser unchanged, or Cloudinary rejects the upload.
 */
export function signUpload({ folder, resourceType, transformation }) {
  const timestamp = Math.round(Date.now() / 1000);
  const params = { timestamp, folder, ...(transformation ? { transformation } : {}) };
  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    timestamp,
    signature: cloudinary.utils.api_sign_request(params, CLOUDINARY_API_SECRET),
    folder,
    resourceType,
    ...(transformation ? { transformation } : {}),
  };
}

/**
 * The asset as Cloudinary actually stored it (real bytes/format/size), or null
 * if there is no such asset. Used instead of trusting what the browser reports.
 */
export async function getAsset(publicId, resourceType) {
  try {
    // Videos only report duration when media metadata is requested.
    return await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      ...(resourceType === 'video' ? { media_metadata: true } : {}),
    });
  } catch (err) {
    const status = err.error?.http_code ?? err.http_code;
    if (status === 404) return null;
    throw err;
  }
}

/** Secure delivery URL with automatic format and quality. */
export function deliveryUrl(publicId, { resourceType = 'image', version } = {}) {
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    version,
    fetch_format: 'auto',
    quality: 'auto',
    secure: true,
  });
}

/** A JPEG of a video's first frame, for <video poster>. */
export function videoPosterUrl(publicId) {
  return cloudinary.url(publicId, { resource_type: 'video', start_offset: 0, format: 'jpg', secure: true });
}
