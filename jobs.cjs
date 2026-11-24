'use strict';

const {createHash} = require('node:crypto');
const {load} = require('cheerio');
const {decodeHTML} = require('entities');
const {
  DAY,profile,MODES,url,text,norm,full,fresh,expired,canonical,senior,junior,internship,relevant,excluded,
  skills,gupyHost,fit,sourceForUrl,manualJobDetails,fingerprints,localDate,nextDaily
}=require('./job-model.cjs');
const JOB_SOURCES=require('./src/sources.js');
const {place,coverageAllows,authorizationNotes} = require('./geography.cjs');
const {fetch: httpFetch,EnvHttpProxyAgent} = require('undici');
const {getCACertificates,setDefaultCACertificates} = require('node:tls');

let publicDispatcher;
function publicFetch(address, options) {
  if (!publicDispatcher) {
    if (getCACertificates && setDefaultCACertificates) {
      setDefaultCACertificates([...new Set([...getCACertificates('default'),...getCACertificates('system')])]);
    }
    publicDispatcher=new EnvHttpProxyAgent();
  }
  return httpFetch(address,{...options,dispatcher:publicDispatcher});
}
const closed = /(?:vaga (?:encerrada|expirada|indisponivel|fechada|preenchida)|inscricoes (?:encerradas|finalizadas)|candidaturas (?:encerradas|finalizadas)|job (?:is )?no longer (?:available|accepting)|applications (?:are )?closed|this job has expired|no longer accepting applications|vaga nao encontrada|nao aceita mais candidaturas|nao esta mais aceitando candidaturas|job not found)/;
const optional = /(?:^|\b)(?:diferencia(?:l|is)|desejave(?:l|is)|nice to have|preferred|bonus points|sera um plus|pontos extras|nao obrigatorio)(?:\b|$)/;
const requirementHeading = /^(?:requisitos(?: e qualificacoes| necessarios| obrigatorios)?|formacao e experiencias desejaveis|qualificacoes|qualifications|requirements(?: and qualifications)?|minimum qualifications|what we (?:require|are looking for|expect)|your (?:skills|profile)|perfil pretendido|o que (?:voce precisa|buscamos|esperamos)|necessario|what you(?:'ll)? need|o que esperamos de voce)(?:\s*:|\s*$)/;
const neutralHeading = /^(?:responsabilidades|atividades|atribuicoes|beneficios|informacoes adicionais|etapas do processo|sobre |descricao|responsibilities|what you.ll do|additional information|about |benefits)(?:\b|$)/;
function postingUrl(address, id) {
  const parsed = url(address);
  if (!parsed) return '';
  if (gupyHost(parsed.hostname) && /^\d+$/.test(String(id ?? ''))) return parsed.origin+'/jobs/'+id;
  return canonical(parsed.href);
}

function array(value) { return Array.isArray(value) ? value : value ? [value] : []; }

function findPosting(object) {
  if (Array.isArray(object)) return object.map(findPosting).find(Boolean);
  if (object && typeof object==='object') {
    if (array(object['@type']).some((item)=>norm(item)==='jobposting')) return object;
    return findPosting(object['@graph']);
  }
  return undefined;
}

function structured($) {
  const values = [...$('script[type="application/ld+json"]').map((_,element)=>$(element).html()).get(),
    ...$('meta[itemprop],meta[name],meta[property]').map((_,element)=>{
      const name=$(element).attr('itemprop') || $(element).attr('name') || $(element).attr('property') || '';
      const content=$(element).attr('content') || '';
      return /json|job/i.test(name) || content.includes('JobPosting') ? content : '';
    }).get()];
  for (const value of values) {
    if (!value?.includes('JobPosting')) continue;
    const json=value.includes('&quot;@') && !value.includes('"@type"') ? decodeHTML(value) : value;
    try {
      const posting=findPosting(JSON.parse(json));
      if (posting) return posting;
    } catch {
      try {
        // A few portals emit raw line breaks inside JSON-LD strings.
        const escaped=json.replace(/"(?:\\.|[^"\\])*"/gs,(literal)=>literal.replace(/[\u0000-\u001f]/g,(character)=>JSON.stringify(character).slice(1,-1)));
        const posting=findPosting(JSON.parse(escaped));
        if (posting) return posting;
      } catch {}
    }
  }
  return undefined;
}

function sections(description, posting) {
  const html=/&lt;[a-z]/i.test(description) ? decodeHTML(description) : description;
  const markup=/<(?:p|ul|li|div|br)[\s>]/i.test(html) ? html.replace(/\r?\n[ \t]*/g,' ') : html.replace(/\r\n?/g,'\n');
  const $ = load('<main>'+markup+'</main>');
  $('script,style,noscript').remove();
  $('br').replaceWith('\n');
  $('h1,h2,h3,h4,h5,p,li,div').each((_,element)=>$(element).append('\n'));
  const lines=$('main').text().split(/\n/).map(text).filter(Boolean);
  const required=[], preferred=[];
  let heading='';
  for (const original of lines) {
    const line=original.replace(/^[-•*]\s*/,'');
    const parsed=norm(line);
    if (optional.test(parsed) && (/^.{0,52}:?$/.test(parsed) || /^(?:diferencial|desej[aá]vel|preferred)\s*:/.test(parsed))) {
      heading='preferred';
      const remainder=text(line.split(/:(.*)/s)[1]);
      if (remainder) preferred.push(remainder);
      continue;
    }
    if (requirementHeading.test(parsed) && line.length<75) {
      heading='required';
      const remainder=text(line.split(/:(.*)/s)[1]);
      if (remainder) required.push(remainder);
      continue;
    }
    if (neutralHeading.test(parsed) && line.length<65) { heading=''; continue; }
    if (heading && line.length>4) (heading==='required' && !optional.test(parsed) ? required : preferred).push(line);
  }
  for (const raw of [...array(posting.qualifications),...array(posting.experienceRequirements)]) {
    const entry=typeof raw==='string' ? text(load(raw).text()) : '';
    if (entry && !optional.test(norm(entry))) required.push(entry);
  }
  return {lines,required:[...new Set(required)],preferred:[...new Set(preferred)]};
}

function applyLink($, base) {
  const links=$('a[href]').filter((_,el)=>{
    const element=$(el);
    const label=norm(element.text()+' '+(element.attr('aria-label') || ''));
    return /^(?:candidatar(?:-se|-me| agora)|inscrever-se|inscreva-me|inscreve-te|quero me candidatar|inscreva-se(?: nesta vaga)?|aplicar agora|apply(?: for this (?:job|position)| now)?|candidate-se(?: agora)?|enviar candidatura|tenho interesse)(?:\b|$)/.test(label) ||
      /^(?:apply-link|fixed-applyButton|job-cta-link)$/.test(element.attr('data-testid') ?? '');
  });
  for (const element of links) {
    const address=url($(element).attr('href'),base);
    if (address && canonical(address.href)!==canonical(base)) return address.href;
  }
  const button=$('button:not([disabled])').filter((_,el)=>/^(?:candidatar-se|candidatar-me|candidatar agora|candidate-se|apply now|apply for this job)(?:\b|$)/.test(norm($(el).text())));
  const source=sourceForUrl(new URL(base));
  if (button.length || (source?.id==='infojobs' && links.length) ||
      (source?.id==='superestagios' && $('form input[name="id_vaga"]').length)) return canonical(base);
  return '';
}

function linkedinPosting($, candidate, now) {
  const title=text($('main h1').first().text());
  const company=text($('.topcard__org-name-link').first().text());
  const location=text($('.topcard__flavor--bullet').first().text());
  const description=$('.show-more-less-html__markup').first().html();
  if (!title || !company || !location || !description) return null;
  const exact=$('.top-card-layout time[datetime]').first().attr('datetime') || candidate.publishedAt;
  const age=norm($('.top-card-layout .posted-time-ago__text').first().text());
  const amount=age.match(/(?:ha |^)(\d+) (horas?|hours?|dias?|days?|semanas?|weeks?)(?: atras| ago)?$/);
  const unit=amount && /hora|hour/.test(amount[2]) ? DAY/24 : amount && /semana|week/.test(amount[2]) ? 7*DAY : DAY;
  const elapsed=amount ? Number(amount[1])*unit : null;
  const approximate=!exact && elapsed!==null && elapsed>=0 && elapsed+unit<30*DAY;
  const datePosted=exact || (approximate?new Date(now-elapsed).toISOString():'');
  const level=$('.description__job-criteria-item').first().text();
  return {
    title,hiringOrganization:{name:company},jobLocation:location,description,datePosted,dateEstimated:approximate,
    employmentType:internship.test(norm(level))?'INTERN':undefined
  };
}

function parsePage(html, address, candidate, user, now=Date.now()) {
  const $=load(html);
  const parsed=url(address);
  if (!parsed) return {kind:'unverified'};
  const source=sourceForUrl(parsed);
  const posting=structured($) || (source?.id==='linkedin'?linkedinPosting($,candidate,now):null);
  const content=$('main .top-card-layout').first();
  const visibleRoot=(content.length?content:$('main').length?$('main'):$('body')).clone();
  visibleRoot.find('script,style,noscript,template,[hidden]').remove();
  const visible=text(visibleRoot.text());
  if (closed.test(norm(visible))) return {kind:'closed'};
  if (!posting && !gupyHost(parsed.hostname)) {
    const official=$('a[href]').map((_,el)=>url($(el).attr('href'),address)).get().find((link)=>link && (
      (gupyHost(link.hostname) && /^\/jobs\/\d+$/.test(link.pathname)) ||
      /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com)$/.test(link.hostname) &&
        /\/jobs?\/|\/job-posting\/|\/posting\/|\/[^/]+\/[a-f0-9-]{20,}/i.test(link.pathname)
    ));
    return official ? {kind:'original',url:official.href} : {kind:'unverified'};
  }
  if (!posting) return {kind:'unverified'};
  const title=text(posting.title || $('h1').first().text());
  let company=text(posting.hiringOrganization?.name || candidate.company);
  if (source?.id==='riovagas' && norm(company)==='riovagas') {
    const named=load(posting.description || '').text().match(/(?:^|\n)\s*Empresa:\s*([^\n]+)/i)?.[1];
    company=text(named) || 'Empresa não informada';
  }
  const heading=norm(title);
  const isIntern=internship.test(heading)||array(posting.employmentType).some((item)=>norm(item)==='intern')||candidate.type==='vacancy_type_internship';
  const type=isIntern?'Estágio':'Júnior';
  if (!title || !company) return {kind:'unverified'};
  if (senior.test(heading) || excluded.test(heading) || (!isIntern && !junior.test(heading))) return {kind:'filtered'};
  const publishedAt=candidate.publishedAt || full(posting.datePosted);
  const validThrough=full(candidate.validThrough || posting.validThrough);
  if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) return {kind:'unverified'};
  if (!fresh(publishedAt,now) || expired(validThrough,now)) return {kind:'closed'};
  const description=posting.description || $('main').html() || '';
  const parsedSections=sections(description,posting);
  const listing=norm(parsedSections.lines.join(' '));
  const relatedDuties=/\b(?:desenvolver|desenvolvimento|programacao|implementacao|codificar)\b[^.!?]{0,72}\b(?:software|aplicac|scripts|codigo|sistemas|automac|apis?)/.test(listing);
  if (!relevant.test(heading) && !(isIntern && /\b(tecnologia|ti|informatica|inovacao|desenvolvimento|acelera|dados)\b/.test(heading) && relatedDuties)) return {kind:'filtered'};
  const publicMode=norm($('main').text()).slice(0,1250);
  const modeHint=!candidate.workplaceType && /(?:^|[/–|-])\s*(?:hibrid[oa]|hybrid)\b/.test(heading) ? 'hybrid' : candidate.workplaceType;
  const locality=place(posting,{...candidate,sourceId:source?.id,workplaceType:modeHint},listing+' '+publicMode+' '+heading);
  if (!locality) return {kind:'filtered'};
  const direct=applyLink($,address);
  if (!direct) return {kind:'unverified'};
  const identity=source && isListing(source.id,parsed) ? cleanListing(parsed,source.id) : canonical(address);
  const channel=source?.name || 'Site de carreiras';
  const job={
    id:createHash('sha256').update(identity).digest('hex').slice(0,24),
    title,company,type,channel,...locality,sourceUrl:identity,applyUrl:direct,publishedAt,dateEstimated:posting.dateEstimated===true,validThrough:validThrough || null,
    verifiedAt:new Date(now).toISOString(),
    workEligibility:locality.regionKey==='international'?authorizationNotes(parsedSections.lines):[],
    sourceMeta:{workplaceType:candidate.workplaceType,city:candidate.city,state:candidate.state,type:candidate.type,sourceId:source?.id},
    required:parsedSections.required.slice(0,24),preferred:parsedSections.preferred.slice(0,18),
    description:parsedSections.lines.join(' ').slice(0,460)
  };
  const match=fit({...job,description:parsedSections.lines.join(' '),required:parsedSections.required,preferred:parsedSections.preferred},user,now);
  return match ? {kind:'verified',job:{...job,...match}} : {kind:'filtered'};
}

function interleave(groups) {
  const items=[];
  const length=Math.max(0,...groups.map((group)=>group.length));
  for (let i=0;i<length;i++) {
    for (const group of groups) if (i<group.length) items.push(group[i]);
  }
  return items;
}

async function mapPool(items, cap, action) {
  const values=new Array(items.length);
  let index=0;
  await Promise.all(Array.from({length:Math.min(cap,items.length)},async ()=>{
    while (index<items.length) {
      const current=index++;
      try { values[current]={value:await action(items[current])}; }
      catch (error) { values[current]={error}; }
    }
  }));
  return values;
}

async function fetchPage(fetcher, address) {
  let current=url(address);
  const signal=AbortSignal.timeout(8500);
  for (let count=0;current && count<4;count++) {
    const response=await fetcher(current.href,{redirect:'manual',signal,headers:{accept:'text/html,application/xhtml+xml'}});
    if ([301,302,303,307,308].includes(response.status)) { current=url(response.headers.get('location'),current); continue; }
    if ([404,410].includes(response.status)) return {kind:'closed'};
    if (!response.ok) throw new Error('Página indisponível');
    const type=response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/.test(type)) return {kind:'unverified'};
    const reader=response.body.getReader();
    const chunks=[];
    let size=0;
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>4*1024*1024) { await reader.cancel(); return {kind:'unverified'}; }
      chunks.push(value);
    }
    return {kind:'page',html:Buffer.concat(chunks).toString('utf8'),url:current.href};
  }
  return {kind:'unverified'};
}

async function gupy(feed, settings, fetcher, now) {
  const found=[];
  for (let offset=0;offset<150;offset+=50) {
    const params=new URLSearchParams({limit:'50',offset:String(offset),sortBy:'publishedDate',sortOrder:'desc',...feed});
    const response=await fetcher('https://portal.gupy.io/api/job-search/jobs?'+params,{signal:AbortSignal.timeout(9000)});
    if (!response.ok) throw httpFailure(response.status);
    const data=await response.json();
    if (!Array.isArray(data.data)) throw listingFailure('Resposta do portal indisponível');
    for (const record of data.data) {
      const name=norm(record.name);
      const isIntern=record.type==='vacancy_type_internship'||internship.test(name);
      if (!fresh(record.publishedDate,now)||expired(record.applicationDeadline,now)||senior.test(name)||excluded.test(name)||
          (!isIntern && (!junior.test(name)||!relevant.test(name)))) continue;
      const foundMode={remote:'Remoto',hybrid:'Híbrido','on-site':'Presencial'}[record.workplaceType];
      if (foundMode && !settings.modes.includes(foundMode)) continue;
      const rio=norm(record.city)==='rio de janeiro' && ['rio de janeiro','rj'].includes(norm(record.state));
      const saoPaulo=norm(record.city)==='sao paulo' && ['sao paulo','sp'].includes(norm(record.state));
      const hybridSP=settings.includeSaoPaulo!==false && foundMode==='Híbrido' && saoPaulo;
      if (foundMode!=='Remoto' && !rio && !hybridSP) continue;
      if (isIntern && !relevant.test(name) && !/\b(tecnologia|ti|informatica|inovacao|sistemas|computacao|dados|desenvolvimento|acelera)\b/.test(name)) continue;
      const address=postingUrl(record.jobUrl,record.id);
      if (address) found.push({url:address,title:record.name,company:record.careerPageName,type:record.type,publishedAt:record.publishedDate,
          validThrough:record.applicationDeadline,workplaceType:record.workplaceType,city:record.city,state:record.state});
    }
    if (offset+data.data.length >= data.pagination?.total || data.data.length<50 ||
        data.data.some((item)=>Date.parse(item.publishedDate)<now-30*DAY)) break;
  }
  return found;
}

function gupyFeeds(settings) {
  const feeds=[];
  if (settings.modes.includes('Remoto')) {
    feeds.push({workplaceType:'remote',type:'vacancy_type_internship'});
    for (const jobName of ['desenvolvedor júnior','desenvolvimento','front-end','software','trainee tecnologia','inteligência artificial']) feeds.push({workplaceType:'remote',jobName});
  }
  if (settings.modes.some((mode)=>mode!=='Remoto')) {
    const local={city:'Rio de Janeiro',state:'Rio de Janeiro'};
    feeds.push({...local,type:'vacancy_type_internship'});
    for (const jobName of ['desenvolvedor','software','programador','front-end','trainee tecnologia','inteligência artificial']) feeds.push({...local,jobName});
  }
  if (settings.includeSaoPaulo!==false && settings.modes.includes('Híbrido')) {
    const hybrid={city:'São Paulo',state:'São Paulo',workplaceType:'hybrid'};
    feeds.push({...hybrid,type:'vacancy_type_internship'});
    for (const jobName of ['desenvolvedor júnior','desenvolvimento','front-end','software']) feeds.push({...hybrid,jobName});
  }
  return feeds;
}

const SEARCH_DOMAINS={
  gupy:'gupy.io/jobs',jobbol:'jobbol.com.br/vaga',linkedin:'linkedin.com/jobs/view',
  indeed:'indeed.com/viewjob',riovagas:'riovagas.com.br/riovagas',vagas:'vagas.com.br/vagas',
  superestagios:'superestagios.com.br/vaga',empregos:'empregos.com.br/vaga',
  infojobs:'infojobs.com.br/vaga-de',solides:'vagas.solides.com.br/vaga',glassdoor:'glassdoor.com.br/job-listing',
  jooble:'jooble.org/jdp'
};

function isListing(id, address) {
  const route=address.pathname;
  const matchers={
    gupy:/^\/(?:job\/[^/]+|jobs\/\d+)\/?$/,
    jobbol:/^\/vaga\/\d+(?:-[^/]+)?\/?$/,
    linkedin:/^\/jobs\/view\/(?:.+-)?\d+\/?$/,
    riovagas:/^\/riovagas\/[^/]+\/?$/,
    vagas:/^\/vagas\/v\d+(?:\/[^/]+)?\/?$/,
    superestagios:/^\/vaga\/\d+\/?$/,
    empregos:/^\/(?:vaga\/\d+(?:\/[^/]+)?|vagas\/[^/]+(?:\/[^/]+)*\/\d+)\/?$/,
    catho:/^\/vagas\/[^/]+(?:\/[^/]+)*\/\d+\/?$/,
    infojobs:/^\/vaga-de-[^/]+__\d+\.aspx$/i,
    solides:/^\/(?:vaga|vagas|vacancy|vacancies)\/\d+(?:[-/][^/]+)?\/?$/,
    '99jobs':/^\/(?:[^/]+\/jobs|vagas)\/\d+(?:-[^/]+)?\/?$/,
    jooble:/^\/(?:jdp|desc)\/-?\d+\/?$/
  };
  if (id==='glassdoor') return /^\/job-listing\//i.test(route) && /^\d+$/.test(address.searchParams.get('jl') || '');
  if (id==='indeed') return route==='/viewjob' && /^[\da-f]{10,32}$/i.test(address.searchParams.get('jk') || '');
  return Boolean(matchers[id]?.test(route));
}

function cleanListing(address, id) {
  if (id==='indeed') return address.origin+'/viewjob?jk='+address.searchParams.get('jk');
  if (id==='glassdoor') return address.origin+'/job-listing/jv?jl='+address.searchParams.get('jl');
  if (id==='riovagas') return address.origin+address.pathname.replace(/\/?$/,'/');
  return canonical(address.href);
}

function likelyTitle(title) {
  const heading=norm(title);
  if (senior.test(heading) || excluded.test(heading)) return false;
  const technical=relevant.test(heading) || /\b(ti|it|tecnologia|sistemas|informatica|dados|computacao|desenvolvimento)\b/.test(heading);
  return technical && (internship.test(heading) || junior.test(heading));
}

function publicListings(id, settings) {
  const remote=settings.modes.includes('Remoto');
  const local=settings.modes.some((mode)=>mode!=='Remoto');
  const saoPaulo=settings.includeSaoPaulo!==false && settings.modes.includes('Híbrido');
  const international=settings.includeInternational!==false;
  const query=(origin,params)=>({url:origin+'?'+new URLSearchParams(params)});
  const listings=(...urls)=>urls.map((url)=>({url}));
  if (id==='riovagas') {
    return [
      {url:'https://riovagas.com.br/tag/tecnologia-da-informacao/feed/',rss:true},
      {url:'https://riovagas.com.br/?'+new URLSearchParams({s:'estágio desenvolvimento',feed:'rss2'}),rss:true}
    ];
  }
  if (id==='jobbol') {
    return [
      {url:'https://www.jobbol.com.br/pesquisa-vagas?'+new URLSearchParams({cargo:'desenvolvedor júnior'})},
      {url:'https://www.jobbol.com.br/pesquisa-vagas?'+new URLSearchParams({cargo:'estágio desenvolvimento'})},
      {url:'https://www.jobbol.com.br/areas/informatica-ti'}
    ];
  }
  if (id==='vagas') {
    return ['desenvolvedor-junior','estagio-ti','estagio-tecnologia'].map((keyword)=>({url:'https://www.vagas.com.br/vagas-de-'+keyword}));
  }
  if (id==='superestagios') {
    return listings('https://www.superestagios.com.br/vagas/tecnologia-da-informacao',
      ...(saoPaulo?['https://www.superestagios.com.br/vagas/sao-paulo/analise-e-desenvolvimento-de-sistemas']:[]));
  }
  if (id==='empregos') return listings('https://www.empregos.com.br/vagas/desenvolvedor-junior','https://www.empregos.com.br/vagas/estagio-informatica');
  if (id==='infojobs') return listings(
    'https://www.infojobs.com.br/vagas-de-emprego-desenvolvedor-em-rio-de-janeiro.aspx',
    ...(saoPaulo?['https://www.infojobs.com.br/vagas-de-emprego-desenvolvedor-em-sao-paulo.aspx']:[])
  );
  if (id==='solides') return listings('https://vagas.solides.com.br/vagas/area/tecnologia/todas');
  if (id==='glassdoor') return [
    query('https://www.glassdoor.com/Job/jobs.htm',{'sc.keyword':'estágio tecnologia',locT:'N',locId:'36'}),
    query('https://www.glassdoor.com/Job/jobs.htm',{'sc.keyword':'desenvolvedor júnior',locT:'N',locId:'36'}),
    ...(international?[query('https://www.glassdoor.com/Job/jobs.htm',{'sc.keyword':'software engineer intern'})]:[])
  ];
  if (id==='jooble') return listings(
    'https://br.jooble.org/vagas-de-emprego-desenvolvedor-junior/Rio-de-Janeiro%2C-RJ',
    ...(saoPaulo?['https://br.jooble.org/vagas-de-emprego-desenvolvedor-junior/S%C3%A3o-Paulo%2C-SP']:[]),
    ...(international?['https://pt.jooble.org/emprego-est%C3%A1gio-inform%C3%A1tica/Lisboa']:[])
  );
  const subjects=['Estágio Desenvolvimento','Desenvolvedor Júnior'];
  const overseas=[['pt','Portugal','Estágio desenvolvimento software'],['uk','United Kingdom','Junior Software Developer'],['ca','Canada','Software Engineer Intern'],['us','United States','Software Developer Intern']];
  if (id==='indeed') {
    const localQueries=subjects.flatMap((subject)=>[
      ...(local?[query('https://br.indeed.com/jobs',{q:subject,l:'Rio de Janeiro, RJ',fromage:'30'})]:[]),
      ...(saoPaulo?[query('https://br.indeed.com/jobs',{q:subject+' híbrido',l:'São Paulo, SP',fromage:'30'})]:[]),
      ...(remote?[query('https://br.indeed.com/jobs',{q:subject+' remoto',l:'Brasil',fromage:'30'})]:[])
    ]);
    if (international && local) {
      for (const [prefix,country,role] of overseas) {
        const host=prefix==='us'?'www.indeed.com':prefix+'.indeed.com';
        localQueries.push(query('https://'+host+'/jobs',{q:role,l:country,fromage:'30'}));
      }
    }
    if (international && remote) localQueries.push(query('https://www.indeed.com/jobs',{q:'Junior Software Developer worldwide remote',fromage:'30'}));
    return localQueries;
  }
  if (id==='linkedin') {
    const base='https://www.linkedin.com/jobs/search/';
    const search=(keywords,location,workplace)=>query(base,{keywords,location,f_TPR:'r2592000',...(workplace?{f_WT:workplace}:{})});
    const localQueries=subjects.flatMap((subject)=>[
      ...(local?[search(subject,'Rio de Janeiro, Brasil')]:[]),
      ...(saoPaulo?[search(subject,'São Paulo, Brasil','3')]:[]),
      ...(remote?[search(subject,'Brasil','2')]:[])
    ]);
    if (international && local) {
      localQueries.push(...overseas.map(([,country,role])=>search(role,country,settings.modes.includes('Presencial')?'':'3')));
    }
    if (international && remote) localQueries.push(search('Junior Software Developer Worldwide','Worldwide','2'));
    return localQueries;
  }
  return [];
}

async function listingResponse(page, id, fetcher) {
  const signal=AbortSignal.timeout(8000);
  const headers={accept:page.rss?'application/rss+xml, application/xml, text/xml':'text/html,application/xhtml+xml'};
  const canRetry=['jobbol','indeed'].includes(id);
  const first=await fetcher(page.url,{signal,headers}).catch((error)=>{
    if (!canRetry || signal.aborted) throw error;
    return null;
  });
  if (first && (!canRetry || ![408,502,503,504].includes(first.status) || first.headers.get('retry-after'))) return first;
  if (first?.body) await first.body.cancel().catch(()=>{});
  return fetcher(page.url,{signal,headers});
}

function httpFailure(status) {
  return Object.assign(new Error('A fonte retornou HTTP '+status),{status});
}

function listingFailure(message) {
  return Object.assign(new Error(message),{code:'LISTING_FORMAT'});
}

function sourceIssue(error) {
  const {status,code,name}=error;
  if (Number.isInteger(status)) return 'http-'+status;
  if (code==='LISTING_FORMAT') return 'format';
  if (name==='TimeoutError' || name==='AbortError' || ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code)) return 'timeout';
  return 'network';
}

async function collectListings(page, id, fetcher, now) {
  const response=await listingResponse(page,id,fetcher);
  if (!response.ok) throw httpFailure(response.status);
  const finalUrl=url(response.url || page.url);
  if (!finalUrl || sourceForUrl(finalUrl)?.id!==id) throw listingFailure('O portal redirecionou para fora da pesquisa.');
  if (/\/(?:login|authwall|checkpoint|captcha|sign-?in)(?:\/|$)/i.test(finalUrl.pathname)) {
    throw listingFailure('O portal não disponibilizou a lista pública.');
  }
  const html=await response.text();
  if (html.length>7*1024*1024) throw listingFailure('A página de pesquisa excedeu o tamanho previsto.');
  const $=load(html,page.rss?{xml:true}:{});
  const found=new Map();

  function add(address, title, publishedAt) {
    const parsed=url(address,finalUrl.href);
    if (!parsed || sourceForUrl(parsed)?.id!==id || !isListing(id,parsed)) return;
    const knownInternship=id==='superestagios' && !internship.test(norm(title));
    const subject=knownInternship?'Estágio em '+title:title;
    if (!likelyTitle(subject)) return;
    if (publishedAt && !fresh(publishedAt,now)) return;
    const cleaned=cleanListing(parsed,id);
    if (cleaned && !found.has(cleaned)) found.set(cleaned,{url:cleaned,title:subject,publishedAt:publishedAt || undefined,...(id==='superestagios'?{type:'vacancy_type_internship'}:{})});
  }

  if (id==='solides') {
    // Public Next.js listing data contains labels and vacancy IDs even without HTML links.
    for (const script of $('script').get()) {
      const content=$(script).html() || '';
      if (!content.includes('redirectLink')) continue;
      for (const payload of content.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)) {
        let data;
        try { data=JSON.parse(payload[1]); } catch { continue; }
        for (const record of data.matchAll(/"id":(\d+),"title":("(?:\\.|[^"\\])*")/g)) {
          let title;
          try { title=JSON.parse(record[2]); } catch { continue; }
          add('https://vagas.solides.com.br/vaga/'+record[1],title);
        }
      }
    }
  }
  if (page.rss) {
    const items=$('rss channel > item');
    if (!$('rss channel').length) throw listingFailure('Feed público não reconhecido.');
    items.each((_,entry)=>{
      const node=$(entry);
      add(node.children('link').text(),text(node.children('title').text()),text(node.children('pubDate').text()));
    });
  } else if (id==='indeed') {
    const links=$('a[data-jk], a[href*="/viewjob?jk="], a[href*="/rc/clk?jk="]');
    if (!links.length && !/nenhuma vaga|no jobs found|nao encontramos/.test(norm($('title').text()+' '+$('main').text().slice(0,400)))) {
      throw listingFailure('A lista pública do Indeed não está disponível.');
    }
    links.each((_,anchor)=>{
      const item=$(anchor);
      const linked=url(item.attr('href'),finalUrl.href);
      const key=item.attr('data-jk') || (linked && sourceForUrl(linked)?.id==='indeed'?linked.searchParams.get('jk'):'');
      const title=text(item.find('span[title]').attr('title') || item.text() || item.attr('aria-label'));
      if (/^[\da-f]{10,32}$/i.test(key || '')) add(finalUrl.origin+'/viewjob?jk='+key,title);
    });
  } else {
    if (/seguranca|sign in|access denied|acesso bloqueado|verifique se voce|captcha|just a moment|verify you are human/.test(norm($('title').text()))) {
      throw listingFailure('O portal não disponibilizou a lista pública.');
    }
    $('a[href]').each((_,anchor)=>{
      const item=$(anchor);
      const target=item.attr('href');
      if (!target || !isListing(id,url(target,finalUrl.href) || finalUrl)) return;
      const container=item.closest('article,li,.base-card');
      const anchorTitle=text(item.attr('title') || item.text());
      const cardTitle=text(item.find('h2,h3,h4').first().text() || container.find('h2,h3,h4').first().text());
      const callToAction=/^(?:ver|abrir|candidatar|apply|saiba mais|inscreva|quero)/.test(norm(anchorTitle));
      const title=(!callToAction && likelyTitle(anchorTitle)?anchorTitle:cardTitle) || (callToAction?'':anchorTitle);
      const submitted=id==='linkedin'?container.find('time[datetime]').first().attr('datetime'):undefined;
      add(target,title,submitted);
    });
  }
  return [...found.values()].slice(0,11);
}

async function firecrawl(fetcher, key, route, payload, timeout=12000) {
  const response=await fetcher('https://api.firecrawl.dev/v2/'+route,{
    method:payload?'POST':'GET',redirect:'error',
    headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{})},
    body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw Object.assign(new Error('Firecrawl retornou HTTP '+response.status),{status:response.status});
  const result=await response.json();
  if (result.success===false) throw new Error('Pesquisa Firecrawl indisponível');
  return result;
}

function webQueries(settings, user, enabled, key) {
  const technical=skills.filter(([,pattern])=>pattern.test(norm(user.skills.join(' ')))).slice(0,4).map(([label])=>'"'+label+'"').join(' OR ') || 'JavaScript OR TypeScript';
  const domains=enabled.map((id)=>SEARCH_DOMAINS[id]).filter(Boolean).map((domain)=>'site:'+domain);
  const secondary=['superestagios','empregos','infojobs','solides','glassdoor','jooble']
    .filter((id)=>enabled.includes(id)).map((id)=>'site:'+SEARCH_DOMAINS[id]);
  const constraint=(items)=>items.length?' ('+items.join(' OR ')+')':'';
  const role='(estágio OR júnior) (desenvolvimento OR software OR "front-end" OR '+technical+')';
  const queries=[];
  if (settings.modes.some((mode)=>mode!=='Remoto')) {
    const locality=settings.includeSaoPaulo!==false && settings.modes.includes('Híbrido') ?
      '("Rio de Janeiro" OR "São Paulo híbrido")' : '"Rio de Janeiro"';
    queries.push({query:role+' '+locality+constraint(secondary.length?secondary:domains),country:'BR'});
    if (key) queries.push({query:role+' '+locality,country:'BR'});
  }
  if (settings.modes.includes('Remoto')) {
    queries.push({query:role+' (remoto OR "remote Brazil") Brasil'+constraint(domains),country:'BR'});
  }
  if (settings.includeInternational!==false) {
    const remote=settings.modes.includes('Remoto');
    const local=settings.modes.some((mode)=>mode!=='Remoto');
    const outside=local&&remote?'(Portugal OR Canada OR United Kingdom OR global OR worldwide)':
      local?'(Portugal OR Canada OR United Kingdom OR United States OR Germany OR Spain)':'(global OR worldwide OR LATAM)';
    queries.push({query:'("software engineering intern" OR "junior software developer" OR "estágio em desenvolvimento") '+outside+' (job OR careers OR vaga) -site:linkedin.com/company',country:'US'});
  }
  return queries;
}

async function alexandria(fetcher,key,settings) {
  const config={
    prompt:'Use a fonte de vagas Alexandria disponível e retorne até 15 URLs originais de vagas com candidatura em aberto e data de publicação dentro dos últimos 30 dias. Procure estágio ou júnior em desenvolvimento web, front-end, back-end, full-stack, software e IA aplicada compatível com início de carreira. Modalidades habilitadas: '+settings.modes.join(', ')+'. Híbrido e presencial somente na cidade do Rio de Janeiro/RJ. Remoto deve aceitar candidatos no Brasil. Retorne links de vagas individuais publicados pelo empregador ou seu ATS, e ignore anúncios sênior, pleno e expirados.',
    effort:'low',maxCredits:100,exchange:{enabled:true,maxCalls:3,onTermsRequired:'skip'},
    schema:{type:'object',properties:{jobs:{type:'array',items:{type:'object',properties:{url:{type:'string'},title:{type:'string'}},required:['url']}}},required:['jobs']}
  };
  const started=await firecrawl(fetcher,key,'agent',config);
  if (!started.id || !/^[a-z0-9-]+$/i.test(started.id)) throw new Error('Alexandria indisponível');
  for (let attempt=0;attempt<22;attempt++) {
    await new Promise((resolve)=>setTimeout(resolve,5000));
    const status=await firecrawl(fetcher,key,'agent/'+started.id,null,15000);
    if (status.status==='completed') return array(status.data?.jobs);
    if (['failed','cancelled'].includes(status.status)) break;
  }
  throw new Error('Alexandria não concluiu a busca');
}

async function inspect(candidate, user, scrapeFallback, fetcher, now, remaining=1) {
  let original;
  try { original=await fetchPage(fetcher,candidate.url); } catch { original={kind:'unverified'}; }
  if (original.kind==='closed') return original;
  if (original.kind==='page') {
    const result=parsePage(original.html,original.url,candidate,user,now);
    if (result.kind==='original' && remaining) return inspect({...candidate,url:result.url},user,scrapeFallback,fetcher,now,remaining-1);
    if (result.kind!=='unverified') return result;
  }
  const result=await scrapeFallback(candidate.url);
  const scrapedUrl=result?.data?.metadata?.sourceURL || candidate.url;
  const html=result?.data?.rawHtml;
  if (!html) return {kind:'unverified'};
  const parsed=parsePage(html,scrapedUrl,candidate,user,now);
  if (parsed.kind==='original' && remaining) return inspect({...candidate,url:parsed.url},user,scrapeFallback,fetcher,now,remaining-1);
  return parsed;
}

async function scan({settings,user,key='',fetcher,previous=[],now=Date.now(),onProgress=()=>{}}) {
  const configured=Array.isArray(settings.sourceIds)?settings.sourceIds:settings.gupy?['gupy']:[];
  const enabled=JOB_SOURCES.filter((source)=>source.searchable!==false && configured.includes(source.id)).map((source)=>source.id);
  const reads=[];
  const direct=new Map();
  const health={};
  const issues={};
  const rateLimitedHosts=new Set();
  const groups=[];
  const pending=[];
  const active=new Set();
  const requestCounts=new Map();
  const requests=new Set();
  const results=[];
  const earlyCounts=new Map();
  const discoveryDeadline=AbortSignal.timeout(key&&settings.alexandria ? 130000 : 26000);
  const scanDeadline=AbortSignal.timeout(key&&settings.alexandria ? 150000 : 45000);
  const fetchWithin=(deadline)=>(address,options={})=>fetcher(address,{
    ...options,signal:options.signal?AbortSignal.any([deadline,options.signal]):deadline
  });
  const discover=fetchWithin(discoveryDeadline);
  const discoverListings=async (address,options)=>{
    const host=new URL(address).hostname;
    if (rateLimitedHosts.has(host)) throw httpFailure(429);
    const response=await discover(address,options);
    if (response.status===429) rateLimitedHosts.add(host);
    return response;
  };
  const verify=fetchWithin(scanDeadline);
  let providerLimited=false;
  let scrapeBudget=key ? 8 : 2;
  let scheduled=0;
  let checked=0;
  let early=0;

  const cached=new Map(previous.filter((job)=>Date.parse(job.verifiedAt)>now-60*60*1000 &&
    fresh(job.publishedAt,now) && !expired(job.validThrough,now)).map((job)=>[canonical(job.sourceUrl),job]));

  function requestFirecrawl(route,payload,transport=discover) {
    return firecrawl(transport,key,route,payload).catch((error)=>{
      if (error.status===429) {
        providerLimited=true;
        health.firecrawl='limited';
        issues.firecrawl=[...new Set([...(issues.firecrawl || []),'http-429'])];
      }
      throw error;
    });
  }

  async function scrapeFallback(address) {
    if (!settings.firecrawl || providerLimited || scrapeBudget<=0 || scanDeadline.aborted) return null;
    scrapeBudget--;
    return requestFirecrawl('scrape',{url:address,formats:['rawHtml'],maxAge:0,timeout:7500},verify).catch(()=>null);
  }

  async function inspectCandidate(candidate) {
    let result;
    try {
      const saved=cached.get(canonical(candidate.url));
      result=saved ? {kind:'verified',job:saved} : await inspect(candidate,user,scrapeFallback,verify,now);
    } catch {
      result={kind:'unverified'};
    }
    checked++;
    results.push({candidate,result});
    onProgress({checked,queued:scheduled,job:result.kind==='verified'&&coverageAllows(result.job,settings)?result.job:null});
  }

  function pump() {
    if (scanDeadline.aborted) {
      pending.splice(0).forEach((candidate)=>results.push({candidate,result:{kind:'unverified'}}));
      return;
    }
    while (active.size<10) {
      const index=pending.findIndex((candidate)=>(requestCounts.get(candidate.origin)||0)<3);
      if (index<0) return;
      const [candidate]=pending.splice(index,1);
      requestCounts.set(candidate.origin,(requestCounts.get(candidate.origin)||0)+1);
      const task=inspectCandidate(candidate).catch(()=>{}).finally(()=>{
        requestCounts.set(candidate.origin,requestCounts.get(candidate.origin)-1);
        active.delete(task);
        pump();
      });
      active.add(task);
    }
  }

  function enqueue(candidate, earlyOnly=false) {
    if (scheduled>=92 || scanDeadline.aborted) return;
    const submitted=url(candidate.url);
    if (!submitted) return;
    const source=sourceForUrl(submitted);
    if (source && (!enabled.includes(source.id) || !isListing(source.id,submitted))) return;
    const candidateUrl=cleanListing(submitted,source?.id);
    if (!candidateUrl || requests.has(candidateUrl) || senior.test(norm(candidate.title)) || excluded.test(norm(candidate.title))) return;
    if (!candidate.workplaceType && !candidate.type && !likelyTitle(candidate.title) &&
        !/job|vaga|careers|career|recruit|trabalhe|oportunidade|apply/i.test(submitted.pathname)) return;
    if (earlyOnly) {
      const bucket=source?.id || submitted.hostname;
      const count=earlyCounts.get(bucket) || 0;
      if (early>=48 || count>=7) return;
      earlyCounts.set(bucket,count+1);
      early++;
    }
    requests.add(candidateUrl);
    scheduled++;
    pending.push({...candidate,url:candidateUrl,origin:submitted.hostname});
    pump();
  }

  function track(id,work) {
    const task=work.then((records)=>{
      const successes=records.filter((record)=>!record.error);
      const problems=[...new Set(records.filter((record)=>record.error).map((record)=>sourceIssue(record.error)))];
      if (problems.length) issues[id]=[...new Set([...(issues[id] || []),...problems])];
      const jobs=interleave(successes.map((record)=>record.value));
      if (health[id]!=='limited') health[id]=successes.length===0?(problems.length===1 && problems[0]==='http-429'?'limited':'error'):
        successes.length===records.length?'ok':'partial';
      groups.push(jobs);
      return jobs;
    });
    reads.push(task);
    direct.set(id,task);
  }

  function streamRead(work) {
    return async (item)=>{
      const entries=await work(item);
      entries.slice(0,3).forEach((candidate)=>enqueue(candidate,true));
      return entries;
    };
  }

  if (enabled.includes('gupy')) {
    track('gupy',mapPool(gupyFeeds(settings),6,streamRead((feed)=>gupy(feed,settings,discoverListings,now))));
  }
  for (const id of enabled.filter((item)=>item!=='gupy')) {
    const pages=publicListings(id,settings);
    if (pages.length) track(id,mapPool(pages,id==='linkedin'?2:3,streamRead((page)=>collectListings(page,id,discoverListings,now))));
  }
  if (settings.firecrawl) {
    const providerSearch=streamRead(async ({query,country})=>{
      if (providerLimited) throw new Error('Limite do Firecrawl');
      const result=await requestFirecrawl('search',{query,limit:key?12:10,country,...(country==='BR'?{location:'Brazil'}:{}),tbs:'qdr:m'});
      if (!Array.isArray(result.data?.web)) throw listingFailure('Firecrawl retornou dados incompletos');
      return result.data.web;
    });
    track('firecrawl',mapPool(webQueries(settings,user,enabled,key),2,providerSearch));
    if (key && settings.alexandria) track('alexandria',mapPool([null],1,streamRead(()=>alexandria(discover,key,settings))));
    const prioritySources=['jobbol','indeed'];
    const recoveryGroups=[prioritySources,enabled.filter((id)=>!prioritySources.includes(id))];
    for (const group of recoveryGroups) {
      const recovery=group.filter((id)=>direct.has(id) && SEARCH_DOMAINS[id]);
      if (!recovery.length) continue;
      const recover=Promise.all(recovery.map(async (id)=>[id,await direct.get(id)])).then(async (answers)=>{
        const unavailable=answers.filter(([id,items])=>['error','limited'].includes(health[id]) || health[id]==='partial'&&!items.length).map(([id])=>id);
        if (!unavailable.length || providerLimited || discoveryDeadline.aborted) return;
        const domains=unavailable.map((id)=>'site:'+SEARCH_DOMAINS[id]).join(' OR ');
        const places=settings.includeSaoPaulo!==false?'("Rio de Janeiro" OR "São Paulo" OR remoto)':'("Rio de Janeiro" OR remoto)';
        const discovered=await providerSearch({query:'(estágio OR júnior) (software OR desenvolvimento OR programação) '+places+' ('+domains+')',country:'BR'}).catch(()=>[]);
        groups.push(discovered);
      });
      reads.push(recover);
    }
  }

  await Promise.all(reads);
  for (const candidate of interleave(groups)) enqueue(candidate);
  for (const job of previous.filter((item)=>fresh(item.publishedAt,now) && !expired(item.validThrough,now) && coverageAllows(item,settings)).slice(0,16)) {
    enqueue({url:job.sourceUrl,title:job.title,company:job.company,publishedAt:job.publishedAt,...job.sourceMeta});
  }
  pump();
  while (active.size) await Promise.race(active);

  const jobs=[], seen=new Set(), closedUrls=[];
  const priority=(entry)=>['Gupy','Site de carreiras'].includes(entry.result.job?.channel)?0:1;
  for (const {candidate,result} of results.sort((a,b)=>priority(a)-priority(b))) {
    if (result.kind==='closed') closedUrls.push(candidate.url);
    if (result.kind!=='verified' || !coverageAllows(result.job,settings)) continue;
    const job=result.job;
    const source=job.sourceMeta?.sourceId;
    if (source && ['error','limited'].includes(health[source])) health[source]='partial';
    const identity=fingerprints(job);
    if (identity.some((entry)=>seen.has(entry))) continue;
    for (const entry of identity) seen.add(entry);
    jobs.push(job);
  }
  const checkedPortals=new Map();
  for (const {candidate,result} of results) {
    const source=sourceForUrl(new URL(candidate.url))?.id;
    if (source) checkedPortals.set(source,Boolean(checkedPortals.get(source)) || ['verified','filtered','closed'].includes(result.kind));
  }
  for (const [source,confirmed] of checkedPortals) {
    if (confirmed || !['ok','partial'].includes(health[source])) continue;
    health[source]='partial';
    issues[source]=[...(issues[source] || []),'unverified'];
  }
  const successful=Object.values(health).some((status)=>status==='ok'||status==='partial');
  const listed=results.some(({result})=>result.kind!=='unverified');
  return {
    jobs:jobs.sort((a,b)=>b.score-a.score||Date.parse(b.publishedAt)-Date.parse(a.publishedAt)),
    closedUrls,
    sources:health,
    sourceIssues:issues,
    blocked:(!successful&&!jobs.length) || (!!results.length && !listed),
    partial:Object.values(health).some((status)=>status!=='ok') || results.some(({result})=>result.kind==='unverified')
  };
}

module.exports={scan,publicFetch,parsePage,coverageAllows,collectListings,publicListings,canonical,url,fingerprints,profile,MODES,fresh,expired,nextDaily,localDate,manualJobDetails};
