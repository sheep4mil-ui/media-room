export function setupAudioOutput(getPlayer) {
  const devices = navigator.mediaDevices;
  const select = document.getElementById('audio-output');
  const picker = document.getElementById('pick-output');
  const message = document.getElementById('output-status');
  if (!devices || typeof HTMLMediaElement === 'undefined' || !HTMLMediaElement.prototype.setSinkId) {
    message.textContent = 'Use your device’s sound settings to change audio output.';
    return async () => {};
  }

  const canPick = typeof devices.selectAudioOutput === 'function';
  const defaultOnly = 'Only the system default is available here. Change outputs in your device’s sound settings.';
  let selected = { deviceId: '', label: 'System default' };
  let busy = false;
  let revision = 0;

  async function refresh() {
    const attempt = ++revision;
    let outputs = [];
    try {
      outputs = (await devices.enumerateDevices()).filter(({ kind, deviceId }) => (
        kind === 'audiooutput' && deviceId && deviceId !== 'default'
      ));
    } catch {
      // The system default stays available when output enumeration is blocked.
    }
    if (attempt !== revision) return;
    if (selected.deviceId && !outputs.some(({ deviceId }) => deviceId === selected.deviceId)) {
      outputs.push(selected);
    }
    select.replaceChildren(new Option('System default', ''), ...outputs.map((output, index) =>
      new Option(output.label || 'Audio output ' + (index + 1), output.deviceId)));
    select.value = selected.deviceId;
    select.hidden = false;
    picker.hidden = !canPick;
    if (!outputs.length && !canPick) {
      message.textContent = defaultOnly;
    } else if (message.textContent === defaultOnly) {
      message.textContent = '';
    }
  }

  async function switchOutput(choose) {
    if (busy) return;
    busy = true;
    select.disabled = true;
    picker.disabled = true;
    try {
      const output = await choose();
      const player = getPlayer() || document.createElement('audio');
      await player.setSinkId(output.deviceId);
      selected = output;
      const current = getPlayer();
      if (current && current !== player) await current.setSinkId(selected.deviceId);
      message.textContent = 'Audio output: ' + (output.label || 'Selected device');
    } catch (error) {
      message.textContent = error.name === 'NotAllowedError'
        ? 'Output selection was canceled or blocked. Use your device’s sound settings if needed.'
        : 'Could not switch audio output. Check that the device is connected.';
    } finally {
      await refresh();
      select.disabled = false;
      picker.disabled = false;
      busy = false;
    }
  }

  select.addEventListener('change', () => {
    const option = select.selectedOptions[0];
    switchOutput(() => ({ deviceId: option.value, label: option.textContent }));
  });
  picker.addEventListener('click', () => switchOutput(() => devices.selectAudioOutput()));
  devices.addEventListener('devicechange', refresh);
  refresh();

  return async (media) => {
    if (!selected.deviceId || media.sinkId === selected.deviceId) return;
    try {
      await media.setSinkId(selected.deviceId);
    } catch {
      if (!media.sinkId) {
        message.textContent = 'The selected output is unavailable. This file is using the system default.';
      } else {
        message.textContent = 'Could not change the audio output for this file.';
      }
    }
  };
}
