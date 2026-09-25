const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('probe',{
  readDocument:path=>ipcRenderer.invoke('probe:read',path),
  analyze:()=>ipcRenderer.invoke('probe:analyze')
});
