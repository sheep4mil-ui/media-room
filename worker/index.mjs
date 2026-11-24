const encoder = new TextEncoder();
const maxBytes = 95_000_000;

async function sign(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {
    name: 'HMAC', hash: 'SHA-256',
  }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return new Uint8Array(signature).toHex();
}

async function issue(env, purpose, lifetime) {
  const stamp = Math.floor(Date.now() / 1000) + lifetime;
  return stamp + '.' + await sign(env.SESSION_SECRET, purpose + ':' + stamp);
}

async function valid(env, token, purpose) {
  const match = /^(\d{10})\.([0-9a-f]{64})$/.exec(token || '');
  if (!match || Number(match[1]) <= Date.now() / 1000) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), {
    name: 'HMAC', hash: 'SHA-256',
  }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, Uint8Array.fromHex(match[2]), encoder.encode(purpose + ':' + match[1]));
}

function getRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return start <= end ? { offset: start, length: end - start + 1 } : null;
}

async function route(request, env, headers) {
  const url = new URL(request.url);
  const json = (value, status = 200) => Response.json(value, { status, headers });
  if (!env.ENTRANCE_CODE || !env.SESSION_SECRET) return json({ error: 'Storage setup is incomplete.' }, 503);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  if (request.method === 'POST' && url.pathname === '/enter') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.ENTRY_LIMIT.limit({ key: ip });
    if (!success) return json({ error: 'Too many attempts. Try again in a minute.' }, 429);
    const code = await request.text();
    if (code !== env.ENTRANCE_CODE) return json({ error: 'Incorrect entrance code.' }, 401);
    return json({ token: await issue(env, 'session', 12 * 3600) });
  }

  const media = /^\/media\/([a-f0-9-]{36}\.(mp3|mp4))$/.exec(url.pathname);
  if (media && ['GET', 'HEAD'].includes(request.method)) {
    const key = media[1];
    if (!await valid(env, url.searchParams.get('ticket'), 'play:' + key)) return json({ error: 'Reopen this file to play it.' }, 401);
    const object = await env.MEDIA.head(key);
    if (!object) return json({ error: 'File not found.' }, 404);
    headers.set('Content-Type', media[2] === 'mp4' ? 'video/mp4' : 'audio/mpeg');
    headers.set('Accept-Ranges', 'bytes');
    const rangeHeader = request.headers.get('Range');
    const range = rangeHeader ? getRange(rangeHeader, object.size) : undefined;
    if (rangeHeader && !range) {
      headers.set('Content-Range', 'bytes */' + object.size);
      return new Response(null, { status: 416, headers });
    }
    if (range) headers.set('Content-Range', 'bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + object.size);
    headers.set('Content-Length', String(range?.length ?? object.size));
    const body = request.method === 'HEAD' ? null : (await env.MEDIA.get(key, { range }))?.body;
    return new Response(body, { headers, status: range ? 206 : 200 });
  }

  const session = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!await valid(env, session, 'session')) return json({ error: 'Enter the room code again.' }, 401);

  if (request.method === 'GET' && url.pathname === '/files') {
    const result = await env.MEDIA.list({ limit: 100, cursor: url.searchParams.get('cursor') || undefined, include: ['customMetadata'] });
    return json({
      files: result.objects.map((object) => ({
        key: object.key, name: object.customMetadata?.name || object.key, uploaded: object.uploaded,
      })),
      cursor: result.truncated ? result.cursor : null,
    });
  }
  if (request.method === 'PUT' && url.pathname === '/files') {
    const name = url.searchParams.get('name') || '';
    const extension = /\.(mp3|mp4)$/i.exec(name)?.[1].toLowerCase();
    if (!extension || name.length > 255) return json({ error: 'Choose an MP3 or MP4.' }, 400);
    const length = Number(request.headers.get('Content-Length'));
    if (!request.body || !Number.isSafeInteger(length) || length < 1 || length > maxBytes) {
      return json({ error: 'Choose a file between 1 byte and 95 MB.' }, 413);
    }
    const key = crypto.randomUUID() + '.' + extension;
    await env.MEDIA.put(key, request.body, { customMetadata: { name } });
    return json({ key }, 201);
  }
  if (media && request.method === 'POST') {
    const ticket = await issue(env, 'play:' + media[1], 3600);
    return json({ url: url.origin + url.pathname + '?ticket=' + ticket });
  }
  return json({ error: 'Page not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': env.SITE_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Vary': 'Origin',
    });
    if (origin && origin !== env.SITE_ORIGIN) return new Response(null, { status: 403, headers });
    try {
      return await route(request, env, headers);
    } catch {
      return Response.json({ error: 'Storage is unavailable. Try again shortly.' }, { status: 500, headers });
    }
  },
};
