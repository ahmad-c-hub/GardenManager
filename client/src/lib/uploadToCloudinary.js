// Browser → Cloudinary direct uploads, signed by our server. File bytes never
// pass through the API; the server only signs the upload and later verifies
// what actually landed in Cloudinary (it re-checks type and size itself).
import { api } from './api.js';

const MB = 1024 * 1024;

const RULES = {
  image: {
    types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
    maxBytes: 8 * MB,
    noun: 'Photo',
    formats: 'JPEG, PNG, WebP or HEIC',
  },
  video: {
    types: ['video/mp4', 'video/quicktime', 'video/webm'],
    extensions: ['mp4', 'mov', 'webm'],
    maxBytes: 50 * MB,
    noun: 'Video',
    formats: 'MP4, MOV or WebM',
  },
};

const extension = (file) => file.name?.split('.').pop()?.toLowerCase() ?? '';
const formatMb = (bytes) => `${bytes >= 10 * MB ? Math.round(bytes / MB) : (bytes / MB).toFixed(1)} MB`;

/** 'image' | 'video' | null. Some browsers leave HEIC's type empty, so fall back to the extension. */
export function mediaKindOf(file) {
  for (const [kind, rule] of Object.entries(RULES)) {
    if (rule.types.includes(file.type) || (!file.type && rule.extensions.includes(extension(file)))) return kind;
  }
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

/**
 * The friendly reason `file` can't be uploaded as `kind`, or null if it's fine.
 * `kind` is 'map' | 'image' | 'video' (a map is an image).
 */
export function checkUpload(file, kind) {
  const media = kind === 'map' ? 'image' : kind;
  const rule = RULES[media];
  const actual = mediaKindOf(file);
  const known = rule.types.includes(file.type) || rule.extensions.includes(extension(file));
  if (actual !== media || !known) {
    if (kind === 'map') return `“${file.name}” isn’t a photo we can use. Choose a ${rule.formats} image.`;
    return `“${file.name}” isn’t supported. Photos can be ${RULES.image.formats}; videos ${RULES.video.formats}.`;
  }
  if (file.size > rule.maxBytes) {
    return `${rule.noun} is ${formatMb(file.size)} — max is ${formatMb(rule.maxBytes)}.`;
  }
  return null;
}

export class UploadError extends Error {}

/**
 * Upload one file straight to Cloudinary.
 * `kind`: 'map' | 'image' | 'video'. `onProgress(fraction 0–1)` fires as bytes go up.
 * Pass `{ signal }` to cancel. Resolves to { public_id, resource_type }.
 */
export async function uploadToCloudinary(file, kind, onProgress, { signal } = {}) {
  const problem = checkUpload(file, kind);
  if (problem) throw new UploadError(problem);

  const sig = await api.post('/garden-walk/upload-signature', { kind });
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  if (sig.transformation) form.append('transformation', sig.transformation);

  // XHR rather than fetch: fetch has no upload progress events.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/${sig.resourceType}/upload`);
    xhr.responseType = 'json';

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.min(e.loaded / e.total, 1));
    };
    xhr.onload = () => {
      done();
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && body?.public_id) {
        onProgress?.(1);
        resolve({ public_id: body.public_id, resource_type: body.resource_type });
      } else {
        reject(new UploadError(body?.error?.message || `“${file.name}” couldn’t be uploaded. Please try again.`));
      }
    };
    xhr.onerror = () => {
      done();
      reject(new UploadError('The upload was interrupted. Check your connection and try again.'));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    xhr.send(form);
  });
}
