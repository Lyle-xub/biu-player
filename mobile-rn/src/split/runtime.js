/* Adapt the desktop editor to touch input and the native player/network bridge. */
let compressed = null;
let envelope = null;
let waveform = null;
let selected = 0;
let cursorTime = 0;
let operation = 0;
let analysisTask = null;

async function audioBytes(progress) {
  if (compressed) return compressed;
  const token = operation;
  const { size } = await rpc('download');
  if (token !== operation) throw new Error('已取消分析');
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += 384 * 1024) {
    const chunk = fromBase64(await rpc('read', { offset }));
    if (token !== operation) throw new Error('已取消分析');
    if (!chunk.length) throw new Error('音频缓存不完整，请重试');
    bytes.set(chunk, offset);
    progress?.('download', Math.min(1, (offset + chunk.length) / size));
  }
  compressed = bytes;
  return bytes;
}

// Waveform loading and automatic segmentation share one download/decode pass.
async function prepareWaveform(progress) {
  if (envelope) return;
  if (analysisTask) return analysisTask;
  const token = operation;
  analysisTask = (async () => {
    const report = (phase, ratio) => {
      if (token !== operation) return;
      setWaveStatus(phase === 'download' ? `正在读取音频… ${Math.round(ratio * 100)}%`
        : `正在生成波形… ${Math.round(ratio * 100)}%`);
      progress?.(phase, ratio);
    };
    setWaveStatus('正在下载音频…');
    const bytes = await audioBytes(report);
    const sums = [], counts = [], peaks = [];
    let end = 0;
    await window.splitDecodeAacFrames(bytes, {
      onFrame(mono, rate, time) {
        if (token !== operation) throw new Error('已取消分析');
        end = Math.max(end, time + mono.length / rate);
        for (let i = 0; i < mono.length; i += 2) {
          const bin = Math.floor((time + i / rate) / 0.05), value = mono[i];
          sums[bin] = (sums[bin] || 0) + value * value;
          counts[bin] = (counts[bin] || 0) + 1;
          peaks[bin] = Math.max(peaks[bin] || 0, Math.abs(value));
        }
      },
      onProgress(ratio) { report('decode', ratio); },
    });
    if (token !== operation) throw new Error('已取消分析');
    if (!(end > 0) || !peaks.length) throw new Error('未能解码音频，请重试');
    const length = Math.floor(end / 0.05);
    envelope = { e: Float32Array.from({ length }, (_, i) => counts[i] ? sums[i] / counts[i] : 0), hop: 0.05, total: end };
    const step = Math.max(1, Math.ceil(peaks.length / 20000));
    const reduced = Array.from({ length: Math.ceil(peaks.length / step) }, (_, i) =>
      Math.max(0, ...peaks.slice(i * step, (i + 1) * step).map((v) => v || 0)));
    const max = Math.max(0.000001, ...reduced);
    waveform = Float32Array.from(reduced, (value) => value / max);
    setWaveStatus('');
  })();
  try { await analysisTask; }
  finally { if (token === operation) analysisTask = null; }
}

api.splitAnalyzeAudio = async (_bvid, _cid, duration, progress, mode) => {
  const token = operation;
  await prepareWaveform(progress);
  progress?.('analyze', 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (token !== operation) throw new Error('已取消分析');
  const total = Math.min(duration || envelope.total, envelope.total);
  const segs = detectSegments(envelope, total, mode);
  // Preserve the end of very long recordings when the desktop's 60-row cap applies.
  if (segs.length === 60) segs[59].to = Math.round(total * 10) / 10;
  return { segs, pcm: true, rate: 24000, peaks: waveform, duration: total, srcPcm: null };
};

function setWaveStatus(message, retry = false) {
  const status = $('splitWaveStatus');
  if (!status) return;
  status.hidden = !message;
  status.querySelector('span').textContent = message || '';
  status.querySelector('button').hidden = !retry;
}

async function loadSplitWaveform() {
  const source = splitSource, token = operation;
  if (!source) return;
  try {
    await prepareWaveform();
    if (token !== operation || splitSource !== source) return;
    splitWave = { pcm: true, rate: 24000, peaks: waveform,
      duration: Math.min(source.duration || envelope.total, envelope.total), srcPcm: null };
    setWaveStatus('');
    renderSplitWave();
  } catch (error) {
    if (token === operation && splitSource === source) setWaveStatus(`波形加载失败：${error.message || error}`, true);
  }
}

api.identifySegmentAudio = async (_pcm, from, to, _hires, log = () => {}) => {
  if (!compressed) throw new Error('请先运行智能分析');
  const length = Math.min(25, to - from);
  if (length < 3) return null;
  let clip, sourceRate;
  await window.splitDecodeAacFrames(compressed, { from, to: from + length,
    onFrame(mono, rate, time) {
      if (!clip) { sourceRate = rate; clip = new Float32Array(Math.ceil(length * rate)); }
      const offset = Math.round((time - from) * rate);
      const start = Math.max(0, -offset), count = Math.min(mono.length, clip.length - offset);
      if (count > start) clip.set(mono.subarray(start, count), Math.max(0, offset));
    },
  });
  if (!clip) return null;
  try {
    log('网易云识曲：正在生成音频指纹…');
    const pcm = await renderClipRate(clip, sourceRate, 48000);
    const probeFrom = length > 10 ? 4 : 0, probeLength = Math.min(6, length - probeFrom);
    const encoded = await ncm.Encode({ sampleRate: 48000, getChannelData: () => pcm }, probeFrom, probeLength, 0);
    const hit = await rpc('netease', { encoded, duration: probeLength });
    if (hit) { log(`网易云命中：${hit.title} · ${hit.artist}`); return hit; }
  } catch (error) { log(`网易云识曲：${error.message || error}`); }
  log('网易云未命中，回退 Shazam…');
  await shazam.init();
  const start = length > 16 ? 4 : 0;
  const pcm = await renderClipRate(clip.subarray(Math.floor(start * sourceRate), Math.floor(Math.min(length, start + 12) * sourceRate)), sourceRate, 16000);
  const signature = shazam.DecodedSignature.new(pcm, 16000, 1);
  try {
    const hit = await rpc('shazam', { uri: signature.uri, samplems: signature.samplems });
    log(hit ? `Shazam 命中：${hit.title} · ${hit.artist}` : 'Shazam 未命中');
    return hit;
  } finally { signature.free(); }
};

// Use the mobile parser as well, preserving numeric song names and rejecting invalid seconds.
api.mixSplitDetect = () => rpc('detect');
const desktopRender = renderSplitList;
renderSplitList = function () {
  selected = Math.max(0, Math.min(selected, splitSegments.length - 1));
  desktopRender();
  $('splitList').querySelectorAll('.split-row').forEach((row, i) => {
    row.dataset.selected = String(i === selected);
    row.addEventListener('pointerdown', () => {
      selected = i;
      $('splitList').querySelectorAll('.split-row').forEach((item, index) => { item.dataset.selected = String(index === i); });
    });
    row.querySelector('.split-name').setAttribute('aria-label', `第 ${i + 1} 段歌名`);
    row.querySelectorAll('.split-time').forEach((input) => {
      input.setAttribute('aria-label', `第 ${i + 1} 段${input.dataset.k === 'from' ? '开始' : '结束'}时间`);
      input.inputMode = 'decimal';
    });
    for (const [cls, label] of [['split-id', '识别此片段'], ['split-del', '删除分段'], ['split-pick', '更换歌曲匹配']]) {
      const node = row.querySelector('.' + cls);
      if (!node) continue;
      node.setAttribute('role', 'button'); node.setAttribute('aria-label', label); node.tabIndex = 0;
      node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') node.click(); });
    }
    const preview = document.createElement('button');
    preview.className = 'split-preview'; preview.textContent = '试听';
    preview.setAttribute('aria-label', `试听第 ${i + 1} 段`);
    preview.onclick = () => { selected = i; cursorTime = splitSegments[i].from; audio.currentTime = cursorTime; };
    row.appendChild(preview);
  });
};

// Keep the desktop's manual editor but clamp committed boundaries to the real source.
document.addEventListener('change', (event) => {
  if (!event.target.matches('.split-time')) return;
  const row = event.target.closest('.split-row'), index = +row.dataset.si, segment = splitSegments[index];
  const duration = splitSource?.duration || 0;
  const min = splitSegments[index - 1]?.to || 0, max = splitSegments[index + 1]?.from ?? duration;
  segment.from = Math.max(min, Math.min(segment.from, max - 0.1));
  segment.to = Math.max(segment.from + 0.1, Math.min(max, segment.to));
  renderSplitList();
});

const desktopClose = closeSplitPanel;
closeSplitPanel = function () {
  operation++; compressed = envelope = waveform = analysisTask = null;
  desktopClose();
  post({ method: 'close' });
};
splitCreatePlaylist = async function () {
  if (!splitSource) return;
  if (splitAnalyzing || splitIdentifying || splitSegments.some((s) => s.matching)) {
    toast('请等待当前分析或匹配完成后创建歌单'); return;
  }
  const button = $('splitCreate');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const result = await rpc('save', { segments: splitSegments });
    toast(`已创建歌单，共 ${result.count} 首`);
    post({ method: 'saved', args: { id: result.id } });
  } catch (error) { toast(error); }
  finally { button.disabled = false; }
};

function setupMobileSplit() {
  const waveStatus = document.createElement('div');
  waveStatus.id = 'splitWaveStatus'; waveStatus.className = 'mobile-wave-status';
  waveStatus.innerHTML = '<span role="status"></span><button hidden>重新加载波形</button>';
  waveStatus.querySelector('button').onclick = loadSplitWaveform;
  // Keep loading/retry controls outside the waveform's seek/drag handlers.
  $('splitWave').after(waveStatus);
  document.addEventListener('pointerdown', (event) => {
    if ((splitAnalyzing || splitIdentifying) && event.target.closest('button,input,textarea,.split-id,.split-del,.split-pick')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  const panel = document.querySelector('.split-panel');
  const tools = document.createElement('div');
  tools.className = 'mobile-tools';
  tools.innerHTML = '<button id="splitAtCursor">在游标处分割</button><button id="splitMerge">与下一段合并</button><button id="splitPaste">粘贴时间表</button>';
  panel.insertBefore(tools, $('splitList'));
  const importer = document.createElement('div');
  importer.className = 'mobile-import'; importer.hidden = true;
  importer.innerHTML = '<textarea aria-label="分切时间轴" placeholder="00:00 第一首&#10;03:30 第二首"></textarea><button>应用时间轴</button>';
  panel.insertBefore(importer, $('splitList'));
  $('splitPaste').onclick = () => { importer.hidden = !importer.hidden; };
  const importTimeline = async (text) => {
    try {
      const segs = await rpc('parse', { text });
      if (!segs.length) throw new Error('未识别到时间轴，请按每行「00:00 歌名」填写');
      splitSegments = segs; renderSplitList(); importer.hidden = true;
      splitSegments.forEach((s, i) => { if (s.name.trim()) autoMatchSegment(i); });
    } catch (error) { toast(error); }
  };
  importer.querySelector('button').onclick = () => importTimeline(importer.querySelector('textarea').value);
  $('splitFile').addEventListener('change', async (event) => {
    event.stopImmediatePropagation();
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { toast('时间表文件不能超过 1 MB'); return; }
    try { await importTimeline(await file.text()); } catch (error) { toast(error); }
  }, true);
  $('splitList').addEventListener('input', (event) => {
    if (!event.target.matches('.split-name')) return;
    const index = +event.target.closest('.split-row').dataset.si;
    splitSegments[index].match = null; splitSegments[index].candidates = null;
    updateSplitMatchCell(index);
  });
  $('splitAtCursor').onclick = () => {
    const time = cursorTime || audio.currentTime;
    const i = splitSegments.findIndex((s) => time > s.from + 2 && time < s.to - 2);
    if (i < 0) { toast('请先在波形中选择段内位置，切点距两端至少 2 秒'); return; }
    const s = splitSegments[i];
    splitSegments.splice(i, 1, { ...s, to: time }, { from: time, to: s.to, name: '', match: null });
    selected = i + 1; renderSplitList();
  };
  $('splitMerge').onclick = () => {
    const a = splitSegments[selected], b = splitSegments[selected + 1];
    if (!a || !b) { toast('请先选择要合并的前一段'); return; }
    a.to = b.to; if (!a.name.trim()) { a.name = b.name; a.match = b.match; }
    splitSegments.splice(selected + 1, 1); renderSplitList();
  };
  $('splitWave').addEventListener('pointerup', (event) => { cursorTime = splitWaveTimeAt(event.clientX); });
  $('splitWave').addEventListener('pointercancel', () => { splitWaveDrag = null; renderSplitList(); });
  $('splitAdd').addEventListener('click', () => {
    const segment = splitSegments.at(-1);
    segment.to = Math.min(segment.to, splitSource.duration);
    if (segment.from >= segment.to) { splitSegments.pop(); toast('已到视频末尾，请在现有分段内分割或编辑时间'); }
    renderSplitList();
  });
  const resized = () => {
    if (splitWave) renderSplitWave();
    const pop = document.querySelector('.split-pop');
    if (pop) {
      // Showing the software keyboard is a viewport resize, not a request to close search.
      const height = window.visualViewport?.height || innerHeight;
      pop.style.top = Math.max(8, Math.min(parseFloat(pop.style.top) || 8, height - pop.offsetHeight - 8)) + 'px';
      pop.querySelector('.split-pop-list').style.maxHeight = Math.max(80, Math.min(236, height - 100)) + 'px';
    }
  };
  window.addEventListener('resize', resized);
  window.visualViewport?.addEventListener('resize', resized);
  window.splitInit = async (source) => {
    state.current = source;
    const opening = openSplitPanel();
    if (splitSource === source) {
      $('splitWave').hidden = false;
      $('splitWaveTime').hidden = false;
      $('splitWaveTime').textContent = `${fmtWave(audio.currentTime)} / ${fmtWave(source.duration)}`;
      loadSplitWaveform();
    }
    try { await opening; } catch (error) { if (splitSource === source) toast(`章节读取失败，可手动分切：${error.message || error}`); }
  };
  window.splitClock = (position, playing) => { clock = { position, playing, timestamp: performance.now() }; };
  window.splitDownloadProgress = (ratio) => {
    if (analysisTask) setWaveStatus(`正在下载音频… ${Math.round(ratio * 100)}%`);
  };
  post({ method: 'ready' });
}
