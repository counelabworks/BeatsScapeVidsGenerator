const { resolveTrack } = require('../lib/b2');

function send(res, code, obj){
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res){
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const u = new URL(req.url || '/', `${proto}://${host}`);
    const id = u.searchParams.get('id') || '';
    const track = await resolveTrack(id);
    return send(res, 200, track);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'Track lookup failed' });
  }
};
