const params    = new URLSearchParams(location.search);
const streamUrl = params.get('url') || '';
const title     = decodeURIComponent(params.get('title') || '');
const itemId    = params.get('id') || '';
const itemType  = params.get('type') || '';
const startPct  = parseFloat(params.get('start') || '0');

document.title = title ? `${title} — HuskyPlay` : 'Player — HuskyPlay';
document.getElementById('backBtn').addEventListener('click', goBack);
document.addEventListener('keydown', e => { if (e.key === 'Escape') goBack(); });

function goBack() {
  const returnPage = params.get('returnPage') || '';
  if (returnPage) {
    location.href = `app.html?page=${encodeURIComponent(returnPage)}`;
  } else {
    history.back();
  }
}

const video = document.getElementById('video');

// Restore volume
const savedVol = parseFloat(localStorage.getItem('hp_vol') ?? '1');
video.volume = savedVol;
video.addEventListener('volumechange', () => localStorage.setItem('hp_vol', video.volume));

// ── Load stream ───────────────────────────────────────────────────────────────
function loadStream(url) {
  if (!url) return;
  const isHls = url.includes('.m3u8') || url.includes('/live/');

  if (isHls && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 30 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { video.src = url; video.play().catch(() => {}); } });
  } else {
    video.src = url;
    video.play().catch(() => {});
  }
}

loadStream(streamUrl);

// ── Profile-scoped progress key ───────────────────────────────────────────────
function progressKey() {
  try {
    const d = JSON.parse(localStorage.getItem('hp_profiles') || 'null');
    const id = d?.currentId || 'default';
    return `hp_progress_${id}`;
  } catch { return 'hp_progress'; }
}

// ── Restore watch progress ────────────────────────────────────────────────────
function restoreProgress() {
  if (!video.duration) return;
  let pct = startPct;
  if (!pct) {
    const stored = JSON.parse(localStorage.getItem(progressKey()) || '{}');
    pct = stored[`${itemType}_${itemId}`] || 0;
  }
  if (pct > 0 && pct < 95) {
    video.currentTime = (pct / 100) * video.duration;
  }
}

video.addEventListener('loadedmetadata', restoreProgress, { once: true });
// Fallback for HLS which may fire canplay before loadedmetadata
video.addEventListener('canplay', restoreProgress, { once: true });

// ── Save watch progress ───────────────────────────────────────────────────────
let _lastSave = 0;
video.addEventListener('timeupdate', () => {
  if (!itemId || !itemType || !video.duration || video.duration < 60) return;
  const now = Date.now();
  if (now - _lastSave < 5000) return; // save every 5s max
  _lastSave = now;
  const pct = (video.currentTime / video.duration) * 100;
  const stored = JSON.parse(localStorage.getItem(progressKey()) || '{}');
  stored[`${itemType}_${itemId}`] = pct;
  localStorage.setItem(progressKey(), JSON.stringify(stored));
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') video.currentTime += 10;
  if (e.key === 'ArrowLeft')  video.currentTime -= 10;
});
