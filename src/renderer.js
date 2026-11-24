'use strict';

const $ = (query) => document.querySelector(query);
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const icon = (name, extra = '') => '<span class="icon ' + extra + '"><img src="assets/icons/' + name + '.svg" alt=""></span>';
const iconButton = (name, label, action, id = '', extra = '') => '<button class="icon-button ' + extra + '" data-action="' + action + '" data-id="' + esc(id) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + icon(name) + '</button>';
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const pageNames = {radar:'Radar de vagas',saved:'Vagas salvas',applications:'Candidaturas',profile:'Meu perfil',sources:'Fontes e contas',settings:'Configurações'};
const sources = JOB_SOURCES;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => state.settings.theme === 'dark' || (state.settings.theme !== 'light' && systemDark.matches);
const sourceFor = (name) => sources.find((source)=>normalize(source.name)===normalize(name));
const sourceImage = (source) => '<span class="source-logo" data-fallback="'+esc(initials(source.name))+'" aria-hidden="true"><img src="assets/sources/'+esc(source.logo)+'" alt=""></span>';

const defaults = {
  demo:true, jobs:[], saved:['demo-1'], applications:{}, manualApplications:[], alerts:[], profile:INITIAL_PROFILE,
  settings:{auto:true, notifications:true, modes:['Remoto','Híbrido','Presencial'], theme:'system', sourceIds:sources.map((source)=>source.id), includeSaoPaulo:true, includeInternational:true, firecrawl:true},
  status:{running:false, lastRun:null, nextRun:null, sources:{}}
};

let state = defaults;
let page = 'radar';
let selected = null;
let applicationView = 'radar';
let selectedManual = null;
let browserJob = null;
let browserManual = false;
let search = '';
let mode = 'Todas';
let locationFilter = 'Todas';
let sort = 'match';
let toastTimer;
const desktop = window.hunter;
const dateLabel = (value) => value ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short',year:'numeric'}).format(new Date(value)) : 'Data indisponível';
const timeLabel = (value) => value ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '';
const ageLabel = (value) => {
  if (!value) return 'Data indisponível';
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000));
  return days === 0 ? 'Hoje' : days === 1 ? 'Há 1 dia' : 'Há ' + days + ' dias';
};
const initials = (name) => name.trim().split(/\s+/).slice(0,2).map((word)=>word[0]?.toUpperCase()).join('') || 'PD';
const allJobs = () => state.demo ? DEMO_JOBS : state.jobs;
const isRecent = (job) => Date.parse(job.publishedAt) >= Date.now() - 30 * 86400000 && (!job.validThrough || Date.parse(job.validThrough) >= Date.now());
const jobRegion = (job) => job.regionKey || (job.manual?'':job.mode==='Remoto'?'br':'rio');
const activeCoverage = (job) => state.settings.modes.includes(job.mode) &&
  (jobRegion(job)!=='sp' || state.settings.includeSaoPaulo!==false) &&
  (jobRegion(job)!=='international' || state.settings.includeInternational!==false);
const trackingFor = (id) => activeApplication(state.applications[id]);
const currentJobs = () => allJobs().filter((job)=>!trackingFor(job.id) && isRecent(job) && (state.demo || activeCoverage(job)));
const stageLabel = (id) => APPLICATION_STATES.find((stage)=>stage.id===id)?.label || 'Em preenchimento';
const scheduleLabel = SCAN_TIMES.map((time)=>time.replace(':00','h')).join(' · ');
const scheduleTime = new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
const listingDate = (job) => Date.parse(job.publishedAt || (job.manual?(job.appliedOn || job.createdAt):'')) || 0;
const updatedTime = (job) => Date.parse(job.manual?job.updatedAt:trackingFor(job.id)?.updatedAt) || 0;
const compareRecent = (a,b) => listingDate(b)-listingDate(a);
const compareMatch = (a,b) => (b.score ?? -1)-(a.score ?? -1) || compareRecent(a,b);
const isSaved = (id) => state.saved.includes(id);
const jobById = (id) => allJobs().find((job) => job.id === id);
const checked = (condition) => condition ? ' checked' : '';

function fallback(action, payload = {}) {
  if (action === 'state') {
    try {
      const stored=JSON.parse(localStorage.getItem('hunter-preview') || '{}');
      return {...defaults,...stored,settings:{...defaults.settings,...stored.settings}};
    }
    catch { return defaults; }
  }
  if (action === 'toggleSaved') state = {...state,saved:isSaved(payload.id) ? state.saved.filter((id)=>id !== payload.id) : [...state.saved,payload.id]};
  if (action === 'updateProfile') state = {...state,profile:{...state.profile,...payload}};
  if (['updateSettings','updateSources','updateTheme'].includes(action)) state = {...state,settings:{...state.settings,...payload}};
  if (['startApplication','markApplied','updateApplication','restoreApplication'].includes(action)) {
    const manual=action==='updateApplication'&&state.manualApplications.find((entry)=>entry.id===payload.id);
    if (manual) {
      state={...state,manualApplications:saveManualApplication(state.manualApplications,{...manual,status:payload.status,notes:payload.notes})};
    } else {
      const old=state.applications[payload.id];
      const changes=action==='restoreApplication'?{active:false}:action==='markApplied'?{active:true,status:'submitted',submittedAt:new Date().toISOString()}:
        action==='updateApplication'?{active:true,status:payload.status,notes:payload.notes}:{active:true};
      state={...state,applications:{...state.applications,[payload.id]:applicationEntry(old,changes)}};
    }
  }
  if (action === 'saveManualApplication') {
    state={...state,manualApplications:saveManualApplication(state.manualApplications,payload)};
  }
  if (action === 'readAlerts') state = {...state,alerts:state.alerts.map((entry)=>({...entry,read:true}))};
  try { localStorage.setItem('hunter-preview',JSON.stringify(state)); } catch {}
  return state;
}

async function request(action, payload) {
  const response = desktop ? await desktop.request(action,payload) : fallback(action,payload);
  if (response?.error) throw new Error(response.error);
  if (response?.jobs) state = response;
  return response;
}

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{toast.hidden=true;},4200);
}

function decorate(root = document) {
  root.querySelectorAll('[data-icon]').forEach((element)=>{
    if (element.firstElementChild) return;
    const image = document.createElement('img');
    image.src = 'assets/icons/' + element.dataset.icon + '.svg';
    image.alt = '';
    element.append(image);
  });
}

function logo(job) {
  const custom=manualLogo(job.logoImage);
  if (custom) return '<span class="company-logo"><img class="custom-company-logo" src="'+esc(custom)+'" alt=""></span>';
  const names = {orbit:'orbit',vertex:'triangle',cloud:'cloud',bridge:'workflow'};
  const content = names[job.logo] ? icon(names[job.logo]) : esc(initials(job.company));
  return '<span class="company-logo ' + (names[job.logo] ? job.logo : '') + '">' + content + '</span>';
}

function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const themeButton = $('#themeToggle');
  const label = dark ? 'Ativar modo claro' : 'Ativar modo escuro';
  themeButton.setAttribute('aria-label',label);
  themeButton.setAttribute('aria-pressed',String(dark));
  themeButton.title = label;
  themeButton.innerHTML = icon(dark?'sun':'moon');
}

systemDark.addEventListener('change',applyTheme);

function chrome() {
  applyTheme();
  const name = state.profile.name;
  $('#appVersion').textContent=state.version?'v'+state.version:'';
  $('#appVersion').hidden=!state.version;
  $('#breadcrumb').textContent = pageNames[page];
  $('#userName').textContent = name;
  $('#initials').textContent = $('#topInitials').textContent = initials(name);
  const tracked=allJobs().filter((job)=>trackingFor(job.id)).length+state.manualApplications.length;
  $('#applicationCount').textContent=tracked;
  $('#applicationCount').hidden=!tracked;
  $('#savedCount').textContent = allJobs().filter((job)=>isSaved(job.id)).length;
  $('#notificationDot').hidden = !state.alerts.some((entry)=>!entry.read);
  $('#modePill').classList.toggle('live',!state.demo && state.settings.auto);
  $('#modePill').lastChild.textContent = state.demo ? 'Demonstração' : state.status.running ? 'Buscando' : state.settings.auto ? 'Radar ativo' : 'Radar pausado';
  $('#monitorTitle').textContent = state.demo ? 'Modo demonstração' : state.status.running ? 'Busca em andamento' : state.settings.auto ? 'Monitoramento ativo' : 'Monitoramento pausado';
  $('#monitorCopy').textContent = state.demo ? 'Explore vagas fictícias' : state.status.running ? (state.status.progress?.queued ? state.status.progress.checked+' / '+state.status.progress.queued+' anúncios checados' : 'Consultando fontes em paralelo') : state.status.nextRun ? 'Próxima busca ' + timeLabel(state.status.nextRun) : 'Busca manual disponível';
  const schedule=$('#dailySchedule');
  if (schedule) schedule.innerHTML=scheduleDetails();
  document.querySelectorAll('.nav').forEach((button)=>{
    button.classList.toggle('active',button.dataset.page===page);
    if (button.dataset.page === page) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
}

function hero() {
  const jobs = currentJobs();
  const stats = [
    ['briefcase-business', state.status.running && !jobs.length ? '—' : jobs.length, 'Vagas no radar', 'Últimos 30 dias'],
    ['sparkles', state.status.running && !jobs.length ? '—' : jobs.filter((job)=>job.score>=85).length, 'Alta aderência', '85% ou mais'],
    ['bookmark', allJobs().filter((job)=>isSaved(job.id)).length, 'Vagas salvas', '']
  ];
  const areas=['Rio de Janeiro',...(state.settings.includeSaoPaulo!==false?['São Paulo híbrido']:[]),...(state.settings.includeInternational!==false?['exterior']:[])];
  const coverage=areas.join(' · ');
  const artwork = '<div class="radar-art" aria-hidden="true"><span style="--d:300px"></span><span style="--d:245px"></span><span style="--d:185px"></span><span style="--d:125px"></span><span style="--d:62px"></span><b style="--x:73%;--y:36%"></b><b style="--x:39%;--y:63%"></b><b style="--x:51%;--y:49%"></b><b style="--x:66%;--y:61%"></b></div>';
  return '<section class="hero">'+artwork+
    '<div class="hero-text"><span class="hero-label">'+icon('radar')+' '+(state.settings.auto?'BUSCA DIÁRIA · '+esc(scheduleLabel)+' BRT':'BUSCA MANUAL')+'</span><h1>Seu radar de vagas</h1><p>Estágios e vagas júnior em tecnologia<br>'+esc(coverage)+' · remoto no Brasil</p></div>'+
    '<div class="hero-action"><button class="button" data-action="'+(state.demo?'enable':'scan')+'" '+(state.status.running?'disabled':'')+'>'+icon(state.demo?'zap':'refresh-cw')+(state.demo?' Ativar busca real':state.status.running?' Buscando…':' Buscar agora')+'</button></div></section>'+
    '<div class="stats">'+stats.map(([symbol,count,label,caption])=>'<article class="stat"><span class="stat-mark">'+icon(symbol)+'</span><div><strong>'+count+'</strong><p>'+label+'</p></div>'+(caption?'<span class="tag stat-side">'+caption+'</span>':'')+'</article>').join('')+'</div>';
}

function title(heading, subtitle) {
  return '<div class="page-title"><h1>'+esc(heading)+'</h1><p>'+esc(subtitle)+'</p></div>';
}

function empty(symbol, heading, copy) {
  return '<div class="empty"><span class="stat-mark">'+icon(symbol)+'</span><h3>'+esc(heading)+'</h3><p>'+esc(copy)+'</p></div>';
}

function options(entries, selectedValue) {
  return entries.map(([value,label])=>'<option value="'+esc(value)+'"'+(value===selectedValue?' selected':'')+'>'+esc(label)+'</option>').join('');
}

const filtersMenu={
  locationFilter:{label:'Localidade',symbol:'map-pin',items:[['Todas','Localidade'],['rio','Rio de Janeiro'],['sp','São Paulo · híbrido'],['br','Brasil · remoto'],['international','Exterior']]},
  sort:{label:'Ordenação',symbol:'arrow-down-up',items:[['match','Melhor aderência'],['recent','Mais recentes']]}
};

function dropdown(name,value,items=filtersMenu[name].items) {
  const {symbol,label}=filtersMenu[name];
  const selectedLabel=items.find(([id])=>id===value)?.[1] || items[0][1];
  return '<div class="dropdown '+(name==='locationFilter'?'location-filter':'')+'" data-dropdown="'+name+'">'+
    '<button type="button" id="'+name+'" class="dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="'+name+'Options" aria-label="'+label+' · '+esc(selectedLabel)+'">'+
    icon(symbol)+'<span class="dropdown-value">'+esc(selectedLabel)+'</span>'+icon('chevron-down')+'</button>'+
    '<div class="dropdown-panel" id="'+name+'Options" role="listbox" aria-label="'+label+'" hidden>'+
    items.map(([option,title])=>'<button type="button" class="dropdown-option" role="option" tabindex="-1" aria-selected="'+(option===value)+'" data-option="'+esc(option)+'">'+esc(title)+(option===value?icon('check'):'')+'</button>').join('')+'</div></div>';
}

function toggleDropdown(menu,open,focusMode) {
  const trigger=menu.querySelector('.dropdown-trigger');
  const choices=menu.querySelector('.dropdown-panel');
  menu.classList.toggle('is-open',open);
  trigger.setAttribute('aria-expanded',String(open));
  choices.hidden=!open;
  if (open) {
    const bounds=menu.getBoundingClientRect();
    const below=window.innerHeight-bounds.bottom-12;
    menu.classList.toggle('opens-up',below<choices.offsetHeight && bounds.top>below);
  }
  if (!open && focusMode) trigger.focus();
  if (open && focusMode) {
    const options=choices.querySelectorAll('.dropdown-option');
    (focusMode==='end'?options[options.length-1]:focusMode==='start'?options[0]:choices.querySelector('[aria-selected="true"]') || options[0])?.focus();
  }
}

function pickDropdown(menu,option) {
  const name=menu.dataset.dropdown;
  if (name==='sort') sort=option.dataset.option;
  else locationFilter=option.dataset.option;
  const label=option.textContent.trim();
  const trigger=menu.querySelector('.dropdown-trigger');
  trigger.querySelector('.dropdown-value').textContent=label;
  trigger.setAttribute('aria-label',filtersMenu[name].label+' · '+label);
  menu.querySelectorAll('.dropdown-option').forEach((item)=>{
    const chosen=item===option;
    item.setAttribute('aria-selected',String(chosen));
    item.querySelector('.icon')?.remove();
    if (chosen) item.insertAdjacentHTML('beforeend',icon('check'));
  });
  toggleDropdown(menu,false,true);
  results();
}

function board() {
  const orders=page==='applications'?[['updated','Última atualização'],...filtersMenu.sort.items]:filtersMenu.sort.items;
  const toolbar = '<div class="result-tools"><label class="search">'+icon('search')+'<input id="search" type="search" aria-label="Buscar na lista" placeholder="Cargo, empresa ou tecnologia" value="'+esc(search)+'"></label>'+
    dropdown('locationFilter',locationFilter)+dropdown('sort',sort,orders)+'</div>'+
    '<div class="filters" aria-label="Modalidade">'+['Todas','Remoto','Híbrido','Presencial','Estágio','Júnior'].map((item)=>'<button class="filter'+(item===mode?' active':'')+'" aria-pressed="'+(item===mode)+'" data-mode="'+item+'">'+item+'</button>').join('')+'</div>';
  return '<div class="grid"><section class="results" aria-label="Lista de vagas"><div class="section-head"><div><h2>'+ (page==='radar'?'Oportunidades':pageNames[page])+'</h2><p id="resultSummary"></p></div></div>'+toolbar+'<div id="jobList"></div></section><section id="jobDetail" aria-label="Detalhes da vaga"></section></div>';
}

function card(job, top) {
  if (job.manual) return manualTrackingCard(job);
  const saved = isSaved(job.id);
  const application=trackingFor(job.id);
  const source=sourceFor(job.channel);
  return '<article class="card'+(job.id===selected?' active':'')+'" tabindex="0" data-job="'+esc(job.id)+'" aria-label="'+esc(job.title)+'">'+logo(job)+
    '<div><div class="card-company">'+esc(job.company)+(top?'<span class="tag">Top '+top+'</span>':'')+
    (application?'<span class="tag stage-tag">'+esc(stageLabel(application.status))+'</span>':'')+'</div><h3>'+esc(job.title)+'</h3>'+
    '<div class="card-meta"><span>'+icon('map-pin')+esc(job.location)+'</span><span>·</span><span>'+esc(job.mode)+'</span><span>·</span><span>'+ageLabel(job.publishedAt)+'</span></div>'+
    '<div class="card-source">'+(source?sourceImage(source):icon('external-link'))+esc(job.channel || 'Site de carreiras')+'</div>'+
    '<div class="card-tags">'+[job.type,...job.skills.slice(0,4)].map((tag)=>'<span class="tag">'+esc(tag)+'</span>').join('')+'</div></div>'+
    '<div class="card-right"><span class="pill score-pill '+(job.score>=85?'green':'')+'">'+job.score+'%</span><div class="card-tools">'+
    iconButton(saved?'bookmark-check':'bookmark',saved?'Remover dos salvos':'Salvar vaga','toggleSaved',job.id,saved?'is-saved':'')+
    (application?'':iconButton('clipboard-check','Marcar candidatura como enviada','markJobApplied',job.id))+'</div></div></article>';
}

function accordion(label, symbol, content, open = false) {
  return '<details'+(open?' open':'')+'><summary>'+icon(symbol)+esc(label)+icon('chevron-down')+'</summary>'+content+'</details>';
}

function requirements(items, fallbackText) {
  return items.length?'<ul>'+items.map((item)=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'<p>'+esc(fallbackText)+'</p>';
}

function applicationPanel(job,application) {
  const stages=job.manual?MANUAL_APPLICATION_STATES:APPLICATION_STATES;
  const edit=job.manual?'editManualEntry':'restoreApplication';
  const label=job.manual?'Editar registro':'Devolver ao radar';
  const date=job.manual?(job.appliedOn?manualSentLabel(job):''):(application.submittedAt?'Envio registrado em '+timeLabel(application.submittedAt):'');
  return '<form class="application-form" id="applicationForm" data-id="'+esc(job.id)+'">'+
    '<div class="application-heading"><h3>Acompanhamento</h3><span class="tag stage-tag">'+esc(stageLabel(application.status))+'</span></div>'+
    '<label>Etapa<select name="status">'+options(stages.map((item)=>[item.id,item.label]),application.status)+'</select></label>'+
    '<label>Notas e respostas<textarea name="notes" maxlength="4000" rows="3" placeholder="Ex.: recebi um e-mail e a entrevista ficou para terça.">'+esc(application.notes)+'</textarea></label>'+
    '<div class="application-actions"><button class="button primary" type="submit">'+icon('check')+' Salvar acompanhamento</button>'+
    '<button class="button secondary" type="button" data-action="'+edit+'" data-id="'+esc(job.id)+'">'+icon(job.manual?'file-text':'arrow-left')+' '+label+'</button></div>'+
    (date?'<small>'+esc(date)+'</small>':'')+'</form>';
}

function applicationTabs() {
  return '<nav class="application-tabs" aria-label="Tipo de candidatura">'+
    [['radar','Vagas do radar','radar'],['manual','Registro manual','clipboard-list']].map(([view,label,symbol])=>
      '<button class="button secondary" type="button" data-application-view="'+view+'" aria-pressed="'+(view===applicationView)+'">'+
      icon(symbol)+esc(label)+'</button>').join('')+'</nav>';
}

function manualSentLabel(entry) {
  return entry.appliedOn?'Enviada em '+dateLabel(entry.appliedOn+'T12:00:00-03:00'):'Data de envio não informada';
}

function jobChannel(job) {
  const source=sourceFor(job.channel) || sources.find((item)=>item.id===job.portalId);
  const label=source?.name || job.channel || publicUrl(job.site)?.hostname;
  return label?(source?sourceImage(source):icon('globe'))+esc(label):'';
}

function detailMetadata(job) {
  const date=job.manual && !job.publishedAt?manualSentLabel(job):dateLabel(job.publishedAt)+(job.dateEstimated?' (aprox.)':'');
  const fields=[[job.location,'map-pin'],[job.mode,'monitor'],[date,'calendar-days']];
  return '<div class="card-meta detail-meta">'+fields.filter(([value])=>value).map(([value,symbol])=>
    '<span>'+icon(symbol)+esc(value)+'</span>').join('')+'</div>';
}

function manualApplicationCard(entry) {
  return '<button class="manual-record" type="button" data-manual-entry="'+esc(entry.id)+'" aria-pressed="'+(selectedManual===entry.id)+'">'+
    logo(entry)+'<span class="manual-record-copy"><strong>'+esc(entry.title)+'</strong><span>'+esc(entry.company)+'</span>'+
    '<small>'+esc(manualSentLabel(entry))+'</small></span><span class="tag stage-tag">'+esc(stageLabel(entry.status))+'</span></button>';
}

function manualTrackingCard(entry) {
  const channel=jobChannel(entry);
  return '<article class="card'+(entry.id===selected?' active':'')+'" tabindex="0" data-job="'+esc(entry.id)+'" aria-label="'+esc(entry.title)+'">'+
    logo(entry)+'<div class="manual-tracking-copy"><div class="card-company">'+esc(entry.company)+'</div>'+
    '<h3>'+esc(entry.title)+'</h3>'+detailMetadata(entry)+(channel?'<div class="card-source">'+channel+'</div>':'')+
    '<div class="card-tags">'+(entry.type?'<span class="tag">'+esc(entry.type)+'</span>':'')+
    '<span class="tag stage-tag">'+esc(stageLabel(entry.status))+'</span></div></div>'+
    (Number.isFinite(entry.score)?'<div class="card-right"><span class="pill score-pill '+(entry.score>=85?'green':'')+'" title="Aderência estimada">'+entry.score+'%</span></div>':'')+
    '</article>';
}

function setManualLogo(form,value) {
  form.elements.logoImage.value=value;
  form.querySelector('#manualLogoPreview').innerHTML=logo({logoImage:value,company:form.elements.company.value || 'Empresa'});
  form.querySelector('[data-action="removeManualLogo"]').hidden=!value;
}

function manualApplicationsPage() {
  const records=state.manualApplications;
  const record=records.find((entry)=>entry.id===selectedManual);
  const value=(field)=>esc(record?.[field] || '');
  const lines=(field)=>esc((record?.[field] || []).join('\n'));
  const portalOptions=[['','Detectar pelo link'],...sources.map(({id,name})=>[id,name])];
  return '<div class="settings-grid manual-applications"><section class="panel">'+
    '<div class="manual-panel-heading"><h2>Candidaturas cadastradas</h2>'+
    '<button class="button secondary" type="button" data-manual-entry="">'+icon('file-text')+' Nova candidatura</button></div>'+
    (records.length?'<div class="manual-list">'+records.map(manualApplicationCard).join('')+'</div>':
      '<p class="manual-empty">Adicione uma vaga para a qual você já enviou currículo.</p>')+'</section>'+
    '<section class="panel"><h2 id="manualFormTitle" tabindex="-1">'+(record?'Editar candidatura':'Nova candidatura')+'</h2>'+
    '<form class="form" id="manualApplicationForm" aria-labelledby="manualFormTitle" data-id="'+value('id')+'">'+
    '<label>Empresa<input name="company" maxlength="120" required value="'+value('company')+'"></label>'+
    '<div class="manual-logo-field"><span id="manualLogoPreview">'+logo({logoImage:record?.logoImage,company:record?.company || 'Empresa'})+'</span>'+
    '<input type="hidden" name="logoImage" value="'+esc(manualLogo(record?.logoImage))+'">'+
    '<button class="button secondary" type="button" data-action="chooseCompanyLogo">'+icon('upload')+' Escolher logo da empresa</button>'+
    '<button class="button secondary" type="button" data-action="removeManualLogo"'+(record?.logoImage?'':' hidden')+'>Remover logo</button></div>'+
    '<label>Cargo<input name="title" maxlength="140" required value="'+value('title')+'"></label>'+
    '<div class="manual-form-row"><label>Tipo de vaga<select name="type">'+options([['','Não informado'],...JOB_TYPES.map((type)=>[type,type])],record?.type || '')+'</select></label>'+
    '<label>Portal de origem<select name="portalId">'+options(portalOptions,record?.portalId || '')+'</select></label></div>'+
    '<label><span>Site da vaga <small>(opcional)</small></span><input name="site" inputmode="url" maxlength="2048" placeholder="https://empresa.com/vaga" value="'+value('site')+'"></label>'+
    '<div class="manual-form-row"><label>Localidade<input name="location" maxlength="160" placeholder="São Paulo, SP" value="'+value('location')+'"></label>'+
    '<label>Modalidade<select name="mode">'+options([['','Não informada'],...JOB_MODES.map((mode)=>[mode,mode])],record?.mode || '')+'</select></label></div>'+
    '<div class="manual-form-row"><label>Data da publicação<input name="publishedOn" type="date" value="'+value('publishedOn')+'"></label>'+
    '<label>Data do envio<input name="appliedOn" type="date" value="'+value('appliedOn')+'"></label></div>'+
    '<label>Requisitos obrigatórios<textarea name="required" maxlength="5000" rows="3" placeholder="Um requisito por linha">'+lines('required')+'</textarea></label>'+
    '<label>Diferenciais<textarea name="preferred" maxlength="5000" rows="3" placeholder="Um diferencial por linha">'+lines('preferred')+'</textarea></label>'+
    '<label>Descrição da vaga<textarea name="description" maxlength="5000" rows="4" placeholder="Atividades e detalhes do anúncio">'+value('description')+'</textarea></label>'+
    '<label>Etapa<select name="status">'+options(MANUAL_APPLICATION_STATES.map(({id,label})=>[id,label]),record?.status || 'submitted')+'</select></label>'+
    '<label>Notas e respostas<textarea name="notes" maxlength="4000" rows="3" placeholder="Ex.: enviei pelo site da empresa e estou aguardando retorno">'+value('notes')+'</textarea></label>'+
    '<button class="button primary" type="submit">'+icon('check')+' '+(record?'Salvar alterações':'Salvar candidatura')+'</button></form></section></div>';
}

function matchPanel(job) {
  const scored=Number.isFinite(job.score);
  const title=job.manual && scored?'Aderência estimada ao seu perfil':'Aderência ao seu perfil';
  const reason=job.reason || 'A estimativa depende do cargo, do tipo de vaga e dos requisitos ou da descrição.';
  return '<div class="match'+(scored?'':' match-unscored')+'">'+
    (scored?'<div class="gauge" style="--score:'+job.score+'" aria-label="'+job.score+' por cento"><strong>'+job.score+'<sup>%</sup></strong></div>':'')+
    '<div><div class="match-title">'+icon('sparkles')+' '+title+'</div><p>'+esc(reason)+'</p></div></div>';
}

function applicationLink(job,application) {
  if (job.manual && !job.site) return '<div class="detail-foot"><small>Site da vaga não informado.</small></div>';
  const action=job.manual?'openManualSite':'apply';
  const caption=job.manual?esc(job.site):job.demo?'Exemplo ilustrativo':'Formulário do portal dentro do Job Hunter';
  return '<div class="detail-foot"><button class="button primary" data-action="'+action+'" data-id="'+esc(job.id)+'">'+
    icon('external-link')+' '+(application?'Reabrir candidatura':'Abrir candidatura')+'</button>'+
    '<small'+(job.manual?' class="manual-site"':'')+'>'+caption+'</small></div>';
}

function details(job) {
  if (!job) return empty('panel-right','Detalhes da vaga','Selecione uma oportunidade para ver a análise do perfil.');
  const saved = isSaved(job.id);
  const channel=jobChannel(job);
  const expired=!job.manual && !isRecent(job);
  const application=job.manual?job:trackingFor(job.id);
  const badge=job.manual?'<span class="pill">'+icon('clipboard-list')+' Registro manual</span>':
    '<span class="pill '+(job.demo || expired?'amber':'green')+'">'+icon(job.demo?'flask-conical':expired?'clock-3':'badge-check')+
    (job.demo?' Vaga de exemplo':expired?' Fora do período de busca':' Verificada na fonte')+'</span>';
  const actions=job.manual?(job.site?iconButton('copy','Copiar link da vaga','copy',job.id):''):
    iconButton(saved?'bookmark-check':'bookmark',saved?'Remover dos salvos':'Salvar vaga','toggleSaved',job.id,saved?'is-saved':'')+
    (job.demo?'':iconButton('file-text','Abrir anúncio original','original',job.id)+iconButton('copy','Copiar link direto','copy',job.id))+
    (application?'':iconButton('clipboard-check','Marcar candidatura como enviada','markJobApplied',job.id));
  const description=job.description || (job.manual?'Descrição não informada.':'Consulte o anúncio original para ler a descrição completa.');
  return '<article class="detail'+(job.manual?' manual-detail':'')+'"><div class="detail-top"><div class="detail-bar">'+badge+
    '<div class="detail-actions">'+actions+'</div></div><div class="detail-company">'+logo(job)+esc(job.company)+
    (channel?'<span class="detail-source">'+channel+'</span>':'')+'</div>'+
    '<h2'+(job.manual?' id="manualDetailTitle" tabindex="-1"':'')+'>'+esc(job.title)+'</h2>'+detailMetadata(job)+
    (job.manual && job.type?'<div class="card-tags"><span class="tag">'+esc(job.type)+'</span></div>':'')+'</div>'+
    '<div class="detail-body">'+matchPanel(job)+applicationLink(job,application)+
    (application && page==='applications'?applicationPanel(job,application):'')+
    accordion('Requisitos obrigatórios','list-checks',requirements(job.required || [],job.manual?'Nenhum requisito obrigatório informado.':'A página não informou requisitos obrigatórios de forma estruturada.'),true)+
    accordion('Diferenciais','sparkles',requirements(job.preferred || [],job.manual?'Nenhum diferencial informado.':'A página não informou diferenciais.'))+
    (job.workEligibility?.length?accordion('Autorização de trabalho','globe',requirements(job.workEligibility,'')):'')+
    accordion('Sobre a vaga','file-text','<p'+(job.manual?' class="manual-description"':'')+'>'+esc(description)+'</p>'+
    (job.validThrough?'<p>Prazo de candidatura '+dateLabel(job.validThrough)+'</p>':'')+(job.verifiedAt?'<p>Verificada em '+timeLabel(job.verifiedAt)+'</p>':''))+
    '</div></article>';
}

function results() {
  const base = page==='saved' ? allJobs().filter((job)=>isSaved(job.id)) :
    page==='applications' ? [...allJobs().filter((job)=>trackingFor(job.id)),...state.manualApplications.map((entry)=>({...entry,manual:true}))] : currentJobs();
  const scores = page==='radar'?[...base].sort(compareMatch).slice(0,3):[];
  const query = normalize(search.trim());
  const jobs = base.filter((job)=>
    (!query || normalize([job.title,job.company,job.location,job.channel,job.site,...(job.skills || [])].join(' ')).includes(query)) &&
    (mode==='Todas' || mode===job.mode || mode===job.type) &&
    (locationFilter==='Todas' || locationFilter===jobRegion(job))
  ).sort((a,b)=>sort==='updated' ? updatedTime(b)-updatedTime(a) :
    sort==='recent' ? compareRecent(a,b) : compareMatch(a,b));
  const displayed=jobs.find((job)=>job.id===selected) || jobs[0];
  selected=displayed?.id ?? null;
  const sample=state.demo && (page!=='applications' || base.every((job)=>job.demo));
  $('#resultSummary').textContent = state.status.running && !base.length && page==='radar' ? 'Busca em andamento' : jobs.length+' '+(jobs.length===1?'vaga':'vagas')+(sample?' de exemplo':'')+' · '+(sort==='updated'?'última atualização':sort==='recent'?'mais recentes':'melhor aderência');
  $('#jobList').innerHTML = jobs.length ? jobs.map((job)=>card(job,page==='radar'?scores.findIndex((item)=>item.id===job.id)+1:0)).join('') :
    empty('search',state.status.running && !base.length && page==='radar'?'Consultando anúncios':base.length?'Nenhum resultado com esses filtros':page==='saved'?'Sua lista está vazia':page==='applications'?'Nenhuma candidatura registrada':'Seu radar ainda está vazio',
      state.status.running && !base.length && page==='radar'?'Verificando data, requisitos e candidatura na fonte.':base.length?'Ajuste a modalidade, a localidade ou o termo de busca.':page==='saved'?'Use o marcador para salvar uma vaga.':page==='applications'?'Abra uma vaga para acompanhar o preenchimento, ou marque uma candidatura que já enviou.':'Vagas verificadas aparecem aqui quando a busca encontra novas correspondências.');
  $('#jobDetail').innerHTML = details(displayed);
}

function profilePage() {
  const profile=state.profile;
  return title('Meu perfil','Atualize os dados usados para calcular a aderência das vagas.')+
    '<div class="settings-grid"><section class="panel"><h2>Formação e experiência</h2><form id="profileForm" class="form">'+
    '<label>Nome<input name="name" required maxlength="100" value="'+esc(profile.name)+'"></label>'+
    '<label>Curso<input name="course" required maxlength="150" value="'+esc(profile.course)+'"></label>'+
    '<label>Período<input name="period" maxlength="40" value="'+esc(profile.period)+'"></label>'+
    '<label>Previsão de conclusão<input name="graduation" required type="month" value="'+esc(profile.graduation)+'"></label>'+
    '<label>Experiência<input name="experience" maxlength="300" value="'+esc(profile.experience)+'"></label>'+
    '<label>Competências, separadas por vírgula<textarea name="skills" maxlength="1500">'+esc(profile.skills.join(', '))+'</textarea></label>'+
    '<button class="button primary" type="submit">'+icon('check')+' Salvar perfil</button></form></section>'+
    '<section class="panel"><span class="stat-mark">'+icon('file-text')+'</span><h2>Currículo em PDF</h2><p>Selecione o arquivo para localizar e anexar seu currículo manualmente ao preencher uma candidatura.</p><p><strong>'+esc(profile.resumeName || 'Nenhum arquivo selecionado')+'</strong></p><button class="button secondary" data-action="resume">'+icon('upload')+' Selecionar PDF</button>'+
    (profile.resumeName?' <button class="button secondary" data-action="removeResume">Remover PDF</button>':'')+'</section></div>';
}

function sourceStatus(key) {
  const lastResult=state.status.sources?.[key];
  const statuses={ok:['Consultada','green'],partial:['Consulta parcial','amber'],error:['Indisponível na última busca','amber'],limited:['Limite temporário','amber']};
  const entry=statuses[lastResult];
  if (!entry) return '';
  const messages={
    'http-401':'A fonte exige autenticação (HTTP 401).',
    'http-402':'A fonte exige créditos (HTTP 402).',
    'http-403':'A fonte recusou a consulta automática (HTTP 403).',
    'http-404':'Endereço da pesquisa não encontrado (HTTP 404).',
    'http-429':'A fonte limitou as requisições (HTTP 429).',
    timeout:'A consulta excedeu o tempo de espera.',
    network:'Falha na conexão ou na resposta da fonte.',
    format:'A fonte não apresentou uma lista pública reconhecível.',
    unverified:'As páginas dos anúncios não puderam ser verificadas.'
  };
  const issues=state.status.sourceIssues?.[key] || [];
  const reasons=issues.map((issue)=>messages[issue] || (issue.startsWith('http-')?'Resposta HTTP '+issue.slice(5)+'.':''));
  return '<span class="source-status"><span class="pill '+entry[1]+'">'+entry[0]+'</span>'+
    (reasons.length?'<small>'+reasons.map(esc).join(' ')+'</small>':'')+'</span>';
}

function sourcesPage() {
  const enabled=state.settings.sourceIds || defaults.settings.sourceIds;
  return title('Fontes e contas','Escolha onde o radar busca vagas e abra os portais para se candidatar.')+
    '<div class="settings-grid sources-grid"><section class="panel"><h2>Busca de vagas</h2>'+
    '<form class="form" id="sourcesForm"><div class="firecrawl-source"><span class="stat-mark">'+icon('globe')+'</span><div>'+
    '<label class="check"><input type="checkbox" name="firecrawl"'+checked(state.settings.firecrawl)+'> Firecrawl automático</label>'+
    '<p>Pesquisa pública sem chave de API, sujeita ao limite do serviço.</p>'+sourceStatus('firecrawl')+'</div></div>'+
    '<fieldset class="source-options"><legend>Portais pesquisados</legend><p class="portal-count">'+sources.filter((source)=>enabled.includes(source.id)).length+' de '+sources.length+' portais ativos</p>'+
    sources.map((source)=>'<div class="source-row"><label class="source-check"><input type="checkbox" name="source" value="'+source.id+'"'+checked(enabled.includes(source.id))+'>'+sourceImage(source)+'<span>'+esc(source.name)+'</span></label>'+sourceStatus(source.id)+'</div>').join('')+
    '</fieldset><button type="submit" class="button primary">'+icon('check')+' Salvar fontes</button></form></section>'+
    '<section class="panel"><h2>Portais de candidatura</h2><p>Abra um portal para entrar na sua conta e preencher os formulários disponíveis.</p>'+
    sources.map((source)=>'<div class="source-row">'+sourceImage(source)+'<div><strong>'+esc(source.name)+'</strong><p>'+esc(source.description)+'</p></div><button class="button secondary" data-action="portal" data-id="'+source.id+'" aria-label="Abrir '+esc(source.name)+'">Abrir</button></div>').join('')+
    '<hr><button class="button secondary" data-action="clearSessions">'+icon('log-out')+' Encerrar sessões locais</button></section></div>';
}

function scheduleDetails() {
  const active=!state.demo && state.settings.auto;
  const slots=state.status.scheduledRuns || [];
  const now=Date.now();
  const latestDue=slots.findLast(({slot})=>slot<=now)?.slot;
  const entries=SCAN_TIMES.map((time,index)=>{
    const {slot,run}=slots[index] || {};
    const status=run?(run.blocked?'Consulta indisponível':'Executada às '+scheduleTime.format(run.completedAt)):
      state.demo?'Demonstração':!active?'Pausada':slot<latestDue?'Não executada':'Aguardando';
    return '<li><time>'+time+'</time><span class="pill '+(run?.blocked?'amber':run?'green':'')+'">'+esc(status)+'</span></li>';
  });
  const next=active && state.status.nextRun?'Próxima busca '+timeLabel(state.status.nextRun)+' (Brasília)':'';
  return '<strong>Horários de Brasília</strong><ul>'+entries.join('')+'</ul>'+(next?'<small>'+esc(next)+'</small>':'');
}

function settingsPage() {
  return title('Configurações','Defina quando o radar roda e quais modalidades entram na busca.')+
    '<div class="settings-grid"><section class="panel"><h2>Busca diária</h2><form class="form" id="settingsForm">'+
    '<label class="check"><input type="checkbox" name="auto"'+checked(state.settings.auto)+'> Executar diariamente com o Job Hunter aberto</label>'+
    '<div class="schedule-box" id="dailySchedule">'+scheduleDetails()+'</div>'+
    '<p>O radar continua rodando com a janela fechada enquanto o ícone estiver na bandeja do sistema.</p>'+
    '<label class="check"><input type="checkbox" name="notifications"'+checked(state.settings.notifications)+'> Notificações do sistema para novas vagas</label>'+
    '<hr><h2>Modalidades</h2><div class="checks">'+['Remoto','Híbrido','Presencial'].map((item)=>'<label><input type="checkbox" name="mode" value="'+item+'"'+checked(state.settings.modes.includes(item))+'> '+item+'</label>').join('')+'</div>'+
    '<fieldset class="source-options"><legend>Localidades</legend><p>Rio de Janeiro/RJ para presencial e híbrido. Remoto precisa aceitar candidatos no Brasil.</p>'+
    '<label class="check"><input type="checkbox" name="includeSaoPaulo"'+checked(state.settings.includeSaoPaulo!==false)+'> São Paulo capital · híbrido</label>'+
    '<label class="check"><input type="checkbox" name="includeInternational"'+checked(state.settings.includeInternational!==false)+'> Exterior · modalidades selecionadas</label></fieldset>'+
    '<p>Publicações dos últimos 30 dias.</p>'+
    '<button class="button primary" type="submit">'+icon('check')+' Salvar preferências</button></form></section>'+
    '<div><section class="panel"><h2>Aparência</h2><label>Tema do aplicativo<select id="appearanceTheme" aria-label="Tema do aplicativo">'+
    options([['system','Seguir o sistema'],['light','Claro'],['dark','Escuro']],state.settings.theme || 'system')+'</select></label></section>'+
    '<section class="panel"><h2>Monitoramento</h2><p>'+(state.status.lastRun?'Última execução '+timeLabel(state.status.lastRun):'A busca será registrada aqui após a primeira execução.')+'</p>'+
    (state.status.nextRun?'<p>Próxima execução '+timeLabel(state.status.nextRun)+'</p>':'')+
    '<button class="button secondary" data-action="'+(state.demo?'enable':'demo')+'">'+icon(state.demo?'zap':'flask-conical')+' '+(state.demo?'Ativar busca real':'Abrir demonstração')+'</button></section></div></div>';
}

function render() {
  chrome();
  const content = $('#content');
  if (page==='applications') {
    const manual=applicationView==='manual';
    content.innerHTML=title('Candidaturas','Acompanhe suas vagas e registre currículos enviados antes de usar o Job Hunter.')+
      applicationTabs()+(manual?manualApplicationsPage():board());
    if (!manual) results();
    return;
  }
  if (page==='radar' || page==='saved') {
    content.innerHTML=(page==='radar'?hero():title(pageNames[page],'Oportunidades que você quer revisar.'))+board();
    results();
  } else content.innerHTML={profile:profilePage,sources:sourcesPage,settings:settingsPage}[page]();
}

function navigate(nextPage,id=null) {
  if (!pageNames[nextPage]) return;
  page=nextPage;
  if (nextPage==='applications' && id) applicationView='radar';
  selected=id;
  sort=nextPage==='applications'?'updated':'match';
  search='';
  mode='Todas';
  locationFilter='Todas';
  $('.sidebar').classList.remove('open');
  render();
  window.scrollTo(0,0);
}

function modal(heading, body) {
  $('#dialogBody').innerHTML='<div class="dialog-head"><h2>'+esc(heading)+'</h2>'+iconButton('x','Fechar','closeDialog')+'</div>'+body;
  if (!$('#dialog').open) $('#dialog').showModal();
}

function desktopRequired() {
  modal('Abra no aplicativo desktop','<p>Este recurso funciona na versão instalada do Job Hunter. Você pode explorar os filtros, a análise de aderência e a etapa de candidatura nesta demonstração.</p>');
}

function showBrowser(data) {
  $('#browserBar').hidden=!data.open;
  $('#app').hidden=data.open;
  let address='';
  try { const parsed=new URL(data.url); address=parsed.hostname+parsed.pathname; } catch {}
  $('#browserAddress').textContent=address || 'Carregando…';
  $('#browserError').hidden=!data.open || !data.failed;
  $('#browserBack').disabled=!data.canGoBack;
  $('#browserReturnLabel').textContent=browserJob || browserManual?'Voltar a Candidaturas':'Voltar ao Job Hunter';
  $('#markApplied').hidden=!browserJob || data.failed || data.loading || !!trackingFor(browserJob)?.submittedAt;
  $('#resumeFolder').hidden=data.failed || !state.profile.resumeName;
  if (!data.open) {
    browserJob=null;
    browserManual=false;
  }
}

async function action(name, id) {
  const job=jobById(id);
  if (name==='theme') {
    await request('updateTheme',{theme:isDark()?'light':'dark'});
    applyTheme();
    if (page==='settings') $('#appearanceTheme').value=state.settings.theme;
    return;
  }
  if (name==='closeDialog') { $('#dialog').close(); return; }
  if (name==='alertJob') { $('#dialog').close(); jumpJob(id); return; }
  if (name==='editManualEntry') {
    selectedManual=id;
    applicationView='manual';
    render();
    $('#manualFormTitle')?.focus();
    return;
  }
  if (name==='removeManualLogo') {
    const form=$('#manualApplicationForm');
    if (form) setManualLogo(form,'');
    return;
  }
  if (name==='toggleSaved' && job) {
    await request(name,{id});
    render();
    notify(isSaved(id)?'Vaga salva':'Vaga removida dos salvos');
    return;
  }
  if (name==='markJobApplied' && job) {
    await request('markApplied',{id});
    navigate('applications',id);
    notify('Candidatura marcada como enviada');
    return;
  }
  if (name==='restoreApplication' && job) {
    await request('restoreApplication',{id});
    navigate('radar',id);
    notify(currentJobs().some((item)=>item.id===id)?'Vaga devolvida ao radar':'Vaga retirada de Candidaturas');
    return;
  }
  if (name==='apply' && job?.demo) {
    await request('startApplication',{id});
    navigate('applications',id);
    notify('Candidatura de exemplo iniciada');
    return;
  }
  if (!desktop) { desktopRequired(); return; }
  if (name==='chooseCompanyLogo') {
    const form=$('#manualApplicationForm');
    if (!form) return;
    const result=await request(name);
    if (form.isConnected && result.logoImage) setManualLogo(form,result.logoImage);
    return;
  }
  if (name==='openManualSite') {
    browserManual=true;
    try { await request('openManualSite',{id}); }
    catch (error) { browserManual=false; throw error; }
    return;
  }
  if (name==='enable' || name==='demo' || name==='scan') {
    await request(name);
    navigate('radar');
  }
  if (name==='portal' || (['apply','original'].includes(name) && job)) {
    browserJob=job?.id ?? null;
    try {
      await request('openBrowser',{id:job?.id,original:name==='original',portal:name==='portal'?id:null});
      if (job) {
        await request('state');
        navigate('applications',job.id);
      }
    } catch (error) {
      browserJob=null;
      throw error;
    }
  }
  if (name==='copy' && (job || state.manualApplications.some((entry)=>entry.id===id))) {
    await request('copyLink',{id});
    notify('Link da vaga copiado');
  }
  if (name==='resume' || name==='removeResume') {
    await request(name);
    render();
  }
  if (name==='clearSessions') {
    modal('Encerrar sessões locais','<p>Você precisará entrar de novo nos portais. Vagas salvas e candidaturas registradas ficam no aplicativo.</p><p><button class="button primary" data-action="confirmClear">Encerrar sessões</button></p>');
  }
  if (name==='confirmClear') {
    await request('clearSessions');
    $('#dialog').close();
    notify('Sessões locais encerradas');
  }
}

function jumpJob(id) {
  navigate(trackingFor(id)?'applications':'radar',id);
  if (jobById(id)) chooseJob(id);
}

function chooseJob(id) {
  if (id===selected && window.innerWidth>760) return;
  selected=id;
  results();
  if (window.innerWidth<=760) $('#jobDetail').scrollIntoView({block:'start'});
}

document.addEventListener('click',(event)=>{
  const openMenu=document.querySelector('.dropdown.is-open');
  const menu=event.target.closest('.dropdown');
  if (openMenu && openMenu!==menu) toggleDropdown(openMenu,false);
  const option=event.target.closest('.dropdown-option');
  if (option) { pickDropdown(menu,option); return; }
  if (event.target.closest('.dropdown-trigger')) {
    toggleDropdown(menu,!menu.classList.contains('is-open'),'selected');
    return;
  }
  const button=event.target.closest('button[data-action]');
  if (button) { action(button.dataset.action,button.dataset.id).catch((error)=>notify(error.message)); return; }
  const nav=event.target.closest('[data-page], .brand');
  if (nav) { event.preventDefault(); navigate(nav.dataset.page || 'radar'); return; }
  const view=event.target.closest('[data-application-view]');
  if (view) {
    if (view.dataset.applicationView===applicationView) return;
    applicationView=view.dataset.applicationView;
    render();
    document.querySelector('[data-application-view][aria-pressed="true"]')?.focus();
    return;
  }
  const entry=event.target.closest('[data-manual-entry]');
  if (entry) {
    selectedManual=entry.dataset.manualEntry || null;
    render();
    $(selectedManual?'#manualFormTitle':'#manualApplicationForm [name="company"]')?.focus();
    return;
  }
  const filter=event.target.closest('[data-mode]');
  if (filter) {
    mode=filter.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((item)=>{
      item.classList.toggle('active',item.dataset.mode===mode);
      item.setAttribute('aria-pressed',String(item.dataset.mode===mode));
    });
    results();
  }
  const cardElement=event.target.closest('[data-job]');
  if (cardElement) chooseJob(cardElement.dataset.job);
});

document.addEventListener('keydown',(event)=>{
  const menu=event.target.closest('.dropdown');
  if (menu) {
    const isOpen=menu.classList.contains('is-open');
    if (isOpen && ['Escape','Tab'].includes(event.key)) {
      toggleDropdown(menu,false,true);
      if (event.key==='Escape') event.preventDefault();
      return;
    }
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const move=event.key==='ArrowUp'?-1:1;
      if (!isOpen) { toggleDropdown(menu,true,event.key==='End'?'end':event.key==='Home'?'start':'selected'); return; }
      const choices=[...menu.querySelectorAll('.dropdown-option')];
      const current=choices.indexOf(document.activeElement);
      const index=event.key==='Home'?0:event.key==='End'?choices.length-1:(current+move+choices.length)%choices.length;
      choices[index]?.focus();
      return;
    }
  }
  if (['Enter',' '].includes(event.key) && event.target.matches('[data-job]')) {
    event.preventDefault();
    chooseJob(event.target.dataset.job);
    document.querySelector('[data-job="'+CSS.escape(selected)+'"]')?.focus();
  }
});

$('#content').addEventListener('input',(event)=>{
  if (event.target.id==='search') { search=event.target.value; results(); }
});
$('#content').addEventListener('change',(event)=>{
  if (event.target.id==='appearanceTheme') {
    request('updateTheme',{theme:event.target.value}).then(applyTheme).catch((error)=>notify(error.message));
  }
});
$('#content').addEventListener('submit',async (event)=>{
  event.preventDefault();
  const form=event.target;
  const data=new FormData(form);
  try {
    if (form.id==='manualApplicationForm') {
      const submit=form.querySelector('[type="submit"]');
      if (submit.disabled) return;
      const id=form.dataset.id || crypto.randomUUID();
      form.dataset.id=id;
      submit.disabled=true;
      try {
        await request('saveManualApplication',{...Object.fromEntries(data),id});
        if (form.isConnected) {
          selectedManual=id;
          navigate('applications',id);
          $('#manualDetailTitle')?.focus({preventScroll:true});
        }
        notify('Candidatura manual salva');
      } finally {
        submit.disabled=false;
      }
      return;
    }
    if (form.id==='profileForm') {
      await request('updateProfile',{...Object.fromEntries(data),skills:data.get('skills').split(',').map((skill)=>skill.trim()).filter(Boolean)});
    }
    if (form.id==='settingsForm') {
      if (!data.getAll('mode').length) { notify('Escolha pelo menos uma modalidade.'); return; }
      await request('updateSettings',{auto:data.has('auto'),notifications:data.has('notifications'),modes:data.getAll('mode'),includeSaoPaulo:data.has('includeSaoPaulo'),includeInternational:data.has('includeInternational')});
    }
    if (form.id==='applicationForm') {
      await request('updateApplication',{id:form.dataset.id,status:data.get('status'),notes:data.get('notes')});
      render();
      notify('Acompanhamento salvo');
      return;
    }
    if (form.id==='sourcesForm') {
      if (!desktop) { desktopRequired(); return; }
      const sourceIds=data.getAll('source');
      if (!sourceIds.length && !data.has('firecrawl')) { notify('Mantenha pelo menos uma fonte.'); return; }
      await request('updateSources',{sourceIds,firecrawl:data.has('firecrawl')});
    }
    render();
    notify('Alterações salvas');
  } catch (error) { notify(error.message); }
});

$('#menuToggle').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));
$('#notifications').addEventListener('click',async ()=>{
  const alerts=state.alerts;
  modal('Notificações',alerts.length?alerts.slice(0,20).map((entry)=>'<div class="alert-entry"><p><strong>'+esc(entry.title)+'</strong> · '+timeLabel(entry.at)+'</p>'+(entry.type==='jobs'?entry.ids.slice(0,3).map(jobById).filter(Boolean).map((job)=>'<button class="button secondary" data-action="alertJob" data-id="'+esc(job.id)+'">'+esc(job.title)+'</button>').join(''):'')+'<p>'+esc(entry.copy)+'</p></div>').join(''):'<p>Nenhuma notificação por enquanto.</p>');
  try { await request('readAlerts'); chrome(); } catch(error) { notify(error.message); }
});
$('#closeBrowser').addEventListener('click',()=>request('closeBrowser').then(showBrowser).catch((error)=>notify(error.message)));
$('#browserBack').addEventListener('click',()=>request('browserBack').catch((error)=>notify(error.message)));
for (const selector of ['#browserReload','#retryBrowser']) $(selector).addEventListener('click',()=>request('browserReload').catch((error)=>notify(error.message)));
$('#resumeFolder').addEventListener('click',()=>request('showResume').catch((error)=>notify(error.message)));
$('#markApplied').addEventListener('click',async ()=>{
  if (!browserJob) return;
  try {
    await request('markApplied',{id:browserJob});
    $('#markApplied').hidden=true;
    notify('Candidatura registrada no histórico');
  } catch (error) { notify(error.message); }
});

decorate();
document.addEventListener('error',(event)=>{
  if (event.target instanceof HTMLImageElement && event.target.parentElement?.matches('.source-logo')) event.target.remove();
},true);
desktop?.onState((updated)=>{
  state=updated;
  if (page==='applications' && applicationView==='manual') {
    chrome();
    return;
  }
  if (['radar','applications','saved'].includes(page) && !document.activeElement?.matches('input,textarea,select') && !$('.dropdown.is-open')) render();
  else if (page==='sources' && !$('#sourcesForm')?.contains(document.activeElement)) render();
  else chrome();
});
desktop?.onBrowser(showBrowser);
desktop?.onRoute(navigate);
request('state').then(render).catch((error)=>{render();notify(error.message);});
