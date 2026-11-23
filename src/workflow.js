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

if (typeof module==='object') module.exports={SCAN_TIMES,APPLICATION_STATES,activeApplication,applicationEntry,todaySlots,dueSlot,nextScheduledScan};
