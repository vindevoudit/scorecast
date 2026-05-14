'use strict';

const { AppError } = require('./errors');

// Tier 13.1 — global Express error handler. Routes that throw AppError land
// here with the right status + code; everything else becomes a 500 with the
// stack scrubbed in production. Mounted after the SPA fallback in server.js
// (Express only invokes the 4-arg signature for errors).
//
// Chunk 1 wires this up but doesn't depend on it — existing handlers still
// return errors inline. Chunk 2 will route every handler through here.
function errorMiddleware(err, req, res, _next) {
  if (res.headersSent) {
    // Express's default behavior — let the platform close the response.
    return _next(err);
  }

  const log = req.log || console;

  if (err instanceof AppError) {
    log.warn?.(
      {
        err: { message: err.message, code: err.code, statusCode: err.statusCode },
        path: req.path,
        method: req.method,
      },
      'app error',
    );
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return res.status(err.statusCode).json(body);
  }

  log.error?.({ err, path: req.path, method: req.method }, 'unhandled error');
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: {
      code: 'internal',
      message: 'Internal server error',
      ...(isProd ? {} : { detail: err?.message }),
    },
  });
}

module.exports = errorMiddleware;
