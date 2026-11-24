import { apiUrl } from './config.js?v=2';
import { groupVideos } from './series.js';

const $ = (id) => document.getElementById(id);
const status = (message) => { $('status').textContent = message; };
const sessionKey = 'media-room-token';
let token = sessionStorage.getItem(sessionKey);
let selection = 0;
let refreshId = 0;
let activeParts = [];

function stopPlayback() {
  selection++;
  activeParts = [];
  $('player').querySelector('audio, video')?.pause();
  $('player').replaceChildren();
}

function leave(message = '') {
  token = null;
  sessionStorage.removeItem(sessionKey);
  stopPlayback();
  refreshId++;
  $('library').hidden = true;
  $('entrance').hidden = false;
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
  $('tracks').replaceChildren(...groupVideos(files).map(({ name, parts }) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = parts.length > 1 ? name + ' · ' + parts.length + ' parts' : name;
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = parts[0].key.endsWith('.mp4') ? 'Watch' : 'Listen';
    button.setAttribute('aria-label', button.textContent + ' ' + name);
    button.addEventListener('click', () => play(name, parts, button));
    const actions = document.createElement('div');
    actions.className = 'row track-actions';
    actions.append(button);
    if (parts.length === 1) {
      actions.append(deleteButton(parts[0]));
    } else {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Manage parts';
      const list = document.createElement('ul');
      for (const part of parts) {
        const item = document.createElement('li');
        const filename = document.createElement('span');
        filename.textContent = part.name;
        item.append(filename, deleteButton(part));
        list.append(item);
      }
      details.append(summary, list);
      actions.append(details);
    }
    row.append(label, actions);
    return row;
  }));
  $('empty').hidden = files.length > 0;
}

function deleteButton(file) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary delete';
  button.textContent = 'Delete';
  button.setAttribute('aria-label', 'Delete ' + file.name);
  button.addEventListener('click', async () => {
    if (!window.confirm('Permanently delete “' + file.name + '” from the shared library?')) return;
    button.disabled = true;
    status('Deleting ' + file.name + '…');
    try {
      await request('/media/' + file.key, { method: 'DELETE' });
      if (!token) return;
      if (activeParts.some((part) => part.key === file.key)) stopPlayback();
      try {
        await refresh();
        if (token) status('Deleted ' + file.name + '.');
      } catch {
        if (token) status('Deleted ' + file.name + '. Use Refresh to reload the library.');
      }
    } catch (error) {
      if (token) status('Could not delete ' + file.name + '. ' + error.message);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

async function play(name, parts, button) {
  stopPlayback();
  const attempt = selection;
  activeParts = parts;
  button.disabled = true;
  status('Opening ' + name + '…');
  const label = document.createElement('h3');
  const media = document.createElement(parts[0].key.endsWith('.mp4') ? 'video' : 'audio');
  media.controls = true;
  media.preload = 'metadata';
  media.setAttribute('playsinline', '');
  const series = parts.length > 1;
  let index = 0;

  async function loadPart() {
    const part = parts[index];
    const { url } = await request('/media/' + part.key, { method: 'POST' });
    if (attempt !== selection) return;
    label.textContent = series ? name + ' · Part ' + (index + 1) + ' of ' + parts.length : name;
    media.setAttribute('aria-label', label.textContent);
    media.src = url;
    if (!media.isConnected) $('player').replaceChildren(label, media);
    status('');
    media.play().catch(() => {});
  }

  media.addEventListener('error', () => {
    if (attempt === selection) status('Playback failed. Select Watch or Listen to try again.');
  });
  if (series) {
    media.addEventListener('ended', () => {
      if (attempt !== selection) return;
      index = (index + 1) % parts.length;
      loadPart().catch((error) => {
        if (attempt === selection) status(error.message);
      });
    });
  }
  try {
    await loadPart();
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

