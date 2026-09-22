export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};

/** Called by the auth provider so any 401 anywhere signs the user out of the UI. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body) {
  // FormData (file uploads) is sent as multipart; the browser sets the boundary.
  // The custom header is what the server's CSRF check requires for multipart.
  const isForm = body instanceof FormData;
  let headers;
  if (isForm) headers = { 'X-Requested-With': 'fetch' };
  else if (body !== undefined) headers = { 'Content-Type': 'application/json' };

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onUnauthorized();
    throw new ApiError(res.status, data.error || `Request failed (${res.status}).`, data.details);
  }
  return data;
}

function toQuery(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
}

/**
 * POST a multipart form and read back newline-delimited JSON events as they
 * arrive, calling onEvent(event) for each. Errors before the stream starts
 * (validation, 404, rate limits) throw an ApiError like any other request.
 */
async function stream(path, formData, onEvent) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch' },
      body: formData,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.');
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, data.error || `Request failed (${res.status}).`, data.details);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onEvent(JSON.parse(line));
      }
    }
  } catch (err) {
    if (err instanceof SyntaxError) throw err;
    throw new ApiError(0, 'The connection dropped before the answer finished.');
  }
}

export const api = {
  stream,
  get: (path, params) => request('GET', path + toQuery(params)),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  upload: (path, formData) => request('POST', path, formData),
};
