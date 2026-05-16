function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      // Surface the first issue's message into the top-level `error` field
      // so clients that only render error.message (most of ours) show
      // something useful like "Array must contain at most 500 element(s)"
      // instead of the generic "Invalid request body".
      const summary = issues[0]
        ? `${issues[0].path ? `${issues[0].path}: ` : ''}${issues[0].message}`
        : 'Invalid request body';
      return res.status(400).json({ error: summary, issues });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
