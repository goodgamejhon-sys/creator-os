// ---------------------------------------------------------------------
// 10. RECORDING
// Records the portrait canvas (picture) + the microphone (sound).
// Each 1-second piece goes straight into the database.
// ---------------------------------------------------------------------

const FORMATS = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

let recorder = null;
let currentTake = null;
let chunkIndex = 0;
let pendingWrites = [];
let recordingStartedAt = 0;
let timerId = null;

function pickFormat() {
  return FORMATS.find((format) => MediaRecorder.isTypeSupported(format)) || '';
}

async function startRecording() {
  if (!window.MediaRecorder) {
    showStudioToast('This browser cannot record video', 2000);
    return;
  }
  if (!stream) {
    showStudioToast('Camera is off', 1500);
    return;
  }
  const takes = await getAllTakes();
  const format = pickFormat();
  const options = {
    videoBitsPerSecond: 8000000,
    audioBitsPerSecond: 128000,
    videoKeyFrameIntervalDuration: 1000,
  };
  if (format) options.mimeType = format;
  const recordingStream = portrait.running
    ? new MediaStream([...portrait.stream.getVideoTracks(), ...stream.getAudioTracks()])
    : stream;
  try {
    recorder = new MediaRecorder(recordingStream, options);
  } catch (error) {
    showStudioToast('Could not start recording', 2000);
    $('recStatus').textContent = error.message;
    return;
  }
  currentTake = {
    id: 'take-' + Date.now(),
    name: 'Take ' + (takes.length + 1),
    mimeType: format || 'browser default',
    createdAt: Date.now(),
    finished: false,
    chunkCount: 0,
    sizeBytes: 0,
    durationSec: 0,
    cameraTrack: facts.cameraTrack,
    pipeline: describePipeline(),
  };
  chunkIndex = 0;
  pendingWrites = [];
  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0) return;
    const index = chunkIndex++;
    const take = currentTake;
    const write = event.data.arrayBuffer().then((bytes) => saveChunk(take, index, bytes));
    pendingWrites.push(write);
  };
  recorder.onstop = finishTake;
  recorder.onerror = (event) => {
    $('recStatus').textContent = 'Recording error: ' + (event.error ? event.error.message : 'unknown');
  };
  recorder.start(1000);
  recordingStartedAt = performance.now();
  currentTake.mimeType = recorder.mimeType || currentTake.mimeType;
  await saveTake(currentTake);
  $('recordButton').textContent = '■ Stop';
  $('exitStudioButton').style.opacity = '0.35';
  $('recStatus').className = 'rec-status recording';
  timerId = setInterval(() => {
    const seconds = (performance.now() - recordingStartedAt) / 1000;
    $('recStatus').textContent = '● REC ' + formatTime(seconds);
  }, 250);
}

function stopRecording() {
  if (isRecording()) recorder.stop();
}

async function finishTake() {
  clearInterval(timerId);
  $('recordButton').textContent = '● Rec';
  $('exitStudioButton').style.opacity = '';
  $('recStatus').className = 'rec-status';
  $('recStatus').textContent = 'Saving…';
  const results = await Promise.allSettled(pendingWrites);
  const failed = results.filter((r) => r.status === 'rejected').length;
  currentTake.finished = true;
  currentTake.durationSec = (performance.now() - recordingStartedAt) / 1000;
  await saveTake(currentTake);
  $('recStatus').className = failed ? 'rec-status warning' : 'rec-status good';
  $('recStatus').textContent = failed ? '⚠ ' + failed + ' piece(s) failed' : '✓ ' + currentTake.name + ' saved';
  if (isStudioOpen()) showStudioToast('✓ ' + currentTake.name + ' saved', 1500);
  await updateStorageInfo();
  await renderTakeList();
  await openTake(currentTake.id);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopRecording();
    if (prompter.playing) pausePrompter();
  } else if (stream && (!wakeLock || wakeLock.released)) {
    keepScreenOn();
  }
});

function checkVideoSignature(buffer) {
  if (!buffer || buffer.byteLength < 12) return { ok: false, container: '', label: '✗ too small to be a video' };
  const b = new Uint8Array(buffer, 0, 12);
  if (String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') {
    return { ok: true, container: 'video/mp4', label: '✓ real MP4 video data' };
  }
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) {
    return { ok: true, container: 'video/webm', label: '✓ real WebM video data' };
  }
  return { ok: false, container: '', label: '✗ does not start like a video file' };
}

const VIDEO_TAGS = [
  ['vp09', 'VP9'], ['V_VP9', 'VP9'], ['av01', 'AV1'], ['V_AV1', 'AV1'],
  ['hvc1', 'H.265'], ['hev1', 'H.265'], ['V_VP8', 'VP8'],
  ['avc1', 'H.264'], ['V_MPEG4/ISO/AVC', 'H.264'],
];
const AUDIO_TAGS = [['Opus', 'Opus'], ['A_OPUS', 'Opus'], ['mp4a', 'AAC'], ['A_AAC', 'AAC']];

function detectCodecs(buffer) {
  const text = new TextDecoder('latin1').decode(new Uint8Array(buffer).slice(0, 65536));
  const video = VIDEO_TAGS.find(([tag]) => text.includes(tag));
  const audio = AUDIO_TAGS.find(([tag]) => text.includes(tag));
  return { video: video ? video[1] : 'unknown', audio: audio ? audio[1] : 'unknown' };
}

const CODEC_NAMES = {
  avc1: 'H.264', avc3: 'H.264', hvc1: 'H.265', hev1: 'H.265',
  vp09: 'VP9', av01: 'AV1', mp4a: 'AAC', Opus: 'Opus',
};
