const { randomUUID } = require('crypto');
const logger = require('../lib/logger');

const HEADER = 'x-request-id';

function requestId(req, res, next) {
  const incoming = req.headers[HEADER];
  req.id = typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 200
    ? incoming
    : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  req.log = logger.child({ reqId: req.id });
  next();
}

module.exports = requestId;
