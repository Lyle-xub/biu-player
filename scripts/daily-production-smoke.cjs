// Read-only end-to-end test of the production manager with the local main profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const R=require('../renderer/recommendation-profile'),D=require('../renderer/daily-recommendation');
const {get,ensureVisitor,trace}=require('./daily-music-smoke.cjs');
async function main(){
 const store=JSON.parse(fs.readFileSync(path.join(os.homedir(),'Library/Application Support/biu-player/biu-store.json'),'utf8'));
 const key=Object.keys(store).find(k=>k.startsWith('biu-recommendation-profiles@'));
 if(!key)throw Error('没有找到登录账号的主画像');
 let disk=R.normalize(typeof store[key]==='string'?JSON.parse(store[key]):store[key]);
 const initial=structuredClone(disk),start=performance.now();
 await ensureVisitor();
 const manager=R.createManager({read:async()=>disk,write:async v=>{disk=v;},getLikes:()=>[],get});
 let count=-1;manager.subscribe(()=>{const n=D.current(manager.getSnapshot().daily)?.tracks.length||0;if(n!==count){count=n;console.log('已匹配',n);}});
 const first=await manager.generateDaily(true),firstMs=Math.round(performance.now()-start);
 const firstKeys=new Set(first.tracks.flatMap(D.songKeys));
 const second=await manager.generateDaily(true);
 const report={at:new Date().toISOString(),firstMs,totalMs:Math.round(performance.now()-start),
  rounds:[first,second].map(entry=>({count:entry.tracks.length,complete:entry.complete,error:entry.error,tracks:entry.tracks.map(t=>({bvid:t.bvid,title:t.title,song:t.song,reason:t.recommendationReason}))})),
  repeatedSongs:second.tracks.filter(t=>D.songKeys(t).some(k=>firstKeys.has(k))).map(t=>t.bvid),
  previousVideos:initial.daily.shown.length,trace};
 fs.writeFileSync('/tmp/biu-daily-production-smoke.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({first:first.tracks.length,second:second.tracks.length,firstMs,totalMs:report.totalMs,repeated:report.repeatedSongs,error:first.error||second.error}));
 manager.dispose();
 if(first.tracks.length<15||second.tracks.length<15||report.repeatedSongs.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
