const crypto = require('node:crypto');
function authorizedCron(req, env = process.env) {
  if (!env.CRON_SECRET) return false;
  const actual = Buffer.from(String(req.headers?.authorization || ''));
  const expected = Buffer.from('Bearer ' + env.CRON_SECRET);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
module.exports = { authorizedCron };
