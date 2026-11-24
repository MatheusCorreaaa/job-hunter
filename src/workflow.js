'use strict';

const SCAN_TIMES=['08:00','16:00','22:00'];
const APPLICATION_STATES=[
  {id:'started',label:'Em preenchimento'},
  {id:'submitted',label:'Enviada'},
  {id:'waiting',label:'Aguardando retorno'},
  {id:'replied',label:'Resposta recebida'},
  {id:'interview',label:'Entrevista'},
  {id:'offer',label:'Proposta'},
  {id:'closed',label:'Encerrada'}
];
const MANUAL_APPLICATION_STATES=APPLICATION_STATES.slice(1);
const JOB_MODES=['Remoto','Híbrido','Presencial'];
const JOB_TYPES=['Estágio','Júnior','Trainee','Jovem aprendiz','Pleno','Sênior','Outro'];

function clean(value,cap) {
  return typeof value==='string' ? value.trim().slice(0,cap) : '';
}

function publicUrl(value,base) {
  try {
    const parsed=new URL(value,base);
    if (parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.port) return null;
    const host=parsed.hostname;
    if (!host.includes('.') || /^(?:\d+\.)+\d+$|:|\.(?:local|internal|localhost|test|invalid|onion)$/.test(host)) return null;
    return parsed;
  } catch { return null; }
}

function activeApplication(entry) {
  if (!entry || entry.active===false) return null;
  if (typeof entry==='string') {
    return {active:true,status:'submitted',notes:'',createdAt:entry,updatedAt:entry,submittedAt:entry};
  }
  return entry;
}

function applicationEntry(previous, changes = {}, now = new Date().toISOString()) {
  const saved=typeof previous==='string' ? activeApplication(previous) : previous;
  return {
    active:true,status:'started',notes:'',createdAt:now,submittedAt:null,...saved,
    ...changes,updatedAt:now
  };
}

function manualDate(value,label) {
  const input=typeof value==='string'?value.trim():'';
  if (!input) return '';
  const date=new Date(input+'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0,10)!==input) throw new Error('Informe uma data de '+label+' válida.');
  return input;
}

function manualLines(value) {
  const lines=Array.isArray(value)?value.join('\n'):value;
  return clean(lines,5000).split(/\r?\n/).map((line)=>line.trim()).filter(Boolean).slice(0,40);
}

function manualLogo(value) {
  const prefix='data:image/png;base64,';
  return typeof value==='string' && value.length<=100000 &&
    value.startsWith(prefix) && /^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(prefix.length))?value:'';
}

function saveManualApplication(entries, payload, now = new Date().toISOString()) {
  const {id,status}=payload;
  if (typeof id!=='string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
    throw new Error('Identificador da candidatura inválido.');
  }
  const company=clean(payload.company,120);
  const title=clean(payload.title,140);
  if (!company || !title) throw new Error('Preencha a empresa e o cargo.');
  if (!MANUAL_APPLICATION_STATES.some((stage)=>stage.id===status)) {
    throw new Error('Selecione uma etapa válida.');
  }
  const appliedOn=manualDate(payload.appliedOn,'envio');
  const publishedOn=manualDate(payload.publishedOn,'publicação');
  const enteredSite=typeof payload.site==='string'?payload.site.trim():'';
  let site='';
  if (enteredSite) {
    const address=/^[a-z][\w+.-]*:/i.test(enteredSite)?enteredSite:'https://'+enteredSite;
    const parsed=publicUrl(address);
    if (!parsed || enteredSite.length>2048 || /[\s\\]/.test(enteredSite)) {
      throw new Error('Informe um endereço válido para o site da vaga, como https://empresa.com/vaga.');
    }
    site=parsed.href;
  }
  const previous=entries.find((entry)=>entry.id===id);
  const entry={
    id,company,title,appliedOn,publishedOn,status,site,
    portalId:clean(payload.portalId,30),logoImage:manualLogo(payload.logoImage),
    mode:JOB_MODES.includes(payload.mode)?payload.mode:'',
    type:JOB_TYPES.includes(payload.type)?payload.type:'',
    location:clean(payload.location,160),description:clean(payload.description,5000),notes:clean(payload.notes,4000),
    required:manualLines(payload.required),preferred:manualLines(payload.preferred),
    createdAt:previous?.createdAt || now,updatedAt:now
  };
  return [entry,...entries.filter((item)=>item.id!==id)];
}

function todaySlots(day) {
  return SCAN_TIMES.map((time)=>Date.parse(day+'T'+time+':00-03:00'));
}

function dueSlot(day, now) {
  return todaySlots(day).findLast((time)=>time<=now) ?? null;
}

function nextScheduledScan(day, now, lastSlot) {
  const slots=todaySlots(day);
  const due=dueSlot(day,now);
  if (due && due>(lastSlot || 0)) return now;
  return slots.find((time)=>time>now) ?? slots[0]+86400000;
}

if (typeof module==='object') module.exports={
  SCAN_TIMES,APPLICATION_STATES,MANUAL_APPLICATION_STATES,JOB_TYPES,JOB_MODES,clean,publicUrl,manualLogo,activeApplication,applicationEntry,saveManualApplication,
  todaySlots,dueSlot,nextScheduledScan
};
