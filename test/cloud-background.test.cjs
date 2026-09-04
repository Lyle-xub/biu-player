const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const source=fs.readFileSync(require.resolve('../main.js'),'utf8');
test('closing the last window retains cloud work, tray reopens it, explicit quit is available',()=>{
 const app=new EventEmitter();let quits=0,opens=0,menu;
 app.quit=()=>{quits++;app.emit('before-quit');};
 class Tray extends EventEmitter {setToolTip(){}setContextMenu(items){menu=items;}destroy(){this.destroyed=true;}}
 const ctx=vm.createContext({app,Tray,Menu:{buildFromTemplate:x=>x},nativeImage:{createFromPath:()=>({resize:()=>({})})},path:require('node:path'),__dirname:'/tmp',BrowserWindow:{getAllWindows:()=>[]},open:()=>opens++});
 vm.runInContext(`let mainWin=null,lyricWin=null,cloudTray=null,keepCloudRunning=false,quitting=false;
 function createWindow(){open();mainWin={isDestroyed:()=>false,isMinimized:()=>false,show(){},focus(){}};}
 app.on('before-quit',()=>{quitting=true;});`+source.slice(source.indexOf('function showMainWindow()'),source.indexOf('/* ---------- WBI'))+source.slice(source.lastIndexOf("app.on('window-all-closed'")),ctx);
 ctx.updateCloudBackground({signedIn:true,enabled:true});
 app.emit('window-all-closed');assert.equal(quits,0);
 menu[0].click();assert.equal(opens,1);menu[0].click();assert.equal(opens,1);
 menu[2].click();assert.equal(quits,1);
});
test('closing the last window exits normally with cloud sync disabled',()=>{
 const app=new EventEmitter();let quits=0;app.quit=()=>quits++;
 vm.runInNewContext(source.slice(source.lastIndexOf("app.on('window-all-closed'")),{app,lyricWin:null,keepCloudRunning:false});
 app.emit('window-all-closed');assert.equal(quits,1);
});
