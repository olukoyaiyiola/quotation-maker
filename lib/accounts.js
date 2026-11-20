const { createHash, randomBytes } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
async function redis(...command) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw Error('Storage unavailable');
  return data.result;
}
function sessionKey(req) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)__Host-bumick=([a-f0-9]{64})(?:;|$)/);
  return match && 'bumick:session:' + digest(match[1]);
}
async function user(req) {
  const key = sessionKey(req);
  return key && JSON.parse(await redis('GET',key));
}
const profileKey = 'bumick:company:profile';
module.exports = {redis, user, token, digest, sessionKey, profileKey};
