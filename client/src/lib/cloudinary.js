// Sized variants of Cloudinary delivery URLs, so phones don't download the
// full 1600px original for a feed thumbnail. Any other URL is left untouched.

const UPLOAD_URL = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

export const isCloudinary = (url) => UPLOAD_URL.test(url ?? '');

/** Insert a transformation step right after /upload/ (chained before any stored one). */
export function imageVariant(url, transformation) {
  const m = url?.match(UPLOAD_URL);
  return m ? `${m[1]}${transformation}/${m[2]}` : url;
}

const FEED_WIDTHS = [480, 800, 1200];

/** `srcset` for feed cards, or undefined for non-Cloudinary URLs. */
export function feedSrcSet(url) {
  if (!isCloudinary(url)) return undefined;
  return FEED_WIDTHS.map((w) => `${imageVariant(url, `c_limit,w_${w},f_auto,q_auto`)} ${w}w`).join(', ');
}

/** A ~1 KB, 32px-wide copy: used to learn the aspect ratio and as a blur-up placeholder. */
export const tinyVariant = (url) => imageVariant(url, 'c_limit,w_32,f_auto,q_auto:low');

/** Large copy for the lightbox (uploads are already capped at 1600px). */
export const largeVariant = (url) => imageVariant(url, 'c_limit,w_1600,f_auto,q_auto');
