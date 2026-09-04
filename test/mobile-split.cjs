// Targeted real-browser check: desktop-derived editor, both decode paths and local WASM.
// Run: npx electron test/mobile-split.cjs (requires ffmpeg).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
process.on('uncaughtException', (error) => { console.error(error); app.exit(1); });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-split-'));
const audio = path.join(directory, 'test.m4a');
require('../mobile-rn/scripts/build-split.cjs')();
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i',
  String.raw`aevalsrc=if(lt(mod(t\,60)\,57)\,0.3*sin(2*PI*(440+50*sin(t))*t)\,0):s=48000:d=180`,
  '-c:a', 'aac', '-b:a', '96k', audio]);
const fragmented = path.join(directory, 'fragmented.m4a');
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-loglevel', 'error', '-i', audio, '-t', '3', '-c', 'copy',
  '-movflags', '+frag_keyframe+empty_moov+default_base_moof', fragmented]);
const video = path.join(directory, 'video.mp4');
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=16x16:rate=1',
  '-i', audio, '-t', '3', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'copy', video]);
const data = fs.readFileSync(audio).toString('base64');
const html = require('../mobile-rn/src/split/editor.generated.json');
const mock = `<script>
window.nativeCalls=[];
let downloadAttempts=0;
window.ReactNativeWebView={postMessage(raw){
 const message=JSON.parse(raw); nativeCalls.push(message);
 if(message.method==='ready'){setTimeout(()=>splitInit({bvid:'BVtest',cid:1,title:'测试混音',duration:180}),0);return;}
 let value;
 if(message.method==='detect') value=[{from:0,to:60,name:'第一首'},{from:60,to:180,name:'第二首'}];
 if(message.method==='get') value={status:200,body:'{"result":{"songs":[]},"data":{}}'};
 if(message.method==='download') {
   if(++downloadAttempts===1){setTimeout(()=>window.splitReply({id:message.id,error:'temporary download failure'}),0);return;}
   value={size:fromBase64('${data}').length};
 }
 if(message.method==='read') {const all=atob('${data}');value=btoa(all.slice(message.args.offset,message.args.offset+384*1024));}
 if(message.method==='save') value={id:7,count:message.args.segments.length};
 setTimeout(()=>window.splitReply({id:message.id,value}),0);
}};
</script>`;
fs.writeFileSync(path.join(directory, 'editor.html'), html.replace('<script>', mock + '<script>'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 362, height: 700, show: false,
    webPreferences: { offscreen: true, contextIsolation: true } });
  try {
    await win.loadFile(path.join(directory, 'editor.html'));
    const result = await win.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<100&&!document.querySelector('.split-row');i++) await new Promise(r=>setTimeout(r,20));
      if(!document.querySelector('.split-row')) throw Error('editor did not initialize');
      const initialRows=document.querySelectorAll('.split-row').length;
      for(let i=0;i<100&&document.querySelector('#splitWaveStatus button').hidden;i++) await new Promise(r=>setTimeout(r,20));
      const retryVisible=!document.querySelector('#splitWaveStatus button').hidden;
      const railVisible=!document.getElementById('splitWave').hidden;
      document.querySelector('#splitWaveStatus button').click();
      for(let i=0;i<500&&!splitWave;i++) await new Promise(r=>setTimeout(r,20));
      if(!splitWave) throw Error('waveform did not load automatically: '+document.getElementById('splitWaveStatus').textContent);
      const initialSegments=splitSegments.map(s=>[s.from,s.to]);
      const canvas=document.getElementById('splitWaveCanvas');
      const painted=canvas.width>0&&canvas.height>0&&canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0);
      const waveReady=document.getElementById('splitWaveStatus').hidden&&painted;
      const rect=document.getElementById('splitWave').getBoundingClientRect();
      const boundary=document.querySelector('[data-ri="0"] .rh-r');
      // Synthetic PointerEvents have no active OS pointer to capture.
      const wave=document.getElementById('splitWave'), capture=wave.setPointerCapture;
      wave.setPointerCapture=()=>{};
      boundary.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientX:rect.left+rect.width/3}));
      document.getElementById('splitWave').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:rect.left+rect.width/4}));
      document.getElementById('splitWave').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:rect.left+rect.width/4}));
      wave.setPointerCapture=capture;
      const draggedBoundary=splitSegments[0].to;
      splitSegments[0].to=60;renderSplitList();
      await openSplitPop(0);window.dispatchEvent(new Event('resize'));
      const popoverSurvived=!!document.querySelector('.split-pop');closeSplitPop();
      cursorTime=30; document.getElementById('splitAtCursor').click();
      const divided=splitSegments.map(s=>[s.from,s.to]);
      selected=0;document.getElementById('splitMerge').click();
      const merged=splitSegments.map(s=>[s.from,s.to]);
      let frames=0;
      const bytes=await audioBytes();
      await splitDecodeAacFrames(bytes,{from:70,to:72,onFrame(){frames++}});
      let fragmentFrames=0,videoFrames=0;
      await splitDecodeAacFrames(fromBase64('${fs.readFileSync(fragmented).toString('base64')}'),{onFrame(){fragmentFrames++}});
      await splitDecodeAacFrames(fromBase64('${fs.readFileSync(video).toString('base64')}'),{onFrame(){videoFrames++}});
      const transition=await api.splitAnalyzeAudio('',0,180,null,'transition');
      const silence=await api.splitAnalyzeAudio('',0,180,null,'silence');
      const interval=await api.splitAnalyzeAudio('',0,180,null,'interval');
      splitWave=transition;document.getElementById('splitWave').hidden=false;
      document.getElementById('splitWaveTime').hidden=false;renderSplitWave();
      const decoder=window.AudioDecoder;window.AudioDecoder=undefined;
      let fallbackSamples=0;
      await splitDecodeAacFrames(bytes,{from:0,to:8,onFrame(mono){fallbackSamples+=mono.length}});
      window.AudioDecoder=decoder;
      await shazam.init();
      const signature=shazam.DecodedSignature.new(new Float32Array(16000*8).map((_,i)=>Math.sin(i/12)),16000,1);
      const shazamUri=signature.uri;signature.free();
      let ncmStatus;
      try { const encoded=await ncm.Encode({sampleRate:48000,getChannelData:()=>new Float32Array(48000*8).map((_,i)=>Math.sin(i/(8+Math.sin(i/48000))))},0,6,0); ncmStatus=encoded.length; }
      catch(error){ncmStatus=String(error);}
      await splitCreatePlaylist();
      return {initialRows,retryVisible,railVisible,waveReady,initialSegments,draggedBoundary,
        downloads:nativeCalls.filter(c=>c.method==='download').length,
        errors:nativeCalls.filter(c=>c.method==='error'),
        popoverSurvived,divided,merged,frames,fragmentFrames,videoFrames,transition:transition.segs,silence:silence.segs,interval:interval.segs,
        fallbackSamples,shazamUri,ncmStatus,saved:nativeCalls.some(c=>c.method==='saved'),
        overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    assert.equal(result.initialRows, 2);
    assert.equal(result.railVisible, true, 'waveform rail stays visible even if audio loading fails');
    assert.equal(result.retryVisible, true);
    assert.equal(result.waveReady, true, 'real waveform is painted without clicking Analyze');
    assert.deepEqual(result.initialSegments, [[0, 60], [60, 180]], 'waveform loading preserves chapter boundaries');
    assert.ok(Math.abs(result.draggedBoundary-45)<0.2, 'desktop boundary drag works on the mobile waveform');
    assert.equal(result.downloads, 2, 'retry downloads once and subsequent analysis modes reuse cached audio');
    assert.deepEqual(result.errors, [], 'editor must not report browser runtime errors');
    assert.equal(result.popoverSurvived, true, 'software keyboard resizing must not dismiss candidate search');
    assert.deepEqual(result.divided, [[0, 30], [30, 60], [60, 180]]);
    assert.deepEqual(result.merged, [[0, 60], [60, 180]]);
    assert.ok(result.frames > 0);
    assert.ok(result.fragmentFrames > 0 && result.videoFrames > 0, 'fragmented AAC and video-first MP4 both decode their audio track');
    assert.ok(result.transition.length > 1);
    assert.ok(result.silence.length > 1);
    assert.deepEqual(result.interval.map(s => [s.from, s.to]), [[0, 180]]);
    assert.ok(result.fallbackSamples > 300000);
    assert.ok(result.shazamUri.startsWith('data:audio/vnd.shazam.sig;'));
    assert.ok(typeof result.ncmStatus === 'number' && result.ncmStatus > 80, `NCM WASM: ${result.ncmStatus}`);
    assert.equal(result.saved, true);
    assert.equal(result.overflow, false);
    fs.writeFileSync('/tmp/biu-mobile-split.png', (await win.webContents.capturePage()).toPNG());
    console.log('PASS: automatic waveform, retry, boundary drag, split/merge/save, three modes, WebCodecs/ADTS, NCM/Shazam WASM');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { fs.rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
});
