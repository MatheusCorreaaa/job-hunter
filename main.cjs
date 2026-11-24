'use strict';

const {app,BrowserWindow,WebContentsView,Tray,Menu,Notification,dialog,ipcMain,session,nativeImage,nativeTheme,safeStorage,clipboard,shell,powerMonitor}=require('electron');
const {scan,publicFetch,url,fingerprints,profile,MODES,coverageAllows,fresh,expired,localDate}=require('./jobs.cjs');
const {readFileSync,writeFileSync,renameSync,existsSync}=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const JOB_SOURCES=require('./src/sources.js');
const {APPLICATION_STATES,activeApplication,applicationEntry,dueSlot,todaySlots,nextScheduledScan}=require('./src/workflow.js');
const SOURCE_IDS=JOB_SOURCES.map((source)=>source.id);
const THEMES=['system','light','dark'];
const SOURCE_CATALOGUE_VERSION=2;
const BASE_SOURCE_IDS=['gupy','jobbol','linkedin','indeed','riovagas','vagas'];
const HOUR=3600000;
const WINDOWS_APP_ID='br.jobhunter.radar';
const ASSETS=path.join(__dirname,'src','assets');
const WINDOWS_ICON=path.join(ASSETS,'app-icon.ico');
const testDataDir=process.env.JOB_HUNTER_TEST_DATA_DIR;
if (testDataDir) app.setPath('userData',testDataDir);
if (process.platform==='win32') app.setAppUserModelId(WINDOWS_APP_ID);

const defaultSettings={auto:true,notifications:true,modes:MODES,theme:'system',sourceIds:SOURCE_IDS,sourceCatalogueVersion:SOURCE_CATALOGUE_VERSION,includeSaoPaulo:true,includeInternational:true,firecrawl:true,alexandria:false};
const blankStatus={lastRun:null,lastSuccess:null,nextRun:null,failures:0,firstFailure:null,persistentAlert:false,lastScheduledSlot:null,scheduledRuns:[],sources:{}};
const initial={demo:true,jobs:[],saved:['demo-1'],applications:{},alerts:[],seen:[],profile,settings:defaultSettings,status:blankStatus,resumePath:'',encryptedKey:''};
const homePage=path.join(__dirname,'src','index.html');
const localPage=pathToFileURL(homePage).href;
let data;
let statePath;
let window;
let tray;
let browser;
let browserState={open:false,url:'',canGoBack:false,failed:false};
let portalSession;
let running=false;
let quitting=false;
let timer;
let searchProgress=null;
const nativeAlerts=new Set();

function readState() {
  try {
    const stored=JSON.parse(readFileSync(statePath,'utf8'));
    const settings={...defaultSettings,...stored.settings};
    if (!Array.isArray(stored.settings?.sourceIds)) {
      settings.sourceIds=SOURCE_IDS.filter((id)=>id!=='gupy' || stored.settings?.gupy!==false);
      settings.firecrawl=true;
    }
    if (stored.settings?.sourceCatalogueVersion!==SOURCE_CATALOGUE_VERSION) {
      const newSources=SOURCE_IDS.filter((id)=>!BASE_SOURCE_IDS.includes(id));
      settings.sourceIds=[...new Set([...settings.sourceIds,...newSources])];
      settings.sourceCatalogueVersion=SOURCE_CATALOGUE_VERSION;
    }
    if (!THEMES.includes(settings.theme)) settings.theme='system';
    const status={...blankStatus,...stored.status};
    if (!Array.isArray(stored.status?.scheduledRuns)) {
      status.scheduledRuns=[];
      status.lastScheduledSlot=null;
    }
    return {...initial,...stored,profile:{...profile,...stored.profile},settings,status};
  } catch(error) {
    if (error.code!=='ENOENT') {
      try { renameSync(statePath,statePath+'.invalid-'+Date.now()); } catch {}
    }
    return structuredClone(initial);
  }
}

function save() {
  const next=statePath+'.tmp';
  writeFileSync(next,JSON.stringify(data),{mode:0o600});
  renameSync(next,statePath);
}

function apiKey() {
  if (process.env.FIRECRAWL_API_KEY?.trim()) return process.env.FIRECRAWL_API_KEY.trim();
  if (!data.encryptedKey) return '';
  try { return safeStorage.decryptString(Buffer.from(data.encryptedKey,'base64')); }
  catch { return ''; }
}

function state() {
  const slots=todaySlots(localDate(Date.now()));
  const scheduledRuns=slots.map((slot)=>({slot,run:data.status.scheduledRuns.find((entry)=>entry.slot===slot) ?? null}));
  return {
    version:app.getVersion(),demo:data.demo,jobs:data.jobs,saved:data.saved,applications:data.applications,alerts:data.alerts,
    profile:data.profile,settings:data.settings,
    status:{running,lastRun:data.status.lastRun,nextRun:data.status.nextRun,scheduledRuns,sources:data.status.sources,progress:searchProgress}
  };
}

function publish() {
  if (window && !window.isDestroyed()) window.webContents.send('hunter:state',state());
}

function commit() {
  save();
  publish();
  if (tray) tray.setToolTip(data.demo?'Job Hunter · Demonstração':running?'Job Hunter · Buscando vagas':'Job Hunter');
  return state();
}

function nextRun(now=Date.now()) {
  if (data.demo || !data.settings.auto) return null;
  return nextScheduledScan(localDate(now),now,data.status.lastScheduledSlot);
}

function arm() {
  clearTimeout(timer);
  const scheduled=nextRun();
  data.status.nextRun=scheduled;
  if (scheduled && !running) {
    timer=setTimeout(()=>void run(true),Math.max(0,scheduled-Date.now()));
  }
}

function alertUser(title, copy, type, ids=[]) {
  data.alerts=[{title,copy,type,ids,at:Date.now(),read:false},...data.alerts].slice(0,150);
  return {title,copy,route:type==='failure'?'sources':'radar'};
}

function displayAlert(entry) {
  if (!data.settings.notifications || !Notification.isSupported()) return;
  const notification=new Notification({title:entry.title,body:entry.copy,icon:appIcon()});
  notification.on('click',()=>{
    showWindow();
    window.webContents.send('hunter:route',entry.route);
  });
  notification.once('close',()=>nativeAlerts.delete(notification));
  notification.once('failed',()=>nativeAlerts.delete(notification));
  nativeAlerts.add(notification);
  try { notification.show(); } catch { nativeAlerts.delete(notification); }
}

function mergeJobs(result) {
  const history=new Set(data.seen);
  const jobs=[...data.jobs];
  const freshJobs=[];
  const discovered=new Set(result.jobs.flatMap(fingerprints));
  const closedUrls=new Set(result.closedUrls);
  for (const job of result.jobs) {
    const keys=fingerprints(job);
    const existing=jobs.findIndex((old)=>fingerprints(old).some((key)=>keys.includes(key)));
    if (existing>=0) {
      jobs[existing]={...job,id:jobs[existing].id};
    } else {
      jobs.push(job);
      if (!keys.some((key)=>history.has(key))) freshJobs.push(job);
    }
    for (const key of keys) history.add(key);
  }
  data.seen=[...history];
  data.jobs=jobs.filter((job)=>{
    if (data.saved.includes(job.id)||activeApplication(data.applications[job.id])) return true;
    return fresh(job.publishedAt,Date.now()) && !expired(job.validThrough,Date.now()) &&
      (!closedUrls.has(job.sourceUrl)||fingerprints(job).some((key)=>discovered.has(key)));
  }).map((job)=>closedUrls.has(job.sourceUrl) && !fingerprints(job).some((key)=>discovered.has(key)) ?
      {...job,validThrough:new Date(Date.now()-1000).toISOString()} : job);
  return freshJobs;
}

async function run(scheduled=false) {
  if (running || data.demo) return;
  const began=Date.now();
  const pending=data.settings.auto?dueSlot(localDate(began),began):null;
  const slot=pending>(data.status.lastScheduledSlot || 0)?pending:null;
  if (scheduled && !slot) {
    arm();
    publish();
    return;
  }
  running=true;
  searchProgress={checked:0,queued:0};
  clearTimeout(timer);
  publish();
  const settings={...data.settings,modes:[...data.settings.modes]};
  const user={...data.profile};
  const key=apiKey();
  let result;
  const discoveredJobs=new Map();
  let lastUpdate=0;
  function onProgress(progress) {
    if (data.demo) return;
    searchProgress={checked:progress.checked,queued:progress.queued};
    if (progress.job && coverageAllows(progress.job,data.settings)) {
      for (const job of mergeJobs({jobs:[progress.job],closedUrls:[]}).filter((item)=>!activeApplication(data.applications[item.id]))) {
        discoveredJobs.set(job.id,job);
      }
    }
    if (progress.job || Date.now()-lastUpdate>300) {
      lastUpdate=Date.now();
      publish();
    }
  }
  try { result=await scan({settings,user,key,fetcher:publicFetch,previous:data.jobs,now:began,onProgress}); }
  catch { result={jobs:[],closedUrls:[],blocked:true,partial:true}; }
  const stamp=Date.now();
  searchProgress=null;
  const notifications=[];
  if (data.demo) {
    running=false;
    arm();
    commit();
    return;
  }
  if (slot) {
    data.status.lastScheduledSlot=slot;
    data.status.scheduledRuns=[{slot,completedAt:stamp,blocked:result.blocked},...data.status.scheduledRuns].slice(0,9);
  }
  data.status.lastRun=stamp;
  data.status.sources=result.sources || {};
  for (const job of mergeJobs({...result,jobs:result.jobs.filter((item)=>coverageAllows(item,data.settings))})) {
    discoveredJobs.set(job.id,job);
  }
  const found=data.jobs.filter((job)=>discoveredJobs.has(job.id) && !activeApplication(data.applications[job.id]) &&
    fresh(job.publishedAt,stamp) && !expired(job.validThrough,stamp)).sort((a,b)=>b.score-a.score);
  if (found.length) {
    const top=found.slice(0,3).map((job)=>job.company+' · '+job.title+' ('+job.score+'%)').join('\n');
    notifications.push(alertUser(found.length+(found.length===1?' nova vaga qualificada':' novas vagas qualificadas'),top,'jobs',found.map((job)=>job.id)));
  }
  if (result.blocked) {
    data.status.failures++;
    data.status.firstFailure ||= stamp;
    if (data.status.failures>=3 && stamp-data.status.firstFailure>=24*HOUR && !data.status.persistentAlert) {
      data.status.persistentAlert=true;
      notifications.push(alertUser('Busca interrompida','As fontes configuradas seguem indisponíveis ou as páginas não puderam ser verificadas. Veja Fontes e contas.','failure'));
    }
  } else {
    data.status.lastSuccess=stamp;
    data.status.failures=0;
    data.status.firstFailure=null;
    data.status.persistentAlert=false;
  }
  running=false;
  arm();
  commit();
  notifications.forEach(displayAlert);
}

function appIcon() {
  if (process.platform==='win32') {
    const icon=nativeImage.createFromPath(WINDOWS_ICON);
    if (!icon.isEmpty()) return icon;
  }
  return nativeImage.createFromPath(path.join(ASSETS,'app-icon.png'));
}

function showWindow() {
  if (!window || window.isDestroyed()) createWindow();
  window.show();
  window.focus();
}

function createWindow() {
  window=new BrowserWindow({
    title:'Job Hunter '+app.getVersion(),width:1440,height:940,minWidth:760,minHeight:620,backgroundColor:(data.settings.theme==='dark'||(data.settings.theme==='system'&&nativeTheme.shouldUseDarkColors))?'#14111e':'#f8f7fc',show:false,icon:appIcon(),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}
  });
  if (process.platform==='win32') {
    const launcher=app.isPackaged?'"'+process.execPath+'"':'"'+process.execPath+'" "'+app.getAppPath()+'"';
    window.setAppDetails({appId:WINDOWS_APP_ID,appIconPath:WINDOWS_ICON,relaunchCommand:launcher,relaunchDisplayName:'Job Hunter'});
  }
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,details)=>{
    const address=typeof details==='string'?details:details.url;
    if (address!==localPage) event.preventDefault();
  });
  window.on('ready-to-show',()=>window.show());
  window.on('resize',resizeBrowser);
  window.on('close',(event)=>{
    if (quitting || !tray) return;
    event.preventDefault();
    window.hide();
  });
  window.on('closed',()=>{
    if (browser && !browser.webContents.isDestroyed()) browser.webContents.close();
    browser=null;
    window=null;
  });
  window.loadFile(homePage);
}

function createTray() {
  const image=appIcon();
  if (image.isEmpty()) return;
  try {
    tray=new Tray(image.resize({width:24,height:24}));
    tray.setToolTip('Job Hunter');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'Abrir Job Hunter',click:showWindow},
      {label:'Buscar agora',click:()=>{showWindow();void run();}},
      {type:'separator'},
      {label:'Sair do Job Hunter',click:()=>app.quit()}
    ]));
    tray.on('click',showWindow);
    tray.on('double-click',showWindow);
  } catch { tray=null; }
}

function resizeBrowser() {
  if (!browser || !window) return;
  const [width,height]=window.getContentSize();
  browser.setBounds({x:0,y:62,width,height:Math.max(0,height-62)});
}

function sendBrowser(overrides={}) {
  const contents=browser?.webContents;
  browserState={
    open:!!contents,url:contents?.getURL()||browserState.url,canGoBack:contents?.navigationHistory.canGoBack()||false,
    loading:contents?.isLoading()||false,failed:false,...overrides
  };
  if (browser) browser.setVisible(!browserState.failed);
  if (window && !window.isDestroyed()) window.webContents.send('hunter:browser',browserState);
  return browserState;
}

function externalView() {
  const view=new WebContentsView({webPreferences:{session:portalSession,contextIsolation:true,sandbox:true,nodeIntegration:false}});
  const contents=view.webContents;
  contents.setWindowOpenHandler(({url:address})=>{
    if (url(address)) setImmediate(()=>contents.isDestroyed() ? null : contents.loadURL(address).catch(()=>sendBrowser({failed:true,url:address})));
    return {action:'deny'};
  });
  for (const topic of ['will-navigate','will-redirect','will-frame-navigate']) {
    contents.on(topic,(event,details)=>{
      const address=typeof details==='string'?details:details.url;
      if (!url(address) && address!=='about:blank') event.preventDefault();
    });
  }
  contents.on('did-navigate',(_event,address,status)=>sendBrowser({failed:status>=400,url:address}));
  contents.on('did-stop-loading',()=>sendBrowser({failed:browserState.failed,loading:false}));
  contents.on('did-navigate-in-page',()=>sendBrowser());
  contents.on('did-start-loading',()=>sendBrowser());
  contents.on('did-fail-load',(_event,code,_description,address,isMainFrame)=>{
    if (isMainFrame && code!==-3) sendBrowser({failed:true,url:address});
  });
  return view;
}

function openBrowser(address) {
  if (!url(address)) throw new Error('Link de candidatura inválido.');
  if (!browser) {
    browser=externalView();
    window.contentView.addChildView(browser);
    resizeBrowser();
  }
  void browser.webContents.loadURL(address).catch(()=>{if(browser)sendBrowser({failed:true,url:address});});
  return sendBrowser({url:address,loading:true});
}

function closeBrowser() {
  if (browser) {
    window.contentView.removeChildView(browser);
    const old=browser;
    browser=null;
    old.webContents.close();
  }
  return sendBrowser({url:''});
}

function findJob(id) {
  return data.jobs.find((job)=>job.id===id);
}

function clean(value,cap) {
  return typeof value==='string' ? value.trim().slice(0,cap) : '';
}

function updateProfile(payload) {
  const name=clean(payload.name,100);
  const course=clean(payload.course,150);
  const graduation=clean(payload.graduation,7);
  if (!name || !course || !/^20\d\d-(?:0[1-9]|1[0-2])$/.test(graduation)) throw new Error('Preencha nome, curso e previsão de conclusão.');
  if (!Array.isArray(payload.skills)) throw new Error('Lista de competências inválida.');
  data.profile={...data.profile,name,course,graduation,period:clean(payload.period,40),experience:clean(payload.experience,300),
    skills:[...new Set(payload.skills.map((skill)=>clean(skill,80)).filter(Boolean))].slice(0,40)};
  return commit();
}

function requireTrackedJob(id) {
  if (!findJob(id) && !(data.demo && /^demo-[0-4]$/.test(id))) throw new Error('Vaga indisponível.');
}

function startApplication(id) {
  requireTrackedJob(id);
  if (activeApplication(data.applications[id])) return state();
  data.applications[id]=applicationEntry(data.applications[id],{active:true});
  return commit();
}

const commands={
  state,
  enable:()=>{
    data.demo=false;
    data.status.failures=0;
    data.status.firstFailure=null;
    data.status.persistentAlert=false;
    arm();
    commit();
    void run();
    return state();
  },
  demo:()=>{
    data.demo=true;
    arm();
    return commit();
  },
  scan:()=>{void run();return state();},
  toggleSaved:({id})=>{
    if (!findJob(id) && !/^demo-[0-4]$/.test(id)) throw new Error('Vaga indisponível.');
    const index=data.saved.indexOf(id);
    if (index<0) data.saved.push(id);
    else data.saved.splice(index,1);
    return commit();
  },
  updateProfile,
  updateSettings:({auto,notifications,modes,includeSaoPaulo,includeInternational})=>{
    if (!Array.isArray(modes)||!modes.length||modes.some((mode)=>!MODES.includes(mode))) {
      throw new Error('Escolha pelo menos uma modalidade válida.');
    }
    data.settings={...data.settings,auto:!!auto,notifications:!!notifications,modes:[...new Set(modes)],includeSaoPaulo:includeSaoPaulo===undefined?data.settings.includeSaoPaulo:!!includeSaoPaulo,includeInternational:includeInternational===undefined?data.settings.includeInternational:!!includeInternational};
    arm();
    return commit();
  },
  updateSources:({sourceIds,firecrawl})=>{
    if (!Array.isArray(sourceIds) || sourceIds.some((id)=>!SOURCE_IDS.includes(id)) || (!sourceIds.length&&!firecrawl)) {
      throw new Error('Mantenha pelo menos uma fonte de pesquisa.');
    }
    data.settings={...data.settings,sourceIds:[...new Set(sourceIds)],firecrawl:!!firecrawl};
    arm();
    return commit();
  },
  updateTheme:({theme})=>{
    if (!THEMES.includes(theme)) throw new Error('Tema inválido.');
    data.settings={...data.settings,theme};
    return commit();
  },
  readAlerts:()=>{
    data.alerts=data.alerts.map((entry)=>({...entry,read:true}));
    return commit();
  },
  openBrowser:({id,portal,original})=>{
    const job=findJob(id);
    if (job) {
      const page=openBrowser(original?job.sourceUrl:job.applyUrl);
      startApplication(id);
      return page;
    }
    const source=JOB_SOURCES.find((entry)=>entry.id===portal);
    if (source) return openBrowser(source.url);
    throw new Error('Vaga ou portal indisponível.');
  },
  closeBrowser,
  browserBack:()=>{
    const history=browser?.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
    return sendBrowser();
  },
  browserReload:()=>{
    if (browser?.webContents.getURL()) browser.webContents.reload();
    else if (browser&&url(browserState.url)) void browser.webContents.loadURL(browserState.url).catch(()=>sendBrowser({failed:true}));
    return sendBrowser();
  },
  copyLink:({id})=>{
    const job=findJob(id);
    if (!job) throw new Error('Vaga indisponível.');
    clipboard.writeText(job.applyUrl);
    return {};
  },
  startApplication:({id})=>startApplication(id),
  markApplied:({id})=>{
    requireTrackedJob(id);
    const previous=data.applications[id];
    const now=new Date().toISOString();
    data.applications[id]=applicationEntry(previous,{active:true,status:'submitted',submittedAt:activeApplication(previous)?.submittedAt || now},now);
    return commit();
  },
  updateApplication:({id,status,notes})=>{
    requireTrackedJob(id);
    const previous=activeApplication(data.applications[id]);
    if (!previous || !APPLICATION_STATES.some((item)=>item.id===status)) throw new Error('Selecione uma etapa válida.');
    const now=new Date().toISOString();
    const submittedAt=previous.submittedAt || (status==='started'?null:now);
    data.applications[id]=applicationEntry(previous,{status,notes:clean(notes,4000),submittedAt},now);
    return commit();
  },
  restoreApplication:({id})=>{
    requireTrackedJob(id);
    const previous=activeApplication(data.applications[id]);
    if (!previous) return state();
    data.applications[id]=applicationEntry(previous,{active:false});
    return commit();
  },
  resume:async ()=>{
    const selected=await dialog.showOpenDialog(window,{title:'Selecione seu currículo',properties:['openFile'],filters:[{name:'Currículo em PDF',extensions:['pdf']}]});
    if (!selected.canceled && selected.filePaths[0]) {
      data.resumePath=selected.filePaths[0];
      data.profile.resumeName=path.basename(data.resumePath);
      return commit();
    }
    return state();
  },
  removeResume:()=>{
    data.resumePath='';
    data.profile.resumeName='';
    return commit();
  },
  showResume:()=>{
    if (!data.resumePath || !existsSync(data.resumePath)) throw new Error('Arquivo não localizado. Selecione o PDF de novo em Meu perfil.');
    shell.showItemInFolder(data.resumePath);
    return {};
  },
  clearSessions:async ()=>{
    closeBrowser();
    await portalSession.clearStorageData();
    await portalSession.clearCache();
    return {};
  }
};

if (!app.requestSingleInstanceLock()) {
  if (process.platform==='win32') {
    dialog.showErrorBox('Job Hunter '+app.getVersion(),'Já existe um Job Hunter em execução. Para abrir esta versão, clique com o botão direito no ícone do Job Hunter perto do relógio do Windows, selecione “Sair do Job Hunter” e abra novamente o executável desta versão.');
  }
  app.quit();
} else {
  app.on('second-instance',showWindow);
  app.on('activate',showWindow);
  app.on('before-quit',()=>{quitting=true;clearTimeout(timer);});
  app.on('window-all-closed',()=>{if(!tray&&process.platform!=='darwin')app.quit();});
  app.whenReady().then(()=>{
    statePath=path.join(app.getPath('userData'),'hunter.json');
    data=readState();
    portalSession=session.fromPartition('persist:jobhunter-portais');
    portalSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    portalSession.setPermissionCheckHandler(()=>false);
    ipcMain.handle('hunter:request',async (event,action,payload={})=>{
      if (event.sender!==window?.webContents||event.senderFrame?.url!==localPage||!Object.hasOwn(commands,action)) return {error:'Ação indisponível.'};
      try { return await commands[action](payload); }
      catch (error) { return {error:error.message||'A ação não foi concluída.'}; }
    });
    if (app.dock) app.dock.setIcon(appIcon());
    createWindow();
    createTray();
    arm();
    powerMonitor.on('resume',()=>{if(!running){arm();publish();}});
  }).catch((error)=>{dialog.showErrorBox('Job Hunter',error.message);app.quit();});
}
