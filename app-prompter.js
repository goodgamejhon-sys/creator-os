// ---------------------------------------------------------------------
// 8. TELEPROMPTER
// One teleprompter, one position. Speed is in LINES per minute, so a
// bigger font doesn't secretly make you read faster.
// Position is saved as a fraction of the text's height (0 = start,
// 1 = end), so it survives reloads, font changes and layout changes.
// ---------------------------------------------------------------------

const FONT = { min: 18, max: 72, step: 4 };
const SPEED = { min: 6, max: 90, step: 3 };

const prompterSettings = Object.assign(
  { text: '', fontSize: 32, speed: 36, position: 0 },
  loadSaved(KEYS.prompter, {})
);
const prompter = { playing: false, exact: 0, lastWritten: 0, lastTime: 0, touching: false, lastSave: 0 };

function lineHeight() { return prompterSettings.fontSize * 1.35; }
function pixelsPerSecond() { return (prompterSettings.speed * lineHeight()) / 60; }
function textHeight() { return $('prompterText').offsetHeight; }
function maxScroll() { const box = $('prompter'); return Math.max(0, box.scrollHeight - box.clientHeight); }

function fitPrompterSpacer() {
  const box = $('prompter');
  const paddingTop = parseFloat(getComputedStyle(box).paddingTop) || 0;
  const space = box.clientHeight - paddingTop - lineHeight() * 2;
  $('prompterSpacer').style.height = Math.max(0, Math.round(space)) + 'px';
}

function savePrompterSettings() {
  if (isStudioOpen()) {
    const height = textHeight();
    prompterSettings.position = height > 0 ? Math.min(1, $('prompter').scrollTop / height) : 0;
  }
  saveLocal(KEYS.prompter, prompterSettings);
  updatePositionInfo();
}

function updatePositionInfo() {
  const percent = Math.round(prompterSettings.position * 100);
  $('positionInfo').textContent = 'Position: ' + (percent === 0 ? 'start' : percent + '% through the script');
}

function renderPrompter() {
  const text = $('prompterText');
  if (prompterSettings.text.trim()) {
    text.textContent = prompterSettings.text;
    text.classList.remove('placeholder');
  } else {
    text.textContent = 'No script yet. Close Studio (✕), paste your script, and tap "Load into teleprompter".';
    text.classList.add('placeholder');
  }
  text.style.fontSize = prompterSettings.fontSize + 'px';
  $('fontValue').textContent = prompterSettings.fontSize;
  $('speedValue').textContent = prompterSettings.speed;
}

function restorePosition(fraction) {
  const box = $('prompter');
  box.scrollTop = Math.max(0, fraction * textHeight());
  prompter.exact = box.scrollTop;
  prompter.lastWritten = box.scrollTop;
}

function prompterTick(now) {
  if (!prompter.playing) return;
  const box = $('prompter');
  const seconds = prompter.lastTime ? Math.min(0.1, (now - prompter.lastTime) / 1000) : 0;
  prompter.lastTime = now;
  if (Math.abs(box.scrollTop - prompter.lastWritten) > 2) prompter.exact = box.scrollTop;
  if (!prompter.touching) prompter.exact += pixelsPerSecond() * seconds;
  if (prompter.exact >= maxScroll()) {
    box.scrollTop = maxScroll();
    pausePrompter();
    return;
  }
  box.scrollTop = prompter.exact;
  prompter.lastWritten = box.scrollTop;
  if (now - prompter.lastSave > 1000) {
    savePrompterSettings();
    prompter.lastSave = now;
  }
  requestAnimationFrame(prompterTick);
}

function playPrompter() {
  if (!prompterSettings.text.trim()) return;
  const box = $('prompter');
  prompter.playing = true;
  prompter.exact = box.scrollTop;
  prompter.lastWritten = box.scrollTop;
  prompter.lastTime = 0;
  $('playButton').textContent = '❚❚ Pause';
  requestAnimationFrame(prompterTick);
}

function pausePrompter() {
  prompter.playing = false;
  $('playButton').textContent = '▶ Play';
  savePrompterSettings();
}

function restartPrompter() {
  pausePrompter();
  const box = $('prompter');
  box.scrollTop = 0;
  prompter.exact = 0;
  prompter.lastWritten = 0;
  prompterSettings.position = 0;
  saveLocal(KEYS.prompter, prompterSettings);
  updatePositionInfo();
}

function seekPrompter(seconds) {
  const box = $('prompter');
  const from = prompter.playing ? prompter.exact : box.scrollTop;
  const target = Math.min(maxScroll(), Math.max(0, from + pixelsPerSecond() * seconds));
  box.scrollTop = target;
  prompter.exact = target;
  prompter.lastWritten = box.scrollTop;
  savePrompterSettings();
}

function changeFont(step) {
  prompterSettings.fontSize = Math.min(FONT.max, Math.max(FONT.min, prompterSettings.fontSize + step));
  renderPrompter();
  saveLocal(KEYS.prompter, prompterSettings);
}
function changeSpeed(step) {
  prompterSettings.speed = Math.min(SPEED.max, Math.max(SPEED.min, prompterSettings.speed + step));
  renderPrompter();
  saveLocal(KEYS.prompter, prompterSettings);
}

function loadScript() {
  pausePrompter();
  prompterSettings.text = $('scriptInput').value;
  prompterSettings.position = 0;
  renderPrompter();
  restartPrompter();
  const saved = saveLocal(KEYS.prompter, prompterSettings) && saveLocal(KEYS.script, $('scriptInput').value);
  $('scriptSaved').textContent = saved ? '✓ Loaded and saved on this phone. Tap "Enter Studio" when ready.' : '⚠ Loaded, but could not be saved';
  updateReport();
}

let scriptSaveTimer = null;
function onScriptInput() {
  clearTimeout(scriptSaveTimer);
  scriptSaveTimer = setTimeout(() => {
    const saved = saveLocal(KEYS.script, $('scriptInput').value);
    $('scriptSaved').textContent = saved ? '✓ Script saved on this phone' : '⚠ Could not save the script';
  }, 400);
}

let mode = 'setup';
const LAYOUTS = ['prompter-focus', 'camera-focus', 'split-view'];
const LAYOUT_NAMES = {
  'prompter-focus': 'Prompter Focus',
  'camera-focus': 'Camera Focus',
  'split-view': 'Split View',
};
const PREVIEW_SIZES = ['small', 'medium'];
const PREVIEW_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const studioSettings = Object.assign(
  { layout: 'prompter-focus', previewSize: 'small', previewPosition: 'bottom-right' },
  loadSaved(KEYS.studio, {})
);
if (!LAYOUTS.includes(studioSettings.layout)) studioSettings.layout = 'prompter-focus';
if (!PREVIEW_SIZES.includes(studioSettings.previewSize)) studioSettings.previewSize = 'small';
if (!PREVIEW_POSITIONS.includes(studioSettings.previewPosition)) studioSettings.previewPosition = 'bottom-right';

function isStudioOpen() { return mode === 'studio'; }
function isRecording() { return !!(recorder && recorder.state === 'recording'); }

let toastTimer = null;
function showStudioToast(text, milliseconds = 1000) {
  const toast = $('studioToast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), milliseconds);
}

async function enterStudio() {
  if (!stream) {
    await enableCamera();
    if (!stream) {
      $('permHelp').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }
  mode = 'studio';
  document.body.classList.add('mode-studio');
  history.pushState({ studio: true }, '');
  applyStudioLayout();
  updateCameraPreviewSize();
  updateCameraPreviewPosition();
  fitPrompterSpacer();
  restorePosition(prompterSettings.position);
  $('live').play().catch(() => {});
  kickPortraitPipeline();
  if (!wakeLock || wakeLock.released) keepScreenOn();
  updateReport();
}

function exitStudio() {
  if (isRecording()) {
    showStudioToast('Stop recording first', 1500);
    return;
  }
  if (history.state && history.state.studio) history.back();
  else leaveStudio();
}

function leaveStudio() {
  if (prompter.playing) pausePrompter();
  savePrompterSettings();
  mode = 'setup';
  document.body.classList.remove('mode-studio');
  updateReport();
}

window.addEventListener('popstate', () => {
  if (!isStudioOpen()) return;
  if (isRecording()) {
    history.pushState({ studio: true }, '');
    showStudioToast('Stop recording first', 1500);
    return;
  }
  leaveStudio();
});

function applyStudioLayout() {
  const studio = $('studio');
  const box = $('prompter');
  const keepTop = prompter.playing ? prompter.exact : box.scrollTop;
  for (const layout of LAYOUTS) studio.classList.toggle(layout, layout === studioSettings.layout);
  fitPrompterSpacer();
  if (isStudioOpen()) {
    box.scrollTop = keepTop;
    prompter.exact = keepTop;
    prompter.lastWritten = box.scrollTop;
  }
}

function setStudioLayout(layout) {
  if (!LAYOUTS.includes(layout)) return;
  studioSettings.layout = layout;
  saveLocal(KEYS.studio, studioSettings);
  applyStudioLayout();
  showStudioToast(LAYOUT_NAMES[layout]);
  updateReport();
}
function cycleStudioLayout() {
  const next = (LAYOUTS.indexOf(studioSettings.layout) + 1) % LAYOUTS.length;
  setStudioLayout(LAYOUTS[next]);
}

function updateCameraPreviewSize() {
  const frame = $('cameraFrame');
  for (const size of PREVIEW_SIZES) frame.classList.toggle('size-' + size, size === studioSettings.previewSize);
  for (const button of document.querySelectorAll('#sizeChoices button')) button.setAttribute('aria-pressed', String(button.dataset.size === studioSettings.previewSize));
}
function updateCameraPreviewPosition() {
  const frame = $('cameraFrame');
  for (const position of PREVIEW_POSITIONS) frame.classList.toggle('pos-' + position, position === studioSettings.previewPosition);
  for (const button of document.querySelectorAll('#positionChoices button')) button.setAttribute('aria-pressed', String(button.dataset.position === studioSettings.previewPosition));
}
function setPreviewSize(size) {
  if (!PREVIEW_SIZES.includes(size)) return;
  studioSettings.previewSize = size;
  saveLocal(KEYS.studio, studioSettings);
  updateCameraPreviewSize();
}
function setPreviewPosition(position) {
  if (!PREVIEW_POSITIONS.includes(position)) return;
  studioSettings.previewPosition = position;
  saveLocal(KEYS.studio, studioSettings);
  updateCameraPreviewPosition();
}
