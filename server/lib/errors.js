export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const unauthorized = (message = 'Please sign in to continue.') => new HttpError(401, message);
