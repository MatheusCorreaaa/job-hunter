'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('hunter',{
  request:(action,data)=>ipcRenderer.invoke('hunter:request',action,data),
  onState:(callback)=>ipcRenderer.on('hunter:state',(_event,state)=>callback(state)),
  onRoute:(callback)=>ipcRenderer.on('hunter:route',(_event,route)=>callback(route)),
  onBrowser:(callback)=>ipcRenderer.on('hunter:browser',(_event,state)=>callback(state))
});
