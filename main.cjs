'use strict';

const {app,BrowserWindow,WebContentsView,Tray,Menu,Notification,dialog,ipcMain,session,nativeImage,nativeTheme,safeStorage,clipboard,shell,powerMonitor,utilityProcess}=require('electron');
const {url,fingerprints,profile,MODES,coverageAllows,fresh,expired,localDate,manualJobDetails,careerTerms,fitRadar}=require('./job-model.cjs');
const {readFileSync,writeFileSync,renameSync,existsSync,statSync}=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const JOB_SOURCES=require('./src/sources.js');
const {APPLICATION_STATES,clean,activeApplication,applicationEntry,saveManualApplication,dueSlot,todaySlots,nextScheduledScan,radarPreferences}=require('./src/workflow.js');
const SOURCE_IDS=JOB_SOURCES.filter((source)=>source.searchable!==false).map((source)=>source.id);
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
const blankStatus={lastRun:null,lastSuccess:null,nextRun:null,failures:0,firstFailure:null,persistentAlert:false,lastScheduledSlot:null,scheduledRuns:[],sources:{},sourceIssues:{}};
const initial={demo:true,jobs:[],saved:['demo-1'],applications:{},manualApplications:[],alerts:[],seen:[],dismissed:[],profile,settings:defaultSettings,status:blankStatus,resumePath:'',encryptedKey:''};
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
let importing=false;
let quitting=false;
let timer;
let searchProgress=null;
let radarWorker;
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
    const sourceIds=settings.sourceIds.filter((id)=>SOURCE_IDS.includes(id));
    settings.sourceIds=sourceIds.length || settings.firecrawl?sourceIds:SOURCE_IDS;
    if (!THEMES.includes(settings.theme)) settings.theme='system';
    if (settings.radar) settings.radar=radarPreferences(settings.radar);
    const status={...blankStatus,...stored.status};
    if (!Array.isArray(stored.status?.scheduledRuns)) {
      status.scheduledRuns=[];
      status.lastScheduledSlot=null;
    }
    const manualApplications=Array.isArray(stored.manualApplications)?stored.manualApplications:[];
    return {...initial,...stored,dismissed:Array.isArray(stored.dismissed)?stored.dismissed:[],profile:{...profile,...stored.profile},settings,status,manualApplications};
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
  const dismissed=new Set(data.dismissed);
  return {
    version:app.getVersion(),demo:data.demo,jobs:data.jobs,saved:data.saved,applications:data.applications,alerts:data.alerts,
    manualApplications:data.manualApplications.map((entry)=>manualJobDetails(entry,data.profile)),profile:data.profile,settings:data.settings,
    hiddenJobIds:[...data.dismissed.filter((key)=>key.startsWith('demo-')),
      ...(dismissed.size?data.jobs.filter((job)=>fingerprints(job).some((key)=>dismissed.has(key))).map((job)=>job.id):[])],
    status:{running,lastRun:data.status.lastRun,nextRun:data.status.nextRun,scheduledRuns,sources:data.status.sources,sourceIssues:data.status.sourceIssues,progress:searchProgress}
  };
}

function visibleWindow() {
  return window && !window.isDestroyed() && window.isVisible() && !window.isMinimized();
}

function publish(snapshot) {
  if (visibleWindow()) window.webContents.send('hunter:state',snapshot || state());
}

function commit() {
  save();
  const snapshot=state();
  publish(snapshot);
  if (tray) tray.setToolTip(data.demo?'Job Hunter · Demonstração':running?'Job Hunter · Buscando vagas':'Job Hunter');
  return snapshot;
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

function mergeJobs(result,now=Date.now()) {
  const history=new Set(data.seen);
  const dismissed=new Set(data.dismissed);
  const jobs=[...data.jobs];
  const freshJobs=[];
  const jobKeys=jobs.map(fingerprints);
  const indexes=new Map();
  const discovered=new Set();
  const closedUrls=new Set(result.closedUrls);

  function indexJob(index,keys) {
    for (const key of keys) {
      if (!indexes.has(key)) indexes.set(key,new Set());
      indexes.get(key).add(index);
    }
  }

  jobKeys.forEach((keys,index)=>indexJob(index,keys));
  for (const job of result.jobs) {
    const keys=fingerprints(job);
    if (keys.some((key)=>dismissed.has(key))) continue;
    let existing=jobs.length;
    for (const key of keys) {
      for (const index of indexes.get(key) || []) existing=Math.min(existing,index);
      discovered.add(key);
    }
    if (existing<jobs.length) {
      for (const key of jobKeys[existing]) indexes.get(key).delete(existing);
      jobs[existing]={...job,id:jobs[existing].id};
    } else {
      jobs.push(job);
      if (!keys.some((key)=>history.has(key))) freshJobs.push(job);
    }
    jobKeys[existing]=keys;
    indexJob(existing,keys);
    for (const key of keys) history.add(key);
  }
  data.seen=[...history];
  const saved=new Set(data.saved);
  data.jobs=jobs.flatMap((job,index)=>{
    const closed=closedUrls.has(job.sourceUrl) && !jobKeys[index].some((key)=>discovered.has(key));
    if (!saved.has(job.id) && !activeApplication(data.applications[job.id]) &&
      (closed || !fresh(job.publishedAt,now) || expired(job.validThrough,now))) return [];
    return [closed?{...job,validThrough:new Date(now-1000).toISOString()}:job];
  });
  return freshJobs;
}

function scanInWorker(options,onProgress) {
  return new Promise((resolve,reject)=>{
    const worker=utilityProcess.fork(path.join(__dirname,'scan-worker.cjs'),[],{serviceName:'Job Hunter · Radar'});
    radarWorker=worker;
    const interrupted=()=>reject(new Error('A busca foi interrompida.'));
    worker.once('spawn',()=>worker.postMessage(options));
    worker.on('message',({progress,result,error})=>{
      if (progress) { onProgress(progress); return; }
      if (error) interrupted();
      else resolve(result);
      worker.kill();
    });
    worker.once('error',interrupted);
    worker.once('exit',()=>{
      if (radarWorker===worker) radarWorker=null;
      interrupted();
    });
  });
}

async function run(scheduled=false) {
  if (running || importing || data.demo) return;
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
  const pendingJobs=[];
  let progressTimer;

  function mergePendingJobs() {
    if (!pendingJobs.length) return false;
    const jobs=pendingJobs.splice(0).filter((job)=>coverageAllows(job,data.settings));
    if (!jobs.length) return false;
    for (const job of mergeJobs({jobs,closedUrls:[]})) {
      if (!activeApplication(data.applications[job.id])) discoveredJobs.set(job.id,job);
    }
    return true;
  }

  function showProgress() {
    progressTimer=null;
    if (data.demo || !visibleWindow()) return;
    if (mergePendingJobs()) publish();
    else window.webContents.send('hunter:progress',searchProgress);
  }

  function onProgress(progress) {
    if (data.demo) return;
    searchProgress={checked:progress.checked,queued:progress.queued};
    if (progress.job) pendingJobs.push(progress.job);
    if (!progressTimer && visibleWindow()) progressTimer=setTimeout(showProgress,600);
  }
  const previous=data.jobs.filter((job)=>fresh(job.publishedAt,began) && !expired(job.validThrough,began));
  try { result=await scanInWorker({settings,user,key,previous,now:began},onProgress); }
  catch { result={jobs:[],closedUrls:[],blocked:true,partial:true}; }
  clearTimeout(progressTimer);
  if (quitting) return;
  const stamp=Date.now();
  searchProgress=null;
  const notifications=[];
  if (data.demo) {
    running=false;
    arm();
    commit();
    return;
  }
  mergePendingJobs();
  if (slot) {
    data.status.lastScheduledSlot=slot;
    data.status.scheduledRuns=[{slot,completedAt:stamp,blocked:result.blocked},...data.status.scheduledRuns].slice(0,9);
  }
  data.status.lastRun=stamp;
  data.status.sources=result.sources || {};
  data.status.sourceIssues=result.sourceIssues || {};
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
  window.on('show',()=>publish());
  window.on('restore',()=>publish());
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
  const view=new WebContentsView({webPreferences:{session:getPortalSession(),contextIsolation:true,sandbox:true,nodeIntegration:false}});
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

function getPortalSession() {
  if (!portalSession) {
    portalSession=session.fromPartition('persist:jobhunter-portais');
    portalSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    portalSession.setPermissionCheckHandler(()=>false);
  }
  return portalSession;
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

function manualSite(id) {
  return data.manualApplications.find((entry)=>entry.id===id)?.site;
}

function updateProfile(payload) {
  const name=clean(payload.name,100);
  const course=clean(payload.course,150);
  const graduation=clean(payload.graduation,7);
  if (!name || (graduation && !/^20\d\d-(?:0[1-9]|1[0-2])$/.test(graduation))) throw new Error('Informe o nome e, se for o caso, uma previsão de conclusão válida.');
  if (!Array.isArray(payload.skills)) throw new Error('Lista de competências inválida.');
  data.profile={...data.profile,name,course,graduation,period:clean(payload.period,40),experience:clean(payload.experience,300),
    skills:[...new Set(payload.skills.map((skill)=>clean(skill,80)).filter(Boolean))].slice(0,40)};
  updateRadarMatches();
  return commit();
}

function updateRadarMatches() {
  const {radar}=data.settings;
  if (!radar) return;
  const now=Date.now();
  for (const job of data.jobs) {
    const match=fitRadar(job,data.profile,radar,now);
    job.radarMatch=Boolean(match);
    if (match) Object.assign(job,match);
  }
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

function updateManualApplication(payload) {
  if (payload.portalId && !JOB_SOURCES.some((source)=>source.id===payload.portalId)) throw new Error('Selecione um portal válido.');
  const previous=data.manualApplications;
  data.manualApplications=saveManualApplication(previous,payload);
  try { return commit(); }
  catch (error) {
    data.manualApplications=previous;
    throw error;
  }
}

async function chooseCompanyLogo() {
  const choice=await dialog.showOpenDialog(window,{
    title:'Escolher logo da empresa',properties:['openFile'],filters:[{name:'Imagens PNG ou JPEG',extensions:['png','jpg','jpeg']}]
  });
  const filename=choice.filePaths[0];
  if (choice.canceled || !filename) return {};
  if (statSync(filename).size>10*1024*1024) throw new Error('Escolha uma imagem de até 10 MB.');
  const image=nativeImage.createFromBuffer(readFileSync(filename));
  if (image.isEmpty()) throw new Error('Escolha uma imagem PNG ou JPEG válida.');
  const {width,height}=image.getSize();
  const logo=Math.max(width,height)>128?image.resize(width>=height?{width:128}:{height:128}):image;
  return {logoImage:'data:image/png;base64,'+logo.toPNG().toString('base64')};
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
  updateRadar:(payload)=>{
    const radar=radarPreferences(payload);
    if (!radar.levels.length) throw new Error('Selecione pelo menos um nível de vaga.');
    if (!Array.isArray(payload.modes) || !payload.modes.length || payload.modes.some((mode)=>!MODES.includes(mode))) {
      throw new Error('Selecione pelo menos uma modalidade.');
    }
    if (!careerTerms(radar,data.profile).length) throw new Error('Informe uma área, um cargo ou salve um curso no perfil.');
    if (payload.modes.some((mode)=>mode!=='Remoto') && !radar.locations.length) throw new Error('Informe pelo menos uma localidade presencial ou híbrida.');
    if (payload.modes.includes('Remoto') && !radar.remoteLocations.length) throw new Error('Informe de onde você pode trabalhar remotamente.');
    data.settings={...data.settings,radar,modes:[...new Set(payload.modes)]};
    updateRadarMatches();
    arm();
    return commit();
  },
  dismissJob:({id})=>{
    const job=findJob(id);
    if (!job && !(data.demo && /^demo-[0-4]$/.test(id))) throw new Error('Vaga indisponível.');
    const keys=job?fingerprints(job).filter((key)=>!key.startsWith('role:')):[id];
    data.dismissed=[...new Set([...data.dismissed,...keys])];
    if (job && !data.saved.includes(id) && !activeApplication(data.applications[id])) data.jobs=data.jobs.filter((item)=>item.id!==id);
    return commit();
  },
  importJob:async ({address})=>{
    const importUrl=clean(address,8192);
    if (!url(importUrl)) throw new Error('Cole o link HTTPS de um anúncio.');
    if (running || importing) throw new Error('Aguarde a busca atual terminar.');
    importing=true;
    try {
      const result=await scanInWorker({settings:data.settings,user:data.profile,key:apiKey(),importUrl},()=>{});
      if (result.kind==='filtered') throw new Error('A vaga está fora das preferências do radar.');
      if (result.kind==='closed') throw new Error('A vaga está encerrada ou fora dos últimos 30 dias.');
      if (result.kind!=='verified') throw new Error('Não foi possível confirmar a página original. Cole o link direto da vaga no portal.');
      if (!coverageAllows(result.job,data.settings)) throw new Error('A vaga está fora das preferências do radar.');
      const keys=fingerprints(result.job);
      data.dismissed=data.dismissed.filter((key)=>!keys.includes(key));
      mergeJobs({jobs:[result.job],closedUrls:[]});
      data.demo=false;
      const found=data.jobs.find((job)=>fingerprints(job).some((key)=>keys.includes(key)));
      return {...commit(),importedJobId:found?.id};
    } finally {
      importing=false;
      arm();
      publish();
    }
  },
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
  openManualSite:({id})=>{
    const address=manualSite(id);
    if (!address) throw new Error('Site da vaga não informado.');
    return openBrowser(address);
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
    const address=findJob(id)?.applyUrl || manualSite(id);
    if (!address) throw new Error('Link da vaga indisponível.');
    clipboard.writeText(address);
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
    const manual=data.manualApplications.find((entry)=>entry.id===id);
    if (manual) return updateManualApplication({...manual,status,notes});
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
  saveManualApplication:updateManualApplication,
  chooseCompanyLogo,
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
    const browsing=getPortalSession();
    await browsing.clearStorageData();
    await browsing.clearCache();
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
  app.on('before-quit',()=>{
    quitting=true;
    clearTimeout(timer);
    radarWorker?.kill();
  });
  app.on('window-all-closed',()=>{if(!tray&&process.platform!=='darwin')app.quit();});
  app.whenReady().then(()=>{
    statePath=path.join(app.getPath('userData'),'hunter.json');
    data=readState();
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
