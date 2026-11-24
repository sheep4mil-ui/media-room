import { apiUrl } from './config.js?v=2';

const $ = (id) => document.getElementById(id);
const status = (message) => { $('status').textContent = message; };
const sessionKey = 'media-room-token';
let token = sessionStorage.getItem(sessionKey);
let selection = 0;
let refreshId = 0;

function leave(message = '') {
  token = null;
  sessionStorage.removeItem(sessionKey);
  selection++;
  refreshId++;
  $('library').hidden = true;
  $('entrance').hidden = false;
  $('player').replaceChildren();
  $('tracks').replaceChildren();
  status(message);
}

async function request(path, options = {}) {
  if (!apiUrl) throw new Error('Cloud storage setup is still pending.');
  const headers = new Headers(options.headers);
  const session = token;
  if (session) headers.set('Authorization', 'Bearer ' + session);
  const response = await fetch(apiUrl.replace(/\/$/, '') + path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && session && token === session) leave(body.error);
  if (!response.ok) {
    const error = new Error(body.error || 'Request failed (HTTP ' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  return body;
}

async function refresh() {
  const attempt = ++refreshId;
  const files = [];
  let cursor;
  do {
    const page = await request('/files' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    if (attempt !== refreshId) return;
    files.push(...page.files);
    cursor = page.cursor;
  } while (cursor);

  files.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  $('tracks').replaceChildren(...files.map((file) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = file.name;
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = file.key.endsWith('.mp4') ? 'Watch' : 'Listen';
    button.setAttribute('aria-label', button.textContent + ' ' + file.name);
    button.addEventListener('click', () => play(file, button));
    row.append(label, button);
    return row;
  }));
  $('empty').hidden = files.length > 0;
}

async function play(file, button) {
  const attempt = ++selection;
  button.disabled = true;
  status('Opening ' + file.name + '…');
  try {
    const { url } = await request('/media/' + file.key, { method: 'POST' });
    if (attempt !== selection) return;
    const label = document.createElement('h3');
    label.textContent = file.name;
    const media = document.createElement(file.key.endsWith('.mp4') ? 'video' : 'audio');
    media.controls = true;
    media.preload = 'metadata';
    media.setAttribute('playsinline', '');
    media.setAttribute('aria-label', file.name);
    media.addEventListener('error', () => {
      if (media.isConnected) status('Playback failed. Reopen the file or try another browser.');
    });
    media.src = url;
    $('player').replaceChildren(label, media);
    status('');
    media.play().catch(() => {});
  } catch (error) {
    if (attempt === selection) status(error.message);
  } finally {
    button.disabled = false;
  }
}

async function openRoom() {
  $('entrance').hidden = true;
  $('library').hidden = false;
  $('empty').hidden = true;
  status('Loading your library…');
  try {
    await refresh();
    if (token) status('');
  } catch (error) {
    status(error.message);
  }
}

$('gate').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  status('Checking code…');
  try {
    const session = await request('/enter', { method: 'POST', body: $('code').value });
    token = session.token;
    sessionStorage.setItem(sessionKey, token);
    $('gate').reset();
    await openRoom();
  } catch (error) {
    status(error.message);
  } finally {
    button.disabled = false;
  }
});

async function retryUploadStep(path, options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request(path, options);
    } catch (error) {
      const temporary = error instanceof TypeError || error.status >= 500 || error.status === 429;
      if (!temporary || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
}

async function uploadVideo(file) {
  const { key, uploadId, ticket, partBytes } = await request('/uploads/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, size: file.size }),
  });
  const query = new URLSearchParams({ key, id: uploadId, size: String(file.size) });
  const headers = { 'X-Upload-Ticket': ticket };
  const parts = [];
  try {
    for (let offset = 0; offset < file.size; offset += partBytes) {
      if (!token) throw new Error('You left the room.');
      const end = Math.min(offset + partBytes, file.size);
      const part = await retryUploadStep('/uploads/part?' + query + '&part=' + (parts.length + 1), {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        body: file.slice(offset, end),
      });
      parts.push(part);
      status('Uploading ' + file.name + '… ' + Math.floor(end / file.size * 100) + '%');
    }
    status('Finishing ' + file.name + '…');
    await retryUploadStep('/uploads/complete?' + query, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts }),
    });
  } catch (error) {
    if (token) request('/uploads/abort?' + query, { method: 'POST', headers }).catch(() => {});
    throw error;
  }
}

$('upload').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('media').files[0];
  const isVideo = /\.mp4$/i.test(file?.name || '');
  if (!file || !/\.(mp3|mp4)$/i.test(file.name) || !file.size || file.size > (isVideo ? 5_000_000_000 : 95_000_000)) {
    status('Choose an MP3 up to 95 MB or an MP4 up to 5 GB.');
    return;
  }
  $('uploadButton').disabled = true;
  $('media').disabled = true;
  status('Uploading ' + file.name + '…');
  try {
    if (isVideo && file.size > 16 * 1024 * 1024) {
      await uploadVideo(file);
    } else {
      await request('/files?name=' + encodeURIComponent(file.name), {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
    }
    $('upload').reset();
    if (!token) return;
    try {
      await refresh();
      if (token) status('Uploaded ' + file.name + '.');
    } catch {
      if (token) status('Uploaded ' + file.name + '. Use Refresh to reload the library.');
    }
  } catch (error) {
    if (token) status('Upload failed. ' + error.message);
  } finally {
    $('uploadButton').disabled = false;
    $('media').disabled = false;
  }
});

$('logout').addEventListener('click', () => leave());
$('refresh').addEventListener('click', openRoom);
if (token) openRoom();

