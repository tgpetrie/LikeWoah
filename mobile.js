'use strict';

const $ = id => document.getElementById(id);
const vid = $('vid');
const vwrap = $('vwrap');
const preview = $('preview');
const dropZone = $('dropZone');
const fileIn = $('fileIn');
const openBtn = $('openBtn');
const openBig = $('openBtnBig');
const menuBtn = $('menuBtn');
const playBtn = $('playBtn');
const stepBackBtn = $('stepBack');
const stepFwdBtn = $('stepFwd');
const bookmarkBtn = $('bookmarkBtn');
const micBtn = $('micBtn');
const tlineWrap = $('tlineWrap');
const tline = $('tline');
const tprog = $('tprog');
const tthumb = $('tthumb');
const tlineMarks = $('tlineMarks');
const tcur = $('tcur');
const tdur = $('tdur');
const touchOl = $('touchOl');
const centerInd = $('centerInd');
const centerIcon = $('centerIcon');
const zoomFab = $('zoomFab');
const sheet = $('sheet');
const sheetBg = $('sheetBg');
const sheetContent = $('sheetContent');
const cmdSheet = $('cmdSheet');
const cmdInput = $('cmdInput');
const cmdFeedback = $('cmdFeedback');
const cmdClose = $('cmdClose');
const fxCanvas = $('fxCanvas');
const lassoCanvas = $('lassoCanvas');
const toast = $('toast');

let loaded = false;
let estimatedFPS = 30;
let zoom = 1, panX = 0, panY = 0;
let bookmarks = [];
let bmIdSeq = 0;
let lastFileName = 'untitled';
let audioCtx = null, audioSrc = null;
let selRange = { in: null, out: null };
let selDragging = null;

function fmt(s) {
  s = Math.max(0, s|0);
  return (s/60|0) + ':' + String(s%60).padStart(2,'0');
}

// ── Range selector (mobile touch version) ──
function updateSelRangeUI() {
  const inHandle = $('selHandleIn');
  const outHandle = $('selHandleOut');
  const selRangeEl = $('selRange');

  if (selRange.in === null || selRange.out === null) {
    inHandle.style.display = 'none';
    outHandle.style.display = 'none';
    selRangeEl.style.display = 'none';
    return;
  }

  const dur = vid.duration || 1;
  const inPct = (selRange.in / dur) * 100;
  const outPct = (selRange.out / dur) * 100;

  inHandle.style.left = inPct + '%';
  outHandle.style.left = outPct + '%';
  selRangeEl.style.left = inPct + '%';
  selRangeEl.style.right = (100 - outPct) + '%';
  selRangeEl.style.display = 'block';
  inHandle.style.display = 'block';
  outHandle.style.display = 'block';
}

function setSelPoint(which, time) {
  time = Math.max(0, Math.min(vid.duration || 0, time));
  if (which === 'in') {
    selRange.in = Math.min(time, (selRange.out !== null) ? selRange.out : (vid.duration || 0));
  } else {
    selRange.out = Math.max(time, (selRange.in !== null) ? selRange.in : 0);
  }
  updateSelRangeUI();
}

function startSelDragTouch(which, e) {
  selDragging = which;
  $('selHandle' + (which === 'in' ? 'In' : 'Out')).classList.add('active');
  e.preventDefault();
}

function onSelDragMoveTouch(e) {
  if (!selDragging) return;
  const tline = $('tline');
  const rect = tline.getBoundingClientRect();
  const touch = e.touches[0];
  if (!touch) return;
  const pct = Math.max(0, Math.min(100, ((touch.clientX - rect.left) / rect.width) * 100));
  const time = (pct / 100) * (vid.duration || 0);
  setSelPoint(selDragging, time);
}

function onSelDragEndTouch() {
  if (selDragging) {
    $('selHandle' + (selDragging === 'in' ? 'In' : 'Out')).classList.remove('active');
  }
  selDragging = null;
}

async function saveSelection() {
  if (selRange.in === null || selRange.out === null) {
    showToast('Set both in and out points first', true);
    return;
  }
  if (selRange.in >= selRange.out) {
    showToast('In point must be before out point', true);
    return;
  }
  await saveSection(selRange.in, selRange.out);
}

// Wire up touch handlers
$('selHandleIn').addEventListener('touchstart', e => startSelDragTouch('in', e));
$('selHandleOut').addEventListener('touchstart', e => startSelDragTouch('out', e));
document.addEventListener('touchmove', onSelDragMoveTouch, { passive: false });
document.addEventListener('touchend', onSelDragEndTouch);

// Keyboard shortcuts (same as desktop)
document.addEventListener('keydown', e => {
  if (!loaded || !vid.duration) return;
  const inInput = e.target.closest('input, textarea, [contenteditable]');
  if (inInput) return;
  if (e.key.toLowerCase() === 'i') {
    e.preventDefault();
    setSelPoint('in', vid.currentTime);
    showToast('In: ' + fmt(selRange.in));
  } else if (e.key.toLowerCase() === 'o') {
    e.preventDefault();
    setSelPoint('out', vid.currentTime);
    showToast('Out: ' + fmt(selRange.out));
  }
});

// Clear selection when video loads
const origVidLoadMeta = vid.onloadedmetadata;
vid.onloadedmetadata = function(e) {
  selRange = { in: null, out: null };
  updateSelRangeUI();
  if (origVidLoadMeta) origVidLoadMeta.call(this, e);
};

function showToast(msg, isDanger) {
  toast.textContent = msg;
  toast.classList.toggle('danger', !!isDanger);
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
}
function setCenterIcon(playing) {
  while (centerIcon.firstChild) centerIcon.removeChild(centerIcon.firstChild);
  const ns = 'http://www.w3.org/2000/svg';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', playing
    ? 'M8 5v14l11-7z'
    : 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
  centerIcon.appendChild(path);
}
function showCenterIndicator(playing) {
  setCenterIcon(playing);
  centerInd.classList.add('show');
  setTimeout(() => centerInd.classList.remove('show'), 350);
}

const VIDEO_EXTS = /\.(mp4|mov|m4v|webm|mkv|avi|ogg|ogv|ts|mts|m2ts|3gp|flv|wmv)$/i;
function loadFile(file) {
  if (!file) return;
  const okByType = file.type && file.type.startsWith('video/');
  const okByExt = file.name && VIDEO_EXTS.test(file.name);
  if (!okByType && !okByExt) {
    showToast('Not a video: ' + file.name, true);
    return;
  }
  lastFileName = file.name || 'untitled';
  loaded = false; // reset so onVideoReady can fire for the new file
  selRange = { in: null, out: null };
  updateSelRangeUI();
  vid.src = URL.createObjectURL(file);
  vid.load();
}
const cameraIn = $('cameraIn');
const cameraBtnBig = $('cameraBtnBig');
const cameraBtn = $('cameraBtn');
openBtn.addEventListener('click', () => fileIn.click());
openBig.addEventListener('click', () => fileIn.click());
cameraBtn.addEventListener('click', () => cameraIn.click());
cameraBtnBig.addEventListener('click', () => cameraIn.click());
$('deviceBtnBig').addEventListener('click', showDeviceBrowser);
fileIn.addEventListener('change', e => { loadFile(e.target.files[0]); fileIn.value = ''; });
cameraIn.addEventListener('change', e => { loadFile(e.target.files[0]); cameraIn.value = ''; });

['dragenter','dragover'].forEach(ev =>
  preview.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); })
);
preview.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

function onVideoReady() {
  if (loaded) return; // already handled
  loaded = true;
  dropZone.classList.add('hidden');
  vwrap.classList.add('on');
  tlineWrap.style.display = 'block';
  tdur.textContent = fmt(vid.duration);
  enableControls(true);
  bookmarks = [];
  renderBookmarks();
  fitVideo();
  detectFps();
}
vid.addEventListener('loadedmetadata', () => {
  // Some mobile browsers report videoWidth=0 at loadedmetadata;
  // wait for loadeddata or a short delay as fallback
  if (vid.videoWidth > 0 && vid.videoHeight > 0) {
    onVideoReady();
  }
});
vid.addEventListener('loadeddata', () => {
  // By loadeddata, first frame is decoded — dimensions should be available
  if (vid.videoWidth > 0 && vid.videoHeight > 0) {
    onVideoReady();
  }
});
// Ultimate fallback: some codecs/browsers delay dimension reporting
vid.addEventListener('canplay', () => {
  if (!loaded && vid.videoWidth > 0 && vid.videoHeight > 0) {
    onVideoReady();
  }
});

function enableControls(on) {
  playBtn.disabled = !on;
  stepBackBtn.disabled = !on;
  stepFwdBtn.disabled = !on;
  bookmarkBtn.disabled = !on;
}

function fitVideo() {
  const r = preview.getBoundingClientRect();
  const vw = vid.videoWidth || vid.offsetWidth || r.width;
  const vh = vid.videoHeight || vid.offsetHeight || r.height;
  if (!vw || !vh) return; // still no dimensions, bail
  const vr = vw / vh;
  const ar = r.width / r.height;
  let w, h;
  if (vr > ar) { w = r.width; h = w / vr; }
  else { h = r.height; w = h * vr; }
  // Guard against NaN / Infinity / zero
  if (!isFinite(w) || !isFinite(h) || w < 1 || h < 1) {
    w = r.width; h = r.height;
  }
  vid.style.width = w + 'px';
  vid.style.height = h + 'px';
  vwrap.style.width = w + 'px';
  vwrap.style.height = h + 'px';
  zoom = 1;
  panX = (r.width - w) / 2;
  panY = (r.height - h) / 2;
  applyTransform();
  resizeCanvases();
}
function applyTransform() {
  vwrap.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
  zoomFab.textContent = Math.round(zoom * 100) + '%';
}
function resizeCanvases() {
  const w = Math.round(parseFloat(vid.style.width));
  const h = Math.round(parseFloat(vid.style.height));
  [fxCanvas, lassoCanvas].forEach(c => { c.width = w; c.height = h; });
}
window.addEventListener('resize', () => { if (loaded) fitVideo(); });
window.addEventListener('orientationchange', () => setTimeout(() => loaded && fitVideo(), 200));

function setPlaying(on) {
  playBtn.classList.toggle('playing', !!on);
}
function togglePlayback() {
  if (vid.paused) {
    vid.play().catch(() => showToast('Tap once more to play'));
    setPlaying(true);
    showCenterIndicator(true);
  } else {
    vid.pause();
    setPlaying(false);
    showCenterIndicator(false);
  }
}
playBtn.addEventListener('click', togglePlayback);
vid.addEventListener('ended', () => setPlaying(false));

let touchPan = null;
let pinchState = null;
function touchDist(a, b) { return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY); }
function touchMid(a, b)  { return { x: (a.clientX + b.clientX)/2, y: (a.clientY + b.clientY)/2 }; }
function zoomAt(sx, sy, newZoom) {
  const r = preview.getBoundingClientRect();
  const rx = sx - r.left, ry = sy - r.top;
  const cx = (rx - panX) / zoom;
  const cy = (ry - panY) / zoom;
  zoom = Math.max(0.5, Math.min(8, newZoom));
  panX = rx - cx * zoom;
  panY = ry - cy * zoom;
  applyTransform();
  zoomFab.classList.add('show');
  clearTimeout(zoomAt._t);
  zoomAt._t = setTimeout(() => zoomFab.classList.remove('show'), 800);
}

touchOl.addEventListener('touchstart', e => {
  if (!loaded) return;
  if (e.touches.length === 2) {
    e.preventDefault();
    const [a,b] = [e.touches[0], e.touches[1]];
    const mid = touchMid(a,b);
    pinchState = { startDist: touchDist(a,b), startZoom: zoom, centerX: mid.x, centerY: mid.y };
    touchPan = null;
  } else if (e.touches.length === 1 && !pinchState) {
    const t = e.touches[0];
    touchPan = { sx: t.clientX, sy: t.clientY, pX: panX, pY: panY, t0: performance.now() };
  }
}, { passive: false });
touchOl.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && pinchState) {
    e.preventDefault();
    const [a,b] = [e.touches[0], e.touches[1]];
    const d = touchDist(a,b);
    zoomAt(pinchState.centerX, pinchState.centerY, pinchState.startZoom * (d / pinchState.startDist));
  } else if (e.touches.length === 1 && touchPan && !pinchState) {
    if (zoom > 1.05) {
      e.preventDefault();
      const t = e.touches[0];
      panX = touchPan.pX + (t.clientX - touchPan.sx);
      panY = touchPan.pY + (t.clientY - touchPan.sy);
      applyTransform();
    }
  }
}, { passive: false });
touchOl.addEventListener('touchend', e => {
  if (e.touches.length < 2) pinchState = null;
  if (e.touches.length === 0 && touchPan) {
    const dx = Math.abs((e.changedTouches[0]?.clientX || 0) - touchPan.sx);
    const dy = Math.abs((e.changedTouches[0]?.clientY || 0) - touchPan.sy);
    if (dx < 10 && dy < 10 && performance.now() - touchPan.t0 < 250 && loaded) {
      togglePlayback();
    }
    touchPan = null;
  }
});
let lastTap = 0;
touchOl.addEventListener('touchend', e => {
  const now = performance.now();
  if (now - lastTap < 280 && e.changedTouches.length === 1) {
    e.preventDefault();
    if (zoom > 1.05) { fitVideo(); showToast('Fit'); }
    else { zoomAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY, 2.5); }
    lastTap = 0;
  } else { lastTap = now; }
});
let longPressTimer = null;
touchOl.addEventListener('touchstart', e => {
  if (e.touches.length !== 1 || !loaded) return;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    if (touchPan && Math.abs(touchPan.sx - e.touches[0].clientX) < 8) {
      navigator.vibrate?.(50);
      addBookmark();
    }
  }, 600);
});
touchOl.addEventListener('touchend',  () => clearTimeout(longPressTimer));
touchOl.addEventListener('touchmove', () => clearTimeout(longPressTimer));

preview.addEventListener('click', e => {
  if (!loaded) return;
  if (e.target.closest('.touch-overlay, .vwrap')) togglePlayback();
});

function stepFrame(dir) {
  if (!loaded) return;
  vid.pause(); setPlaying(false);
  vid.currentTime = Math.max(0, Math.min(vid.duration,
    vid.currentTime + dir / (estimatedFPS || 30)));
}
stepBackBtn.addEventListener('click', () => stepFrame(-1));
stepFwdBtn.addEventListener('click', () => stepFrame(1));

function detectFps() {
  if (!('requestVideoFrameCallback' in vid)) return;
  const samples = []; let prevT = null;
  const cb = (now, meta) => {
    if (prevT != null && samples.length < 18) samples.push(meta.mediaTime - prevT);
    prevT = meta.mediaTime;
    if (samples.length < 18 && !vid.ended) vid.requestVideoFrameCallback(cb);
    else if (samples.length) {
      samples.sort();
      const med = samples[samples.length >> 1];
      if (med > 0) estimatedFPS = 1 / med;
    }
  };
  if (vid.paused) {
    vid.play().catch(()=>{});
    vid.requestVideoFrameCallback(cb);
    setTimeout(() => vid.pause(), 800);
  } else {
    vid.requestVideoFrameCallback(cb);
  }
}

vid.addEventListener('timeupdate', () => {
  if (!vid.duration) return;
  const p = vid.currentTime / vid.duration;
  tprog.style.width = (p * 100) + '%';
  tthumb.style.left = (p * 100) + '%';
  tcur.textContent = fmt(vid.currentTime);
});
function seekFromTouch(clientX) {
  if (!vid.duration) return;
  const r = tline.getBoundingClientRect();
  const p = (clientX - r.left) / r.width;
  vid.currentTime = Math.max(0, Math.min(vid.duration, p * vid.duration));
}
tline.addEventListener('touchstart', e => { e.preventDefault(); seekFromTouch(e.touches[0].clientX); }, { passive: false });
tline.addEventListener('touchmove',  e => { e.preventDefault(); seekFromTouch(e.touches[0].clientX); }, { passive: false });
tline.addEventListener('click', e => seekFromTouch(e.clientX));

function addBookmark() {
  if (!loaded) return;
  const t = vid.currentTime;
  if (bookmarks.some(b => Math.abs(b.time - t) < (1 / estimatedFPS) * 0.5)) return;
  bookmarks.push({ id: ++bmIdSeq, time: t, frame: Math.round(t * estimatedFPS), label: '' });
  bookmarks.sort((a,b) => a.time - b.time);
  renderBookmarks();
  showToast('Bookmarked at ' + fmt(t));
}
function removeBookmark(id) {
  bookmarks = bookmarks.filter(b => b.id !== id);
  renderBookmarks();
}
function renderBookmarks() {
  tlineMarks.replaceChildren();
  if (vid.duration) {
    bookmarks.forEach(b => {
      const m = document.createElement('div');
      m.className = 'pin-mark';
      m.style.left = (b.time / vid.duration * 100) + '%';
      tlineMarks.appendChild(m);
    });
  }
  menuBtn.classList.toggle('has-badge', bookmarks.length > 0);
  menuBtn.dataset.badge = bookmarks.length;
}
bookmarkBtn.addEventListener('click', addBookmark);

function openSheet(content) {
  sheetContent.replaceChildren();
  sheetContent.appendChild(content);
  sheet.classList.add('show');
  sheetBg.classList.add('show');
}
function closeSheet() {
  sheet.classList.remove('show');
  sheetBg.classList.remove('show');
}
sheetBg.addEventListener('click', closeSheet);
let sheetTouch = null;
sheet.addEventListener('touchstart', e => {
  if (e.touches[0].clientY < sheet.getBoundingClientRect().top + 30) {
    sheetTouch = { sy: e.touches[0].clientY };
  }
});
sheet.addEventListener('touchmove', e => {
  if (!sheetTouch) return;
  const dy = e.touches[0].clientY - sheetTouch.sy;
  if (dy > 0) sheet.style.transform = 'translateY(' + dy + 'px)';
});
sheet.addEventListener('touchend', e => {
  if (!sheetTouch) return;
  const dy = (e.changedTouches[0].clientY) - sheetTouch.sy;
  sheet.style.transform = '';
  if (dy > 100) closeSheet();
  sheetTouch = null;
});

// Build menu/bookmark/help sheets via DOM APIs (no innerHTML)
function makeHeading(text, closeId) {
  const h = document.createElement('h3');
  h.textContent = text + ' ';
  const close = document.createElement('button');
  close.className = 'close';
  close.id = closeId;
  close.textContent = '×';
  h.appendChild(close);
  return h;
}
function makeSvgPath(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

// ── ADB Device Browser ──
const ADB_BRIDGE = 'http://localhost:7420';
let adbAvailable = null; // null = unknown, true/false after check

async function checkAdbBridge() {
  try {
    const r = await fetch(ADB_BRIDGE + '/health', { signal: AbortSignal.timeout(1500) });
    adbAvailable = r.ok;
  } catch { adbAvailable = false; }
  return adbAvailable;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function loadFromBridge(device, filePath) {
  const url = ADB_BRIDGE + '/pull?device=' + encodeURIComponent(device)
    + '&path=' + encodeURIComponent(filePath);
  const name = filePath.split('/').pop();
  lastFileName = name;
  loaded = false;
  selRange = { in: null, out: null };
  updateSelRangeUI();
  vid.crossOrigin = 'anonymous';
  vid.src = url;
  vid.load();
  closeSheet();
  showToast('Loading ' + name + '...');
}

async function showDeviceBrowser() {
  const root = document.createElement('div');
  root.appendChild(makeHeading('Devices', 'dClose'));

  const status = document.createElement('div');
  status.style.cssText = 'text-align:center;padding:24px 0;color:var(--muted);font-size:13px';
  status.textContent = 'Connecting to ADB bridge...';
  root.appendChild(status);
  openSheet(root);
  $('dClose').addEventListener('click', closeSheet);

  const ok = await checkAdbBridge();
  if (!ok) {
    status.textContent = '';
    const msg = document.createElement('div');
    msg.style.cssText = 'text-align:center;padding:16px 0';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:600;color:var(--text);margin-bottom:10px';
    title.textContent = 'ADB Bridge not running';
    msg.appendChild(title);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:var(--muted);line-height:1.7;font-family:monospace;background:var(--panel2);padding:14px;border-radius:10px;text-align:left';
    hint.textContent = 'python3 adb-bridge.py';
    msg.appendChild(hint);

    const note = document.createElement('div');
    note.style.cssText = 'font-size:12px;color:var(--muted);margin-top:10px;line-height:1.5';
    note.textContent = 'Run this command in the VideoEdit folder, then tap Retry.';
    msg.appendChild(note);

    const retry = document.createElement('button');
    retry.className = 'open-btn-big';
    retry.style.cssText = 'margin-top:14px;width:100%;padding:12px';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => { closeSheet(); setTimeout(showDeviceBrowser, 200); });
    msg.appendChild(retry);

    status.parentNode.replaceChild(msg, status);
    return;
  }

  // Fetch device list
  try {
    const r = await fetch(ADB_BRIDGE + '/devices');
    const data = await r.json();
    status.remove();

    if (!data.devices || data.devices.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bm-empty';
      empty.textContent = 'No devices connected. Plug in via USB or use adb connect <ip>.';
      root.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'menu-list';
    data.devices.forEach(dev => {
      const btn = document.createElement('button');
      btn.className = 'menu-item';
      const icon = document.createElement('div'); icon.className = 'icon';
      icon.appendChild(makeSvgPath('M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z'));
      const lbl = document.createElement('div'); lbl.className = 'label';
      const ttl = document.createElement('div'); ttl.className = 'ttl'; ttl.textContent = dev.model;
      const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = dev.id;
      lbl.appendChild(ttl); lbl.appendChild(sub);
      btn.appendChild(icon); btn.appendChild(lbl);
      btn.addEventListener('click', () => { closeSheet(); setTimeout(() => browseDevice(dev.id, dev.model, '/'), 200); });
      list.appendChild(btn);
    });
    root.appendChild(list);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--danger)';
  }
}

async function browseDevice(deviceId, deviceName, path) {
  const root = document.createElement('div');
  const heading = makeHeading(deviceName, 'bwClose');
  root.appendChild(heading);

  // Breadcrumb / back nav
  if (path !== '/') {
    const backRow = document.createElement('div');
    backRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0 10px;font-size:12px';
    const backBtn = document.createElement('button');
    backBtn.style.cssText = 'background:var(--panel2);border:1px solid var(--border);color:var(--accent);padding:6px 12px;border-radius:8px;font-size:12px';
    backBtn.textContent = '← Back';
    const parentPath = path.replace(/\/[^/]+\/?$/, '') || '/';
    backBtn.addEventListener('click', () => { closeSheet(); setTimeout(() => browseDevice(deviceId, deviceName, parentPath), 200); });
    backRow.appendChild(backBtn);
    const pathLabel = document.createElement('span');
    pathLabel.style.cssText = 'color:var(--muted);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    pathLabel.textContent = path;
    backRow.appendChild(pathLabel);
    root.appendChild(backRow);
  }

  const status = document.createElement('div');
  status.style.cssText = 'text-align:center;padding:20px 0;color:var(--muted);font-size:13px';
  status.textContent = 'Loading...';
  root.appendChild(status);
  openSheet(root);
  $('bwClose').addEventListener('click', closeSheet);

  try {
    const r = await fetch(ADB_BRIDGE + '/browse?device=' + encodeURIComponent(deviceId)
      + '&path=' + encodeURIComponent(path));
    const data = await r.json();
    status.remove();

    if (!data.entries || data.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bm-empty';
      empty.textContent = 'No video files or folders here.';
      root.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'menu-list';
    data.entries.forEach(entry => {
      const btn = document.createElement('button');
      btn.className = 'menu-item';
      const icon = document.createElement('div'); icon.className = 'icon';
      if (entry.isDir) {
        icon.appendChild(makeSvgPath('M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z'));
      } else {
        icon.style.color = 'var(--text)';
        icon.appendChild(makeSvgPath('M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z'));
      }
      const lbl = document.createElement('div'); lbl.className = 'label';
      const ttl = document.createElement('div'); ttl.className = 'ttl'; ttl.textContent = entry.name;
      const sub = document.createElement('div'); sub.className = 'sub';
      sub.textContent = entry.isDir ? 'Folder' : fmtSize(entry.size);
      lbl.appendChild(ttl); lbl.appendChild(sub);
      btn.appendChild(icon); btn.appendChild(lbl);

      if (entry.isDir) {
        btn.addEventListener('click', () => { closeSheet(); setTimeout(() => browseDevice(deviceId, deviceName, entry.path), 200); });
      } else {
        btn.addEventListener('click', () => loadFromBridge(deviceId, entry.path));
      }
      list.appendChild(btn);
    });
    root.appendChild(list);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--danger)';
  }
}

// Check for ADB bridge on load (non-blocking)
checkAdbBridge();

function showMenu() {
  const root = document.createElement('div');
  root.appendChild(makeHeading('Menu', 'mClose'));
  const list = document.createElement('div'); list.className = 'menu-list';
  const items = [
    { d:'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z',
      ttl:'From device', sub:'Browse connected phone via ADB', act:showDeviceBrowser },
    { d:'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z',
      ttl:'Bookmarks', sub: bookmarks.length + ' pinned', act:showBookmarks },
    { d:'M12 2v2c4.42 0 8 3.58 8 8s-3.58 8-8 8-8-3.58-8-8c0-1.85.63-3.55 1.69-4.9L12 13V2z',
      ttl:'Analyze motion', sub:'Spike, irregularity, pulse', act:runMotion, disabled: !loaded },
    { d:'M19 13H5v-2h14v2z',
      ttl:'Save selection', sub:'Export range with handles', act:saveSelection, disabled: !loaded || selRange.in === null },
    { d:'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z',
      ttl:'Export full video (WebM)', sub:'Bakes annotations at full res', act:exportFullWebM, disabled: !loaded },
    { d:'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm.01 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
      ttl:'How it works', sub:'Voice / touch tips', act:showHelp },
    { d:'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
      ttl:'Switch to desktop', sub:'Full feature set', act:() => location.href = 'editor.html' },
  ];
  items.forEach(it => {
    const b = document.createElement('button');
    b.className = 'menu-item';
    if (it.disabled) b.disabled = true;
    const icon = document.createElement('div'); icon.className = 'icon';
    icon.appendChild(makeSvgPath(it.d));
    const lbl = document.createElement('div'); lbl.className = 'label';
    const ttl = document.createElement('div'); ttl.className = 'ttl'; ttl.textContent = it.ttl;
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = it.sub;
    lbl.appendChild(ttl); lbl.appendChild(sub);
    b.appendChild(icon); b.appendChild(lbl);
    b.addEventListener('click', () => { closeSheet(); setTimeout(it.act, 200); });
    list.appendChild(b);
  });
  root.appendChild(list);
  openSheet(root);
  $('mClose').addEventListener('click', closeSheet);
}
menuBtn.addEventListener('click', showMenu);

function showBookmarks() {
  const root = document.createElement('div');
  root.appendChild(makeHeading('Bookmarks', 'bClose'));
  const list = document.createElement('div'); list.className = 'bm-list';
  if (bookmarks.length === 0) {
    const e = document.createElement('div'); e.className = 'bm-empty';
    e.textContent = 'No bookmarks yet. Tap the pin button or long-press the video.';
    list.appendChild(e);
  } else {
    bookmarks.forEach(b => {
      const row = document.createElement('div'); row.className = 'bm-row';
      const tc = document.createElement('span'); tc.className = 'tc'; tc.textContent = fmt(b.time);
      tc.addEventListener('click', () => { vid.currentTime = b.time; closeSheet(); });
      const lbl = document.createElement('input'); lbl.className = 'lbl-input'; lbl.placeholder = 'add note…'; lbl.value = b.label;
      lbl.addEventListener('input', () => { b.label = lbl.value; });
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '×';
      del.addEventListener('click', () => { removeBookmark(b.id); showBookmarks(); });
      row.append(tc, lbl, del);
      list.appendChild(row);
    });
  }
  root.appendChild(list);
  openSheet(root);
  $('bClose').addEventListener('click', closeSheet);
}

function showHelp() {
  const root = document.createElement('div');
  root.appendChild(makeHeading('How it works', 'hClose'));
  const block = document.createElement('div');
  block.style.cssText = 'font-size:13px;color:var(--text);line-height:1.7';

  function h4(text) {
    const e = document.createElement('h4');
    e.style.cssText = 'margin:8px 0 6px;color:var(--accent);font-size:13px';
    e.textContent = text;
    return e;
  }
  function ul(items, mono) {
    const u = document.createElement('ul');
    u.style.cssText = 'margin:0 0 12px 20px;color:var(--text)' + (mono ? ';font-family:monospace;font-size:11.5px;color:#bde8c8' : '');
    items.forEach(it => {
      const li = document.createElement('li');
      if (Array.isArray(it)) {
        const strong = document.createElement('b'); strong.textContent = it[0];
        li.appendChild(strong);
        li.appendChild(document.createTextNode(' ' + it[1]));
      } else { li.textContent = it; }
      u.appendChild(li);
    });
    return u;
  }
  function p(text) {
    const e = document.createElement('p');
    e.style.color = 'var(--muted)'; e.style.marginBottom = '6px';
    e.textContent = text;
    return e;
  }

  block.appendChild(h4('Touch'));
  block.appendChild(ul([
    ['Tap', 'the video to play/pause'],
    ['Double-tap', 'to zoom in / fit'],
    ['Pinch', 'two fingers to zoom'],
    ['Drag', 'when zoomed in to pan'],
    ['Long-press', 'the video to bookmark the frame'],
    ['Drag the timeline', 'to scrub'],
  ]));
  block.appendChild(h4('Voice (the mic button)'));
  block.appendChild(p('Tap the red mic, speak naturally. Examples:'));
  block.appendChild(ul([
    '"go to four minutes twenty"',
    '"bookmark this"',
    '"save from 4:20 to 6:18"',
    '"play at 2x"',
    '"rewind 10 seconds"',
    '"analyze motion"',
  ], true));
  block.appendChild(h4('For deeper analysis'));
  const dp = document.createElement('p');
  dp.style.color = 'var(--muted)';
  dp.textContent = 'Tap Desktop ↗ at the top-right to open the full forensic workstation with adjust sliders, presets, overlays, lasso/wand, motion analyzer, PDF reports, and more.';
  block.appendChild(dp);

  root.appendChild(block);
  openSheet(root);
  $('hClose').addEventListener('click', closeSheet);
}

function promptClipSection() {
  cmdInput.value = 'save from ' + fmt(vid.currentTime) + ' to ' + fmt(Math.min(vid.duration, vid.currentTime + 10));
  showCmdSheet();
  cmdInput.select();
}

async function saveSection(startSec, endSec, filename) {
  if (!loaded) { showToast('Load a video first', true); return; }
  if (!isFinite(startSec) || !isFinite(endSec)) { showToast('Need start and end times', true); return; }
  startSec = Math.max(0, Math.min(vid.duration, startSec));
  endSec   = Math.max(0, Math.min(vid.duration, endSec));
  if (endSec <= startSec) { showToast('End must be after start', true); return; }

  showToast('Clipping ' + fmt(startSec) + ' to ' + fmt(endSec) + '...');

  const xc = document.createElement('canvas');
  xc.width = vid.videoWidth; xc.height = vid.videoHeight;
  const xctx = xc.getContext('2d');

  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  let audioTracks = [];
  if (audioCtx) {
    try {
      if (!audioSrc) audioSrc = audioCtx.createMediaElementSource(vid);
      audioSrc.connect(audioCtx.destination);
      const audioDest = audioCtx.createMediaStreamDestination();
      audioSrc.connect(audioDest);
      audioTracks = audioDest.stream.getTracks();
    } catch(e) {}
  }
  const combined = new MediaStream([
    ...xc.captureStream(30).getTracks(),
    ...audioTracks,
  ]);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus' : 'video/webm';
  const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const savedTime = vid.currentTime;
  const wasPaused = vid.paused;
  let intervalId = null, stopped = false;

  const finished = new Promise(resolve => {
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const base = lastFileName.replace(/\.[^.]+$/, '');
      a.download = filename || (base + '_' + fmt(startSec).replace(':','m') + '-' + fmt(endSec).replace(':','m') + '.webm');
      a.click();
      URL.revokeObjectURL(url);
      vid.currentTime = savedTime;
      if (wasPaused) vid.pause();
      setPlaying(!wasPaused);
      showToast('Saved: ' + a.download);
      resolve();
    };
  });

  function tick() {
    if (stopped) return;
    try { xctx.drawImage(vid, 0, 0); } catch(e) {}
    if (vid.currentTime >= endSec || vid.ended) {
      stopped = true;
      vid.pause();
      if (intervalId) clearInterval(intervalId);
      try { rec.stop(); } catch(e) {}
    }
  }
  vid.currentTime = startSec;
  await new Promise(res => vid.addEventListener('seeked', res, { once: true }));
  rec.start(100);
  await vid.play().catch(()=>{});
  setPlaying(true);
  intervalId = setInterval(tick, 33);
  setTimeout(() => {
    if (!stopped) {
      stopped = true;
      vid.pause();
      if (intervalId) clearInterval(intervalId);
      try { rec.stop(); } catch(e) {}
    }
  }, ((endSec - startSec) * 1000) + 2000);
  return finished;
}

async function exportFullWebM() {
  if (!loaded) return;
  saveSection(0, vid.duration, lastFileName.replace(/\.[^.]+$/, '') + '_export.webm');
}

async function runMotion() {
  if (!loaded) return;
  showToast('Analyzing motion...');
  const N = 100;
  const SW = 64, SH = Math.max(8, Math.round(SW * vid.videoHeight / vid.videoWidth));
  const tmp = document.createElement('canvas'); tmp.width = SW; tmp.height = SH;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  const savedT = vid.currentTime;
  const wasPaused = vid.paused;
  vid.pause();
  const global = new Float32Array(N);
  const times = new Float32Array(N);
  let prevData = null;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N * vid.duration;
    times[i] = t;
    vid.currentTime = t;
    await new Promise(res => vid.addEventListener('seeked', res, { once: true }));
    tctx.drawImage(vid, 0, 0, SW, SH);
    const cur = tctx.getImageData(0, 0, SW, SH).data;
    if (prevData) {
      let acc = 0;
      for (let p = 0; p < cur.length; p += 4) {
        acc += Math.abs(cur[p]-prevData[p]) + Math.abs(cur[p+1]-prevData[p+1]) + Math.abs(cur[p+2]-prevData[p+2]);
      }
      global[i] = acc / (cur.length * 0.75);
    }
    prevData = new Uint8ClampedArray(cur);
  }
  vid.currentTime = savedT;
  if (!wasPaused) vid.play();

  const spikes = [];
  const W = Math.max(5, Math.floor(N * 0.1));
  for (let i = 0; i < N; i++) {
    const lo = Math.max(0, i - W), hi = Math.min(N - 1, i + W);
    const win = [];
    for (let k = lo; k <= hi; k++) win.push(global[k]);
    win.sort((a,b) => a - b);
    const med = win[win.length >> 1];
    const mad = win.map(v => Math.abs(v - med)).sort((a,b) => a - b)[win.length >> 1] || 1e-6;
    const z = (global[i] - med) / (1.4826 * mad);
    if (z > 2.5 && global[i] > 2) spikes.push({ idx: i, time: times[i], z });
  }

  const root = document.createElement('div');
  root.appendChild(makeHeading('Motion analysis', 'aClose'));
  const block = document.createElement('div');
  block.style.cssText = 'font-size:13px;line-height:1.7';
  const summary = document.createElement('p');
  const bold = document.createElement('b');
  bold.style.color = 'var(--accent)';
  bold.textContent = spikes.length;
  summary.appendChild(bold);
  summary.appendChild(document.createTextNode(' anomaly spike' + (spikes.length === 1 ? '' : 's') + ' detected (z > 2.5).'));
  block.appendChild(summary);

  if (spikes.length) {
    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:11px;color:var(--muted)';
    hint.textContent = 'Tap any time below to seek:';
    block.appendChild(hint);
    const sl = document.createElement('div');
    sl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
    spikes.forEach(s => {
      const b = document.createElement('button');
      b.style.cssText = 'background:var(--panel2);color:var(--accent);border:none;padding:8px 12px;border-radius:10px;font-family:monospace;font-size:12px';
      b.textContent = fmt(s.time);
      b.addEventListener('click', () => { vid.currentTime = s.time; closeSheet(); });
      sl.appendChild(b);
    });
    block.appendChild(sl);
    const pinBtn = document.createElement('button');
    pinBtn.className = 'open-btn-big';
    pinBtn.style.cssText = 'margin-top:18px;width:100%';
    pinBtn.textContent = 'Pin all as bookmarks';
    pinBtn.addEventListener('click', () => {
      spikes.forEach(s => {
        if (!bookmarks.some(b => Math.abs(b.time - s.time) < (1/(estimatedFPS||30)) * 0.5)) {
          bookmarks.push({ id: ++bmIdSeq, time: s.time, frame: Math.round(s.time * (estimatedFPS||30)), label: 'motion spike (z=' + s.z.toFixed(1) + ')' });
        }
      });
      bookmarks.sort((a,b) => a.time - b.time);
      renderBookmarks();
      showToast('Pinned ' + spikes.length + ' anomal' + (spikes.length === 1 ? 'y' : 'ies'));
      closeSheet();
    });
    block.appendChild(pinBtn);
  }

  root.appendChild(block);
  openSheet(root);
  $('aClose').addEventListener('click', closeSheet);
}

function showCmdSheet() {
  cmdSheet.classList.add('show');
  setTimeout(() => cmdInput.focus(), 50);
}
function hideCmdSheet() {
  cmdSheet.classList.remove('show');
  cmdInput.blur();
  stopListening();
}
cmdClose.addEventListener('click', hideCmdSheet);

micBtn.addEventListener('click', () => {
  if (cmdSheet.classList.contains('show')) hideCmdSheet();
  else { showCmdSheet(); startListening(); }
});

const WORD_NUMBERS = {
  zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
  ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
  seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,
  half:30,quarter:15,
};
function wordToNum(w) {
  w = w.toLowerCase().trim();
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  if (WORD_NUMBERS[w] !== undefined) return WORD_NUMBERS[w];
  const parts = w.replace(/-/g, ' ').split(/\s+/);
  if (parts.length === 2 && WORD_NUMBERS[parts[0]] && WORD_NUMBERS[parts[1]]) {
    return WORD_NUMBERS[parts[0]] + WORD_NUMBERS[parts[1]];
  }
  return null;
}
function parseTime(str) {
  if (!str) return null;
  const raw = str.toString().trim().toLowerCase();
  const cleaned = raw
    .replace(/^(?:at\s+|the\s+|to\s+|on\s+)/g, '')
    .replace(/\s+mark\s*$/g, '')
    .replace(/\s+/g, ' ').trim();
  if (cleaned === 'start' || cleaned === 'beginning') return 0;
  if (cleaned === 'end' || cleaned === 'finish') return vid.duration || 0;
  if (cleaned === 'half' || cleaned === 'middle' || cleaned === 'halfway') return (vid.duration || 0) / 2;
  const fm = cleaned.match(/^(?:frame|f)\s*#?\s*(\d+)$/);
  if (fm) return parseInt(fm[1], 10) / (estimatedFPS || 30);
  const colon = cleaned.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?$/);
  if (colon) {
    let h=0, m=0, sec=0;
    if (colon[3] !== undefined) { h = +colon[1]; m = +colon[2]; sec = +colon[3]; }
    else { m = +colon[1]; sec = +colon[2]; }
    if (colon[4]) sec += parseFloat('0.' + colon[4]);
    return h*3600 + m*60 + sec;
  }
  let totalSec = null, anyMatch = false, lastMatchEnd = 0;
  const unitRe = /(?:(\d+(?:\.\d+)?)|([a-z]+(?:[\s-][a-z]+)?)\b)\s*(hours?|hrs?|h\b|minutes?|mins?|m\b|seconds?|secs?|s\b)/gi;
  for (const mm of cleaned.matchAll(unitRe)) {
    const numTok = mm[1] || mm[2];
    const n = wordToNum(numTok) ?? parseFloat(numTok);
    if (n == null || isNaN(n)) continue;
    const u = mm[3].toLowerCase();
    let mult = 0;
    if (/^(hours?|hrs?|h)$/.test(u)) mult = 3600;
    else if (/^(minutes?|mins?|m)$/.test(u)) mult = 60;
    else if (/^(seconds?|secs?|s)$/.test(u)) mult = 1;
    if (mult) { totalSec = (totalSec || 0) + n * mult; anyMatch = true; lastMatchEnd = mm.index + mm[0].length; }
  }
  if (anyMatch) {
    const tail = cleaned.slice(lastMatchEnd).trim().replace(/^and\s+/, '');
    if (tail) {
      const n = wordToNum(tail) ?? parseFloat(tail);
      if (n !== null && !isNaN(n)) totalSec += n;
    }
    return totalSec;
  }
  const bare = cleaned.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return parseFloat(bare[1]);
  const compound = cleaned.match(/^([a-z]+(?:[\s-][a-z]+)?)\s+([a-z]+(?:[\s-][a-z]+)?)$/);
  if (compound) {
    const a = wordToNum(compound[1]); const b = wordToNum(compound[2]);
    if (a !== null && b !== null) return a * 60 + b;
  }
  return null;
}

function normalizeCmd(s) {
  return s.toLowerCase()
    .replace(/[?!.]+$/g, '').replace(/\s+/g, ' ')
    .replace(/please/g, '')
    .replace(/^(hey|ok|okay|yo|computer|videoedit)[,\s]+/g, '')
    .trim();
}

const CMD_RULES = [
  {
    re: /^(?:save|clip|record|extract|trim|cut|grab)\s+(?:the\s+)?(?:section|clip|part|segment|range)?\s*(?:from\s+)?(.+?)\s+(?:to|until|through|-)\s+(.+?)(?:\s+(?:and\s+(?:save|export)|as.*))?$/i,
    label: (m) => 'Clip ' + m[1] + ' -> ' + m[2],
    run: (m) => {
      const s = parseTime(m[1]), e = parseTime(m[2]);
      if (s === null || e === null) return { ok:false, err:'Could not parse "' + m[1] + '" / "' + m[2] + '"' };
      saveSection(s, e);
      return { ok:true };
    }
  },
  {
    re: /^(?:at|from)\s+(?:the\s+)?(.+?)\s+(?:mark|point)?\s*(?:record|clip|save|capture)\s+(?:the\s+)?(?:section|part)?\s*(?:until|to|through)\s+(.+?)(?:\s+and\s+save.*)?$/i,
    label: (m) => 'Clip ' + m[1] + ' -> ' + m[2],
    run: (m) => {
      const s = parseTime(m[1]), e = parseTime(m[2]);
      if (s === null || e === null) return { ok:false, err:'Could not parse times' };
      saveSection(s, e);
      return { ok:true };
    }
  },
  {
    re: /^(?:go|jump|seek|navigate|move|scrub)\s+(?:to\s+)?(?:the\s+)?(.+?)(?:\s+mark)?$/i,
    label: (m) => 'Seek ' + m[1],
    run: (m) => {
      const t = parseTime(m[1]);
      if (t === null) return { ok:false, err:'Could not parse "' + m[1] + '"' };
      vid.currentTime = t;
      return { ok:true };
    }
  },
  { re: /^(?:skip|forward|fast forward|ff)\s+(.+)$/i, label: (m) => 'Skip +' + m[1],
    run: (m) => { const t = parseTime(m[1]); if (t === null) return { ok:false }; vid.currentTime = Math.min(vid.duration, vid.currentTime + t); return { ok:true }; } },
  { re: /^(?:back|rewind|reverse|go back)\s+(.+)$/i, label: (m) => 'Rewind ' + m[1],
    run: (m) => { const t = parseTime(m[1]); if (t === null) return { ok:false }; vid.currentTime = Math.max(0, vid.currentTime - t); return { ok:true }; } },
  { re: /^(?:play|resume|start)$/i, label: () => 'Play', run: () => { vid.play(); setPlaying(true); return { ok:true }; } },
  { re: /^(?:pause|stop|hold|wait)$/i, label: () => 'Pause', run: () => { vid.pause(); setPlaying(false); return { ok:true }; } },
  { re: /^(?:next|forward) frame$/i, label: () => 'Next frame', run: () => { stepFrame(1); return { ok:true }; } },
  { re: /^(?:previous|prev|back|last) frame$/i, label: () => 'Prev frame', run: () => { stepFrame(-1); return { ok:true }; } },
  {
    re: /^(?:bookmark|pin|mark|flag|note)(?:\s+this(?:\s+frame)?)?(?:\s+(?:at|@)\s+(.+))?$/i,
    label: (m) => m[1] ? 'Pin ' + m[1] : 'Pin current frame',
    run: (m) => {
      if (m[1]) {
        const t = parseTime(m[1]); if (t === null) return { ok:false };
        vid.currentTime = t; setTimeout(addBookmark, 120);
      } else addBookmark();
      return { ok:true };
    }
  },
  {
    re: /^(?:speed|playback speed|play at|playback)\s+(?:to\s+|at\s+)?(.+?)(?:x|×|times)?$/i,
    label: (m) => 'Speed ' + m[1] + 'x',
    run: (m) => {
      const n = wordToNum(m[1]) ?? parseFloat(m[1]);
      if (!n || !isFinite(n)) return { ok:false };
      vid.playbackRate = Math.max(0.1, Math.min(80, n));
      return { ok:true };
    }
  },
  { re: /^(?:analyze|run|detect|find)\s+motion(?:\s+analysis)?$/i, label: () => 'Motion analysis',
    run: () => { runMotion(); return { ok:true }; } },
  { re: /^(?:open|show)\s+bookmarks$/i, label: () => 'Bookmarks', run: () => { showBookmarks(); return { ok:true }; } },
  { re: /^(?:open|show)\s+menu$/i, label: () => 'Menu', run: () => { showMenu(); return { ok:true }; } },
  { re: /^help$/i, label: () => 'Help', run: () => { showHelp(); return { ok:true }; } },
];

function runCommand(rawText) {
  const text = normalizeCmd(rawText);
  if (!text) return { ok:false, err:'Empty' };
  for (const rule of CMD_RULES) {
    const m = text.match(rule.re);
    if (m) {
      try {
        const r = rule.run(m) || { ok:true };
        r.label = r.label || (rule.label ? rule.label(m) : null);
        return r;
      } catch (err) { return { ok:false, err:err.message }; }
    }
  }
  return { ok:false, err:'Did not understand "' + rawText + '"' };
}

function cmdFeedbackShow(text, isError, isLabel) {
  cmdFeedback.replaceChildren();
  if (isLabel) {
    const b = document.createElement('b');
    b.style.color = 'var(--accent)';
    b.textContent = text;
    cmdFeedback.appendChild(b);
  } else if (isError) {
    const b = document.createElement('b');
    b.textContent = '? ';
    cmdFeedback.appendChild(b);
    cmdFeedback.appendChild(document.createTextNode(text));
  } else {
    cmdFeedback.textContent = text;
  }
  cmdFeedback.classList.toggle('error', !!isError);
  cmdFeedback.classList.add('show');
  clearTimeout(cmdFeedbackShow._t);
  cmdFeedbackShow._t = setTimeout(() => cmdFeedback.classList.remove('show'), 3000);
}
function runFromInput() {
  const text = cmdInput.value.trim();
  if (!text) return;
  const r = runCommand(text);
  if (r.ok) {
    cmdFeedbackShow(r.label || 'Done', false, true);
    cmdInput.value = '';
    setTimeout(hideCmdSheet, 400);
  } else {
    cmdFeedbackShow(r.err, true);
  }
}
cmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); runFromInput(); }
  if (e.key === 'Escape') { e.preventDefault(); hideCmdSheet(); }
});

let recog = null, listening = false;
function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { cmdFeedbackShow('Voice not supported on this device', true); return; }
  if (listening) { stopListening(); return; }
  recog = new SR();
  recog.lang = navigator.language || 'en-US';
  recog.interimResults = true;
  recog.continuous = false;
  recog.onstart = () => {
    listening = true; micBtn.classList.add('listening');
    cmdFeedbackShow('Listening...', false, true);
  };
  recog.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    cmdInput.value = last[0].transcript.trim();
    if (last.isFinal) { stopListening(); setTimeout(runFromInput, 80); }
  };
  recog.onerror = (e) => { cmdFeedbackShow(e.error, true); stopListening(); };
  recog.onend = () => stopListening();
  try { recog.start(); } catch(e) { cmdFeedbackShow(e.message, true); }
}
function stopListening() {
  listening = false; micBtn.classList.remove('listening');
  if (recog) { try { recog.stop(); } catch(e) {} recog = null; }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// If opened on desktop, show a small "open editor" banner
(function() {
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (!isTouch && window.innerWidth > 900) {
    const banner = document.createElement('a');
    banner.href = 'editor.html';
    banner.textContent = 'Tip: open editor.html on desktop for the full feature set →';
    banner.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:var(--accent);color:var(--accent-dark);padding:8px 14px;border-radius:14px;font-size:12px;text-decoration:none;z-index:300;';
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
  }
})();
