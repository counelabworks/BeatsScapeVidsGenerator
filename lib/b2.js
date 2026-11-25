// Minimal Backblaze B2 helpers for Vercel serverless (signed downloads + file probe).
let cache = null; // { at, auth, bucketId }

function env(name, fallback){
  const v = String(process.env[name] ?? fallback ?? '').trim();
  return v;
}

function cfg(){
  const keyId = env('B2_KEY_ID');
  const appKey = env('B2_APP_KEY');
  const bucket = env('B2_BUCKET');
  const prefix = env('B2_PREFIX', 'recordings').replace(/^\/+|\/+$/g, '');
  const publicBase = env('B2_PUBLIC_BASE').replace(/\/$/, '');
  const signedTtl = Math.max(60, +env('B2_SIGNED_TTL', '604800') || 604800);
  const ready = !!(keyId && appKey && bucket);
  return { ready, keyId, appKey, bucket, prefix, publicBase, signedTtl };
}

function objectKey(fileName){
  const c = cfg();
  const base = String(fileName || '').replace(/^\/+/, '');
  return c.prefix ? `${c.prefix}/${base}` : base;
}

function encodeBzFileName(key){
  return String(key).split('/').map(encodeURIComponent).join('/');
}

async function authorize(force){
  const c = cfg();
  if (!c.ready) throw new Error('B2 is not configured on this deployment');
  if (!force && cache && cache.auth && Date.now() - cache.at < 20 * 60 * 60 * 1000) return cache;
  const basic = Buffer.from(`${c.keyId}:${c.appKey}`).toString('base64');
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `B2 authorize failed (${res.status})`);
  const list = await fetch(`${body.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: 'POST',
    headers: { Authorization: body.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: body.accountId, bucketName: c.bucket }),
  });
  const listed = await list.json().catch(() => ({}));
  if (!list.ok) throw new Error(listed.message || `B2 list buckets failed (${list.status})`);
  const bucket = (listed.buckets || []).find(b => b.bucketName === c.bucket);
  if (!bucket) throw new Error(`B2 bucket not found: ${c.bucket}`);
  cache = { at: Date.now(), auth: body, bucketId: bucket.bucketId };
  return cache;
}

async function fileExists(key){
  const session = await authorize();
  const res = await fetch(`${session.auth.apiUrl}/b2api/v2/b2_list_file_names`, {
    method: 'POST',
    headers: { Authorization: session.auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucketId: session.bucketId,
      prefix: key,
      maxFileCount: 10,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `B2 list failed (${res.status})`);
  const hit = (body.files || []).find(f => f && f.fileName === key);
  return !!hit;
}

async function downloadText(key){
  const c = cfg();
  const session = await authorize();
  const url = `${session.auth.downloadUrl}/file/${encodeURIComponent(c.bucket)}/${encodeBzFileName(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: session.auth.authorizationToken },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`B2 download failed (${res.status})`);
  return res.text();
}

async function signedDownloadUrl(key){
  const c = cfg();
  if (!c.ready || !key) return null;
  if (c.publicBase) return `${c.publicBase}/${encodeBzFileName(key)}`;

  const session = await authorize();
  const auth = await fetch(`${session.auth.apiUrl}/b2api/v2/b2_get_download_authorization`, {
    method: 'POST',
    headers: { Authorization: session.auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucketId: session.bucketId,
      fileNamePrefix: key,
      validDurationInSeconds: c.signedTtl,
    }),
  });
  const meta = await auth.json().catch(() => ({}));
  if (!auth.ok) throw new Error(meta.message || `B2 download auth failed (${auth.status})`);
  const base = `${session.auth.downloadUrl}/file/${encodeURIComponent(c.bucket)}/${encodeBzFileName(key)}`;
  return `${base}?Authorization=${encodeURIComponent(meta.authorizationToken)}`;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*_[0-9]{1,16}$/;

async function resolveTrack(id){
  const safe = ID_RE.test(String(id || '')) ? id : null;
  if (!safe) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }
  const c = cfg();
  if (!c.ready) {
    const err = new Error('Download site is missing B2 credentials');
    err.status = 503;
    throw err;
  }

  const videoName = `${safe}.mp4`;
  const videoKey = objectKey(videoName);
  const metaKey = objectKey(`${safe}.json`);

  let meta = null;
  try {
    const raw = await downloadText(metaKey);
    if (raw) meta = JSON.parse(raw);
  } catch { /* meta optional */ }

  const ready = await fileExists(videoKey);
  if (!ready) {
    return {
      status: 'pending',
      id: safe,
      name: (meta && meta.name) || '',
      genreName: (meta && meta.genreName) || '',
      ts: (meta && meta.ts) || null,
      hasFile: false,
      cloud: true,
    };
  }

  const url = await signedDownloadUrl(videoKey);
  return {
    status: 'ready',
    id: safe,
    name: (meta && meta.name) || safe.split('_')[0] || 'Mix',
    genreName: (meta && meta.genreName) || '',
    ts: (meta && meta.ts) || null,
    hasFile: true,
    video: true,
    cloud: true,
    url,
    urlExpiresIn: c.signedTtl,
  };
}

module.exports = { cfg, resolveTrack, objectKey };
