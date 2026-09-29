// ---------------------------------------------------------------------
// 5. CAMERA & MICROPHONE PERMISSIONS
// The permission prompt only ever appears because you tapped a button.
// ---------------------------------------------------------------------

let stream = null;

async function readPermission(name) {
  try {
    const status = await navigator.permissions.query({ name: name });
    return status.state;
  } catch (error) {
    return 'not detectable';
  }
}

async function readPermissions() {
  const [camera, microphone] = await Promise.all([readPermission('camera'), readPermission('microphone')]);
  return { camera, microphone };
}

function logPermissionAttempt(outcome, statesBefore, error, elapsedMs) {
  const line = new Date().toLocaleTimeString() + ' · ' + outcome +
    ' · before: camera=' + statesBefore.camera + ', mic=' + statesBefore.microphone +
    (error ? ' · ' + error.name + ': ' + error.message : '') +
    ' · answered in ' + Math.round(elapsedMs) + ' ms';
  facts.permissionLog.push(line);
  console.log('[Creator OS] permission', line);
}

async function enableCamera() {
  hide('permHelp');
  hide('retryButton');
  $('cameraButton').disabled = true;
  $('cameraInfo').className = 'info';
  $('cameraInfo').textContent = 'Waiting for your answer…';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const error = { name: 'Unsupported', message: 'navigator.mediaDevices.getUserMedia is missing' };
    handleCameraFailure(error, 0, { camera: 'not detectable', microphone: 'not detectable' });
    return;
  }
  const askedAt = performance.now();
  const request = navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } },
    audio: true,
  });
  const outcome = request.then(
    (result) => ({ stream: result, elapsed: performance.now() - askedAt }),
    (error) => ({ error: error, elapsed: performance.now() - askedAt })
  );
  const statesBefore = await readPermissions();
  const result = await outcome;
  if (result.error) {
    handleCameraFailure(result.error, result.elapsed, statesBefore);
    return;
  }
  logPermissionAttempt('granted', statesBefore, null, result.elapsed);
  stream = result.stream;
  $('live').srcObject = stream;
  $('live').play().catch(() => {});
  const settings = stream.getVideoTracks()[0].getSettings();
  facts.cameraTrack = settings.width + '×' + settings.height + ' · ' +
    aspectLabel(settings.width, settings.height) + ' · ' +
    Math.round(settings.frameRate || 0) + ' fps · ' + (settings.facingMode || 'unknown') + ' camera';
  $('cameraInfo').className = 'info good';
  $('cameraInfo').textContent = 'Camera on';
  $('cameraButton').textContent = '✓ Camera & microphone on';
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    stopRecording();
    stream = null;
    $('cameraInfo').className = 'info warning';
    $('cameraInfo').textContent = 'Camera stopped. Tap "Try again".';
    $('cameraButton').textContent = 'Enable camera & microphone';
    $('cameraButton').disabled = false;
    show('retryButton');
    $('recordButton').disabled = true;
    if (isStudioOpen()) showStudioToast('Camera stopped — close Studio', 2500);
  });
  $('recordButton').disabled = false;
  startMicMeter(stream);
  startPortraitPipeline();
  keepScreenOn();
  await askForPersistentStorage();
  await updateStorageInfo();
  updateReport();
}

function classifyCameraError(error, elapsedMs, statesBefore) {
  if (statesBefore.camera === 'denied' || statesBefore.microphone === 'denied') {
    return findEnvironmentProblems().length ? 'environment' : 'blocked';
  }
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      if (findEnvironmentProblems().length) return 'environment';
      if (elapsedMs < 400) return 'blocked';
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError': return 'no-device';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError': return 'in-use';
    case 'TypeError':
    case 'NotSupportedError':
    case 'Unsupported': return 'unsupported';
    default: return 'unknown';
  }
}

function blockedSteps() {
  const appName = browserName === 'Samsung Internet' ? 'Samsung Internet' : 'Chrome';
  const phoneStep = 'Still blocked? Phone Settings → Apps → ' + appName +
    ' → Permissions → set Camera and Microphone to Allow.';
  if (browserName === 'Chrome') return [
    'Tap the small icon at the left of the web address.',
    'Tap Permissions (or Site settings).',
    'Set Camera and Microphone to Allow.',
    'Come back here and tap "Try again".', phoneStep,
  ];
  if (browserName === 'Samsung Internet') return [
    'Easiest: open this same address in Chrome instead.',
    'Or: Samsung Internet menu (≡) → Settings → find Site permissions → allow Camera and Microphone for this site.',
    'Come back here and tap "Try again".', phoneStep,
  ];
  return ["Open this browser's settings for this site.", 'Allow Camera and Microphone.', 'Come back here and tap "Try again".'];
}

function handleCameraFailure(error, elapsedMs, statesBefore) {
  const kind = classifyCameraError(error, elapsedMs, statesBefore);
  logPermissionAttempt('failed (' + kind + ')', statesBefore, error, elapsedMs);
  if (kind === 'environment') {
    showEnvironmentWarning();
    fillNotice('permHelp', 'The phone blocked the camera because of where this page is open.', findEnvironmentProblems(), ['Open the Chrome app.', "Paste this page's https:// address.", 'Tap "Enable camera & microphone".']);
  } else if (kind === 'blocked') {
    fillNotice('permHelp', 'Camera or microphone is blocked for this site.', null, blockedSteps());
  } else if (kind === 'denied') {
    fillNotice('permHelp', 'The permission was refused or the prompt was closed.', null, ['Tap "Try again".', 'When the prompt appears, choose Allow for camera and microphone.', 'If no prompt appears, it is now blocked: follow the steps for a blocked site.']);
  } else if (kind === 'no-device') {
    fillNotice('permHelp', 'No camera or microphone was found.', null, ['Check that no case or cover blocks the camera.', 'Tap "Try again".']);
  } else if (kind === 'in-use') {
    fillNotice('permHelp', 'Another app is using the camera or microphone.', null, ['Close the camera app, calls, or any video app.', 'Come back here and tap "Try again".']);
  } else if (kind === 'unsupported') {
    fillNotice('permHelp', "This browser can't use the camera here.", null, ["Open this page's https:// address in the Chrome app."]);
  } else {
    fillNotice('permHelp', 'Unexpected camera error: ' + error.name, [error.message], ['Tap "Try again".', 'If it repeats, copy the report and send it to Claude.']);
  }
  $('cameraInfo').className = 'info error';
  $('cameraInfo').textContent = 'Camera not on (' + error.name + ')';
  $('cameraButton').disabled = false;
  show('retryButton');
  updateReport();
}

let wakeLock = null;
async function keepScreenOn() {
  if (!('wakeLock' in navigator)) {
    facts.wakeLock = 'not supported (set the screen timeout longer)';
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    facts.wakeLock = 'yes';
    wakeLock.addEventListener('release', () => { facts.wakeLock = 'released'; });
  } catch (error) {
    facts.wakeLock = 'failed: ' + error.name;
  }
  updateReport();
}

function startMicMeter(mediaStream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || mediaStream.getAudioTracks().length === 0) {
    $('micStatus').textContent = 'Microphone: no audio track';
    return;
  }
  const audioContext = new AudioContextClass();
  audioContext.resume().catch(() => {});
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(mediaStream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  $('micStatus').textContent = 'Mic on — say something';
  function measure() {
    analyser.getByteTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
    const level = Math.min(1, peak / 64);
    $('micBar').style.width = Math.round(level * 100) + '%';
    if (level > 0.15 && !facts.micHeard) {
      facts.micHeard = true;
      $('micStatus').className = 'info good';
      $('micStatus').textContent = 'Mic ✓ hearing sound';
      updateReport();
    }
    requestAnimationFrame(measure);
  }
  measure();
}

const OUTPUT = { width: 1080, height: 1920, fps: 30 };
const cropFocus = { x: 0.5, y: 0.5 };
const portrait = { canvas: null, context: null, stream: null, running: false, lastCrop: null, frameHandle: null };

function computeCrop(sourceWidth, sourceHeight, focus) {
  const targetRatio = OUTPUT.width / OUTPUT.height;
  let width = sourceWidth;
  let height = sourceHeight;
  if (sourceWidth / sourceHeight > targetRatio) width = Math.round(sourceHeight * targetRatio);
  else height = Math.round(sourceWidth / targetRatio);
  return {
    x: Math.round((sourceWidth - width) * focus.x),
    y: Math.round((sourceHeight - height) * focus.y),
    width, height,
  };
}

function describePipeline() {
  if (!portrait.running) return 'direct camera (canvas recording not available in this browser)';
  const c = portrait.lastCrop;
  if (!c) return 'portrait canvas ' + OUTPUT.width + '×' + OUTPUT.height + ' @ ' + OUTPUT.fps + ' fps · waiting for first frame';
  const scale = OUTPUT.width / c.width;
  return 'portrait canvas ' + OUTPUT.width + '×' + OUTPUT.height + ' @ ' + OUTPUT.fps + ' fps · ' +
    'keeps ' + c.width + '×' + c.height + ' of camera ' + c.sourceWidth + '×' + c.sourceHeight +
    ' (centre crop) · scale ' + scale.toFixed(2) +
    (scale > 1.05 ? ' ⚠ upscaled: softer picture' : ' (no upscaling)');
}

function drawPortraitFrame() {
  if (!portrait.running) return;
  const video = $('live');
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (sourceWidth && sourceHeight) {
    const crop = computeCrop(sourceWidth, sourceHeight, cropFocus);
    portrait.context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, OUTPUT.width, OUTPUT.height);
    const changed = !portrait.lastCrop || portrait.lastCrop.sourceWidth !== sourceWidth || portrait.lastCrop.sourceHeight !== sourceHeight;
    portrait.lastCrop = Object.assign({ sourceWidth, sourceHeight }, crop);
    if (changed) {
      facts.pipeline = describePipeline();
      $('pipelineInfo').textContent = 'Recording pipeline: ' + facts.pipeline;
      updateReport();
    }
  }
  scheduleNextPortraitFrame();
}

function scheduleNextPortraitFrame() {
  const video = $('live');
  portrait.frameHandle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(drawPortraitFrame) : requestAnimationFrame(drawPortraitFrame);
}

function kickPortraitPipeline() {
  if (!portrait.running) return;
  const video = $('live');
  if (portrait.frameHandle !== null) {
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(portrait.frameHandle);
    else cancelAnimationFrame(portrait.frameHandle);
  }
  scheduleNextPortraitFrame();
}

function startPortraitPipeline() {
  if (portrait.running) return;
  if (!HTMLCanvasElement.prototype.captureStream) {
    facts.pipeline = describePipeline();
    return;
  }
  portrait.canvas = document.createElement('canvas');
  portrait.canvas.width = OUTPUT.width;
  portrait.canvas.height = OUTPUT.height;
  portrait.context = portrait.canvas.getContext('2d', { alpha: false });
  portrait.stream = portrait.canvas.captureStream(OUTPUT.fps);
  portrait.running = true;
  scheduleNextPortraitFrame();
  facts.pipeline = describePipeline();
}
