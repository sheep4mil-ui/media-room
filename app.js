import { apiUrl } from './config.js';

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
  if (!response.ok) throw new Error(body.error || 'Request failed. Try again.');
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

$('upload').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('media').files[0];
  if (!file || !/\.(mp3|mp4)$/i.test(file.name) || !file.size || file.size > 95_000_000) {
    status('Choose an MP3 or MP4 between 1 byte and 95 MB.');
    return;
  }
  $('uploadButton').disabled = true;
  $('media').disabled = true;
  status('Uploading ' + file.name + '…');
  try {
    await request('/files?name=' + encodeURIComponent(file.name), {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
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

