// ---------------------------------------------------------------------
// 1. SMALL HELPERS
// ---------------------------------------------------------------------

// Shortcut: $('recordButton') instead of document.getElementById('recordButton')
const $ = (id) => document.getElementById(id);

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

// Describes a width × height shape in words.
function aspectLabel(width, height) {
  if (!width || !height) return '?';
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.01) return '9:16 portrait';
  if (Math.abs(ratio - 16 / 9) < 0.03) return '16:9 landscape';
  return ratio.toFixed(3) + (ratio < 1 ? ' portrait' : ' landscape');
}

// Fills a notice box with a bold title, an optional list, and steps.
// Uses textContent, never innerHTML, so no text can break the page.
function fillNotice(id, title, items, steps) {
  const box = $(id);
  box.textContent = '';
  const heading = document.createElement('b');
  heading.textContent = title;
  box.appendChild(heading);
  for (const [tag, lines] of [['ul', items], ['ol', steps]]) {
    if (!lines || !lines.length) continue;
    const list = document.createElement(tag);
    for (const text of lines) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }
    box.appendChild(list);
  }
  box.classList.remove('hidden');
}

// Small, safe wrappers around the browser's simple storage (localStorage).
function loadSaved(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}
function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

const KEYS = {
  script: 'creatorOS.m0.script',
  prompter: 'creatorOS.m0.prompter',
  studio: 'creatorOS.m0.studio',
};

// Everything the report shows is collected in this one object.
const facts = {
  permissionsOnLoad: 'not read yet',
  permissionLog: [],
  cameraTrack: '',
  pipeline: '',
  micHeard: false,
  wakeLock: 'not requested',
  latestTake: '',
  previewResult: '',
  persisted: 'unknown',
  storage: '',
  shareAvailable: 'unknown',
};


// ---------------------------------------------------------------------
// 2. WHERE IS THIS PAGE RUNNING?
// The camera only works when this page is opened DIRECTLY in a real
// browser from an https:// address.
// ---------------------------------------------------------------------

const userAgent = navigator.userAgent;

function detectBrowser() {
  if (/SamsungBrowser/i.test(userAgent)) return 'Samsung Internet';
  if (/; wv\)/.test(userAgent)) return 'Android app viewer (WebView)';
  if (/EdgA?\//.test(userAgent)) return 'Edge';
  if (/OPR\//.test(userAgent)) return 'Opera';
  if (/Firefox|FxiOS/.test(userAgent)) return 'Firefox';
  if (/CriOS|Chrome\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'Other';
}
const browserName = detectBrowser();

function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch (error) {
    return true;
  }
}

function cameraAllowedHere() {
  const policy = document.permissionsPolicy || document.featurePolicy;
  if (policy && policy.allowsFeature) {
    return policy.allowsFeature('camera') && policy.allowsFeature('microphone');
  }
  return true;
}

function findEnvironmentProblems() {
  const problems = [];
  if (location.protocol === 'file:' || location.protocol === 'content:') {
    problems.push('It was opened as a downloaded file. Phones block the camera for files.');
  } else if (!window.isSecureContext) {
    problems.push('It is not on an https:// address, so the camera is blocked.');
  }
  if (browserName === 'Android app viewer (WebView)') {
    problems.push("It is open inside an app's built-in viewer, which usually blocks the camera.");
  }
  if (isEmbedded()) problems.push('It is running inside another page or a preview window.');
  if (!cameraAllowedHere()) problems.push('This window is not allowed to use the camera or microphone.');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    problems.push('This browser cannot open the camera from a web page.');
  }
  if (!window.MediaRecorder) problems.push('This browser cannot record video from a web page.');
  return problems;
}

function showEnvironmentWarning() {
  const problems = findEnvironmentProblems();
  if (problems.length === 0) {
    hide('envWarning');
    return;
  }
  fillNotice('envWarning', "The camera can't work where this page is open:", problems, [
    'Open the Chrome app.',
    "Type or paste this page's https:// address into the address bar.",
    'Tap "Enable camera & microphone".',
  ]);
}


// ---------------------------------------------------------------------
// 3. DATABASE (IndexedDB)
// The browser's built-in database. It survives closing the tab.
//   takes  → one row per take: name, format, how it was recorded
//   chunks → the video itself, stored as 1-second pieces as they arrive
// ---------------------------------------------------------------------

let db = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('creator-os-spike', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('takes', { keyPath: 'id' });
      const chunks = database.createObjectStore('chunks', { autoIncrement: true });
      chunks.createIndex('byTake', 'takeId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbRun(tableName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(tableName, mode);
    const request = action(transaction.objectStore(tableName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function saveTake(take) {
  return dbRun('takes', 'readwrite', (table) => table.put(take));
}

async function getAllTakes() {
  const takes = await dbRun('takes', 'readonly', (table) => table.getAll());
  return takes.sort((a, b) => a.createdAt - b.createdAt);
}

// Saves one piece of video AND the updated take row in one step.
function saveChunk(take, index, bytes) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['chunks', 'takes'], 'readwrite');
    transaction.objectStore('chunks').add({ takeId: take.id, index: index, data: bytes });
    take.chunkCount = Math.max(take.chunkCount, index + 1);
    take.sizeBytes += bytes.byteLength;
    take.durationSec = (performance.now() - recordingStartedAt) / 1000;
    transaction.objectStore('takes').put(take);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getChunks(takeId) {
  const rows = await dbRun('chunks', 'readonly', (table) => table.index('byTake').getAll(takeId));
  rows.sort((a, b) => a.index - b.index);
  return rows.map((row) => row.data);
}

function deleteTake(takeId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['takes', 'chunks'], 'readwrite');
    transaction.objectStore('takes').delete(takeId);
    const chunks = transaction.objectStore('chunks');
    const cursorRequest = chunks.index('byTake').openKeyCursor(IDBKeyRange.only(takeId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        chunks.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}


// ---------------------------------------------------------------------
// 4. STORAGE SAFETY
// Browser storage is WORKING storage, not a backup.
// ---------------------------------------------------------------------

const LOW_SPACE_BYTES = 300 * 1024 * 1024; // warn below ~300 MB free
const BYTES_PER_MINUTE = 60 * 1024 * 1024; // ~1 minute at 8 Mbps

async function askForPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) {
    facts.persisted = 'not supported';
    return;
  }
  let granted = await navigator.storage.persisted();
  if (!granted) granted = await navigator.storage.persist();
  facts.persisted = granted ? 'yes' : 'no (the browser may clear it if the phone runs low on space)';
}

async function updateStorageInfo() {
  if (!navigator.storage || !navigator.storage.estimate) {
    facts.storage = 'not available on this browser';
    return;
  }
  const { usage, quota } = await navigator.storage.estimate();
  const free = quota - usage;
  facts.storage = formatMB(usage) + ' used of ' + formatMB(quota);
  const line = $('storageInfo');
  if (free < LOW_SPACE_BYTES) {
    line.className = 'info warning';
    line.textContent = 'Storage almost full: ' + facts.storage +
      '. Download your takes and delete old ones before recording again.';
  } else {
    line.className = 'info';
    line.textContent = 'Storage: ' + facts.storage + ' · room for about ' +
      Math.floor(free / BYTES_PER_MINUTE).toLocaleString() + ' min of video.';
  }
}
