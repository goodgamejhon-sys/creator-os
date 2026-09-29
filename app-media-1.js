function analyzeMp4(buffer) {
  const view = new DataView(buffer);
  const tracks = {};
  let track = null;
  let fragmentTrackId = null;
  const CONTAINERS = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf', 'edts', 'dinf'];
  const name = (at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  function walk(start, end) {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      const type = name(at + 4);
      let header = 8;
      if (size === 1) { size = Number(view.getBigUint64(at + 8)); header = 16; }
      else if (size === 0) size = end - at;
      if (size < header || at + size > end) break;
      const body = at + header;
      if (type === 'trak') {
        track = {};
        walk(body, at + size);
        if (track.id) tracks[track.id] = track;
        track = null;
      } else if (CONTAINERS.includes(type)) {
        walk(body, at + size);
      } else if (type === 'tkhd' && track) {
        const version = view.getUint8(body);
        let p = body + 4 + (version === 1 ? 16 : 8);
        track.id = view.getUint32(p);
        p += 4 + 4 + (version === 1 ? 8 : 4) + 16;
        const a = view.getInt32(p) / 65536;
        const b = view.getInt32(p + 4) / 65536;
        const clockwise = (Math.round(Math.atan2(b, a) * 180 / Math.PI) + 360) % 360;
        track.rotation = (360 - clockwise) % 360;
      } else if (type === 'hdlr' && track) {
        track.kind = name(body + 8);
      } else if (type === 'stsd' && track) {
        const entry = body + 8;
        track.codec = name(entry + 4);
        if (track.kind === 'vide') {
          track.width = view.getUint16(entry + 32);
          track.height = view.getUint16(entry + 34);
        }
      } else if (type === 'stsz' && track) {
        track.samples = (track.samples || 0) + view.getUint32(body + 8);
      } else if (type === 'tfhd') {
        fragmentTrackId = view.getUint32(body + 4);
      } else if (type === 'trun' && tracks[fragmentTrackId]) {
        const t = tracks[fragmentTrackId];
        t.samples = (t.samples || 0) + view.getUint32(body + 4);
      }
      at += size;
    }
  }
  walk(0, buffer.byteLength);
  const all = Object.values(tracks);
  return { video: all.find((t) => t.kind === 'vide'), audio: all.find((t) => t.kind === 'soun') };
}

let openFile = null;
let openFileUrl = null;

function renderFileDetails(rows) {
  const box = $('fileDetails');
  box.textContent = '';
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = label + ': ';
    row.appendChild(name);
    row.appendChild(document.createTextNode(value));
    box.appendChild(row);
  }
  show('fileDetails');
}

async function openTake(takeId) {
  const takes = await getAllTakes();
  const take = takes.find((t) => t.id === takeId);
  if (!take) return;
  $('downloadButton').disabled = true;
  $('downloadButton').textContent = 'Checking file…';
  hide('shareButton');
  const pieces = await getChunks(takeId);
  if (pieces.length === 0) {
    const player = $('player');
    player.removeAttribute('src');
    hide('player');
    show('emptyPlayer');
    $('emptyPlayer').textContent = take.name + ' has no saved video: it stopped before the first piece was stored.';
    renderFileDetails([['File', 'empty']]);
    $('downloadButton').textContent = 'Nothing to download';
    facts.previewResult = 'no video in this take';
    facts.latestTake = take.name + ' (' + new Date(take.createdAt).toLocaleString() + ')\n  empty: stopped before the first piece was stored';
    updateReport();
    return;
  }
  const signature = checkVideoSignature(pieces[0]);
  const type = signature.container || take.mimeType.split(';')[0];
  const extension = type === 'video/mp4' ? 'mp4' : type === 'video/webm' ? 'webm' : 'bin';
  const fileName = 'creator-os-' + take.name.toLowerCase().replace(/\s+/g, '-') + '.' + extension;
  openFile = new File(pieces, fileName, { type: type });
  if (openFileUrl) URL.revokeObjectURL(openFileUrl);
  openFileUrl = URL.createObjectURL(openFile);
  const buffer = await openFile.arrayBuffer();
  let mp4 = null;
  if (signature.container === 'video/mp4') {
    try { mp4 = analyzeMp4(buffer); } catch (error) { mp4 = null; }
  }
  const tagged = detectCodecs(buffer);
  const videoTrack = mp4 && mp4.video;
  const videoCodec = videoTrack ? (CODEC_NAMES[videoTrack.codec] || videoTrack.codec) + ' (' + videoTrack.codec + ')' : tagged.video;
  const audioCodec = mp4 && mp4.audio ? (CODEC_NAMES[mp4.audio.codec] || mp4.audio.codec) + ' (' + mp4.audio.codec + ')' : tagged.audio;
  const build = (player) => {
    const duration = player && isFinite(player.duration) && player.duration > 0 ? player.duration : take.durationSec;
    const rotation = videoTrack ? videoTrack.rotation : 0;
    let encoded = '?';
    let playsWidth = player ? player.videoWidth : 0;
    let playsHeight = player ? player.videoHeight : 0;
    if (videoTrack && videoTrack.width) {
      encoded = videoTrack.width + '×' + videoTrack.height + ' · ' + aspectLabel(videoTrack.width, videoTrack.height);
      if (!playsWidth) {
        const turned = rotation === 90 || rotation === 270;
        playsWidth = turned ? videoTrack.height : videoTrack.width;
        playsHeight = turned ? videoTrack.width : videoTrack.height;
      }
    }
    let verdict = '✗ not portrait 9:16';
    if (aspectLabel(playsWidth, playsHeight) === '9:16 portrait') {
      verdict = rotation ? '⚠ portrait only through a rotation tag (some apps ignore it)' : '✓ genuinely portrait 9:16';
    }
    const frames = videoTrack && videoTrack.samples;
    const rows = [
      ['MIME', openFile.type || '(empty!)'],
      ['Size', formatMB(openFile.size) + ' (' + openFile.size.toLocaleString() + ' bytes)'],
      ['Filename', openFile.name],
      ['Recording duration', take.durationSec.toFixed(1) + ' s · ' + (take.finished ? 'complete' : 'interrupted, recovered')],
      ['File check', signature.label],
      ['Encoded size', encoded],
      ['Rotation tag', videoTrack ? (rotation ? rotation + '°' : 'none') : 'n/a'],
      ['Plays as', playsWidth ? playsWidth + '×' + playsHeight + ' · ' + aspectLabel(playsWidth, playsHeight) : 'loading…'],
      ['Portrait 9:16', playsWidth ? verdict : 'checking…'],
      ['Frame rate', frames ? (frames / duration).toFixed(1) + ' fps average (' + frames + ' frames / ' + duration.toFixed(1) + ' s)' : 'not detectable'],
      ['Video codec', videoCodec],
      ['Audio codec', audioCodec],
      ['Bitrate', ((openFile.size * 8) / duration / 1e6).toFixed(1) + ' Mbps average'],
      ['Recorded with', (take.cameraTrack ? 'camera ' + take.cameraTrack : 'camera ?') + ' → ' + (take.pipeline || '?')],
      ['Format requested', take.mimeType],
    ];
    renderFileDetails(rows);
    facts.latestTake = take.name + ' (' + new Date(take.createdAt).toLocaleString() + ')\n' + rows.map(([label, value]) => '  ' + label + ': ' + value).join('\n');
  };
  build(null);
  const player = $('player');
  show('player');
  hide('emptyPlayer');
  $('emptyPlayer').textContent = 'Record a take in Studio, then it appears here.';
  facts.previewResult = 'loading…';
  player.onloadedmetadata = () => {
    facts.previewResult = 'plays in the app';
    build(player);
    updateReport();
  };
  player.onerror = () => {
    const code = player.error ? player.error.code : '?';
    facts.previewResult = '✗ FAILED in the app (error code ' + code + ') → recording problem';
    updateReport();
  };
  player.src = openFileUrl;
  const fileIsUsable = openFile.size > 0 && openFile.type.startsWith('video/');
  $('downloadButton').disabled = !fileIsUsable;
  $('downloadButton').textContent = fileIsUsable ? 'Download ' + extension.toUpperCase() + ' (' + formatMB(openFile.size) + ')' : 'Download unavailable (file check failed)';
  const canShare = !!(fileIsUsable && navigator.canShare && navigator.canShare({ files: [openFile] }));
  facts.shareAvailable = canShare ? 'yes' : 'no';
  if (canShare) show('shareButton');
  updateReport();
}
