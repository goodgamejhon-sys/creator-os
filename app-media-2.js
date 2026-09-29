function downloadOpenTake() {
  if (!openFile) return;
  const link = document.createElement('a');
  link.href = openFileUrl;
  link.download = openFile.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function shareOpenTake() {
  if (!openFile) return;
  try {
    await navigator.share({ files: [openFile], title: openFile.name });
  } catch (error) {
    if (error.name !== 'AbortError') facts.previewResult += ' · share failed: ' + error.message;
    updateReport();
  }
}

async function renderTakeList() {
  const takes = await getAllTakes();
  const list = $('takeList');
  list.textContent = '';
  if (takes.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'meta';
    empty.textContent = 'No takes yet.';
    list.appendChild(empty);
    return takes;
  }
  for (const take of takes) {
    const item = document.createElement('li');
    const status = take.finished ? '✓ complete' : '⚠ interrupted — recovered';
    item.innerHTML = '<div class="name"></div><div class="meta"></div><div class="row"><button data-open>Open</button><button data-delete>Delete</button></div>';
    item.querySelector('.name').textContent = take.name;
    item.querySelector('.meta').textContent = take.durationSec.toFixed(1) + ' s · ' + formatMB(take.sizeBytes) + ' · ' + status;
    item.querySelector('[data-open]').onclick = () => openTake(take.id);
    const deleteButton = item.querySelector('[data-delete]');
    deleteButton.onclick = async () => {
      if (deleteButton.dataset.armed) {
        await deleteTake(take.id);
        await renderTakeList();
        await updateStorageInfo();
        updateReport();
      } else {
        deleteButton.dataset.armed = 'yes';
        deleteButton.textContent = 'Tap again to delete';
        setTimeout(() => {
          delete deleteButton.dataset.armed;
          deleteButton.textContent = 'Delete';
        }, 3000);
      }
    };
    list.appendChild(item);
  }
  return takes;
}

function formatSupportList() {
  if (!window.MediaRecorder) return '  MediaRecorder not available';
  return FORMATS.map((f) => '  ' + (MediaRecorder.isTypeSupported(f) ? 'yes ' : 'no  ') + f).join('\n');
}

function updateReport() {
  const problems = findEnvironmentProblems();
  $('report').textContent = [
    'CREATOR OS · M0 REPORT (v4)',
    'Date: ' + new Date().toLocaleString(),
    'Page address: ' + location.protocol + '//' + location.host + location.pathname,
    'Browser: ' + browserName,
    'User agent: ' + userAgent,
    'HTTPS/secure: ' + (window.isSecureContext ? 'yes' : 'NO') +
      ' · inside another page: ' + (isEmbedded() ? 'YES' : 'no') +
      ' · camera allowed here: ' + (cameraAllowedHere() ? 'yes' : 'NO'),
    'Environment problems: ' + (problems.length ? problems.join(' | ') : 'none'),
    'Permissions on page load: ' + facts.permissionsOnLoad,
    'Permission attempts:',
    facts.permissionLog.length ? facts.permissionLog.map((l) => '  ' + l).join('\n') : '  none yet',
    'Microphone heard sound: ' + (facts.micHeard ? 'yes' : 'not yet'),
    'Screen kept awake: ' + facts.wakeLock,
    'Studio: layout ' + LAYOUT_NAMES[studioSettings.layout] + ' · floating camera ' + studioSettings.previewSize + ', ' + studioSettings.previewPosition + ' · mode now ' + mode,
    '',
    'CAMERA TRACK (now): ' + (facts.cameraTrack || 'camera not on'),
    'OUTPUT PIPELINE (now): ' + (stream ? describePipeline() : 'camera not on'),
    'Formats this browser can record:',
    formatSupportList(),
    '',
    'LATEST TAKE: ' + (facts.latestTake || 'none yet'),
    'Preview: ' + (facts.previewResult || '—'),
    'Share menu available: ' + facts.shareAvailable,
    '',
    'TELEPROMPTER: script ' + prompterSettings.text.length.toLocaleString() + ' characters · size ' + prompterSettings.fontSize + ' · speed ' + prompterSettings.speed + ' lines/min · position ' + Math.round(prompterSettings.position * 100) + '%',
    'Storage protected: ' + facts.persisted,
    'Storage: ' + (facts.storage || '—'),
  ].join('\n');
}

async function copyReport() {
  updateReport();
  try {
    await navigator.clipboard.writeText($('report').textContent);
    $('copyButton').textContent = '✓ Copied';
  } catch (error) {
    $('copyButton').textContent = 'Copy failed — take a screenshot';
  }
  setTimeout(() => { $('copyButton').textContent = 'Copy report'; }, 2500);
}
