const {app,BrowserWindow,ipcMain,utilityProcess}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const core=require('../core.cjs');
app.setPath('userData',process.env.PRE03_USERDATA || path.join(app.getPath('temp'),'metis-pre03-probe'));
const workspace=process.env.PRE03_WORKSPACE;
let win;
const page=path.resolve(__dirname,'../dist/index.html');
function valid(event){if(!win || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame || event.senderFrame.url!==pathToFileURL(page).href) throw Error('invalid-sender');}
app.whenReady().then(async()=>{
 win=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',event=>event.preventDefault());
 win.webContents.session.setPermissionRequestHandler((_wc,_p,done)=>done(false));
 ipcMain.handle('probe:read',(event,input)=>{valid(event);return core.read(workspace,input);});
 ipcMain.handle('probe:analyze',event=>{
  valid(event);
  return new Promise((resolve,reject)=>{
   const child=utilityProcess.fork(path.join(__dirname,'worker.cjs'));
   const timer=setTimeout(()=>{child.kill();reject(Error('worker-timeout'));},20000);
   child.once('message',message=>{clearTimeout(timer);child.kill();message.error?reject(Error(message.error)):resolve(message);});
   child.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('worker-exit:'+code));});
   child.postMessage({text:'= Utility\n\nWARNING: Preserve source.'});
  });
 });
 await win.loadFile(page);
});
app.on('window-all-closed',()=>app.quit());
