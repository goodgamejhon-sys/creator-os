// ---------------------------------------------------------------------
// 14. START
// Nothing here asks for permission. It only reads and displays.
// ---------------------------------------------------------------------

$('cameraButton').onclick = enableCamera;
$('retryButton').onclick = enableCamera;
$('enterStudioButton').onclick = enterStudio;
$('loadButton').onclick = loadScript;
$('scriptInput').addEventListener('input', onScriptInput);
$('fontDown').onclick = () => changeFont(-FONT.step);
$('fontUp').onclick = () => changeFont(FONT.step);
$('speedDown').onclick = () => changeSpeed(-SPEED.step);
$('speedUp').onclick = () => changeSpeed(SPEED.step);
$('setupRestartButton').onclick = restartPrompter;
$('mirrorToggle').onchange = () => $('live').classList.toggle('mirror', $('mirrorToggle').checked);
for (const button of document.querySelectorAll('#sizeChoices button')) {
  button.onclick = () => setPreviewSize(button.dataset.size);
}
for (const button of document.querySelectorAll('#positionChoices button')) {
  button.onclick = () => setPreviewPosition(button.dataset.position);
}
$('downloadButton').onclick = downloadOpenTake;
$('shareButton').onclick = shareOpenTake;
$('copyButton').onclick = copyReport;

$('exitStudioButton').onclick = exitStudio;
$('layoutButton').onclick = cycleStudioLayout;
$('playButton').onclick = () => (prompter.playing ? pausePrompter() : playPrompter());
$('restartButton').onclick = restartPrompter;
$('recordButton').onclick = () => (isRecording() ? stopRecording() : startRecording());
for (const button of document.querySelectorAll('[data-seek]')) {
  button.onclick = () => seekPrompter(Number(button.dataset.seek));
}

const prompterBox = $('prompter');
prompterBox.addEventListener('touchstart', () => { prompter.touching = true; }, { passive: true });
prompterBox.addEventListener('touchend', () => { prompter.touching = false; }, { passive: true });
prompterBox.addEventListener('touchcancel', () => { prompter.touching = false; }, { passive: true });
prompterBox.addEventListener('scroll', () => {
  if (prompter.playing) return;
  clearTimeout(prompter.scrollTimer);
  prompter.scrollTimer = setTimeout(() => { savePrompterSettings(); updateReport(); }, 300);
}, { passive: true });
window.addEventListener('pagehide', savePrompterSettings);
window.addEventListener('resize', () => { if (isStudioOpen()) fitPrompterSpacer(); });

$('scriptInput').value = loadSaved(KEYS.script, '');
renderPrompter();
updatePositionInfo();
applyStudioLayout();
updateCameraPreviewSize();
updateCameraPreviewPosition();

$('live').classList.toggle('mirror', $('mirrorToggle').checked);
showEnvironmentWarning();
updateReport();

readPermissions().then((states) => {
  facts.permissionsOnLoad = 'camera=' + states.camera + ', mic=' + states.microphone;
  updateReport();
});

openDatabase()
  .then(async (database) => {
    db = database;
    if (navigator.storage && navigator.storage.persisted) {
      facts.persisted = (await navigator.storage.persisted()) ? 'yes' : 'not yet (asked when the camera starts)';
    }
    const takes = await renderTakeList();
    await updateStorageInfo();
    const withVideo = takes.filter((t) => t.sizeBytes > 0);
    if (withVideo.length) await openTake(withVideo[withVideo.length - 1].id);
    updateReport();
  })
  .catch((error) => {
    $('report').textContent = 'Database error: ' + error.message;
  });
