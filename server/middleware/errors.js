import { HttpError } from '../lib/errors.js';
import { isProduction } from '../lib/config.js';

// Postgres error codes we can explain to the user instead of returning a 500.
const PG_ERRORS = {
  '23503': [400, 'That references a bed or plant that no longer exists.'],
  '23505': [409, 'That record already exists.'],
  '23514': [400, 'One of the values is out of the allowed range.'],
  '22P02': [400, 'One of the values has the wrong format.'],
  '22003': [400, 'One of the numbers is too large.'],
};

export function notFoundHandler(req, _res, next) {
  next(new HttpError(404, `No API route for ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (err.code && PG_ERRORS[err.code]) {
    const [status, message] = PG_ERRORS[err.code];
    return res.status(status).json({ error: message });
  }

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({
    error: 'Something went wrong on our side. Please try again.',
    ...(isProduction ? {} : { debug: err.message }),
  });
}
