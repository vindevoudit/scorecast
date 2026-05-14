'use strict';

// Tier 13.1 — domain-level error class used by services + the global error
// middleware. Routes / services throw AppError instead of hand-rolling
// res.status(...).json(...) so the response shape stays consistent.
//
// Chunk 1 ships the class + factories; Chunk 2 will rewrite handlers to use
// them. Existing routes keep their inline res.status() for now.
class AppError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== null && details !== undefined) {
      this.details = details;
    }
  }
}

function badRequest(message, details) {
  return new AppError(400, 'bad_request', message, details);
}

function validation(message, details) {
  return new AppError(400, 'validation', message, details);
}

function unauthorized(message = 'Authentication required') {
  return new AppError(401, 'unauthorized', message);
}

function forbidden(message = 'Access denied') {
  return new AppError(403, 'forbidden', message);
}

function notFound(message = 'Not found') {
  return new AppError(404, 'not_found', message);
}

function conflict(message, details) {
  return new AppError(409, 'conflict', message, details);
}

function tooManyRequests(message = 'Too many requests') {
  return new AppError(429, 'rate_limited', message);
}

function internal(message = 'Internal server error') {
  return new AppError(500, 'internal', message);
}

module.exports = {
  AppError,
  badRequest,
  validation,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  internal,
};
