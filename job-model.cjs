'use strict';

const JOB_SOURCES=require('./src/sources.js');
const {publicUrl:url,JOB_MODES:MODES}=require('./src/workflow.js');
const {place,coverageAllows}=require('./geography.cjs');

const DAY = 86400000;
const TIME_ZONE = 'America/Sao_Paulo';
const profile = {
  name:'Perfil de exemplo',
  course:'Análise e Desenvolvimento de Sistemas',
  period:'3º período',
  graduation:'2028-06',
  experience:'Experiência de exemplo em desenvolvimento front-end',
  skills:['Angular','TypeScript','JavaScript','HTML','CSS/SCSS','RxJS','Git/GitHub','APIs REST','Node.js (fundamentos)','SQL (fundamentos)','Firebase','Code review','Boas práticas de desenvolvimento'],
  resumeName:''
};

const text = (v) => typeof v === 'string' ? v.replace(/\s+/g,' ').trim() : '';
const norm = (v) => text(v).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const fresh = (date, now) => Number.isFinite(Date.parse(date)) && Date.parse(date) >= now-30*DAY && Date.parse(date) <= now+DAY;
const full = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date+'T23:59:59-03:00' : date;
const expired = (date, now) => Number.isFinite(Date.parse(full(date))) && Date.parse(full(date)) < now;
const senior = /\b(senior|sr|pleno|pl|lider|lead|staff|principal|especialista|manager|gerente|coordenador|head|arquiteto)\b/;
const junior = /\b(junior|jr|entry[ -]level|new grad(?:uate)?|graduate (?:software )?(?:engineer|developer|program(?:me)?)|trainee|nivel inicial)\b/;
const internship = /\b(estagios?|estagiari[oa]s?|internships?|interns?|stagiaire|praktikum|practicante|becari[oa]|practicas)\b/;
const relevant = /\b(desenvolvedor[a]?|desenvolvimento (?:de |em )?(?:software|web|front|back|full|sistemas|aplicacoes)|developer|develop(?:ment|ing)|swe|software|ingenieria de software|programmierung|programmation|front[ -]?end|back[ -]?end|full[ -]?stack|programador[a]?|programacao|inteligencia artificial|machine learning|automacao de software|ia|rpa)\b/;
const excluded = /\b(banco de talentos|talent pool|cadastro reserva|futuras oportunidades|exclusiv[oa] (?:para )?pcd|vaga afirmativa para pcd)\b/;
const skills = [
  ['Angular',/\bangular\b/],['TypeScript',/\btypescript\b/],['JavaScript',/\b(javascript|ecmascript)\b/],
  ['HTML',/\bhtml5?\b/],['CSS/SCSS',/\b(css3?|scss|sass)\b/],['RxJS',/\brxjs\b/],['Git/GitHub',/\b(git|github|gitlab|versionamento)\b/],
  ['APIs REST',/\b(rest(?:ful)?|apis? (?:web|rest)|consumo de api)\b/],['Node.js',/\bnode(?:[ .]?js)\b/],['SQL',/\b(sql|postgresql|mysql|sqlite)\b/],
  ['Firebase',/\bfirebase\b/],['Code review',/\b(code review|revisao de codigo)\b/],['Boas práticas de desenvolvimento',/\b(boas praticas|clean code)\b/]
];
const advanced = /\b(?:experiencia (?:comprovada|profissional|solida|avancada|em producao)|dominio avancado|nivel avancado|especializacao obrigatoria|graduacao completa|ensino superior completo|curso superior completo|superior complet[oa]|(?:[2-9]|[1-9][0-9])\+?\s*(?:a [0-9]+\s*)?anos (?:de )?experiencia|(?:minimo|pelo menos|a partir de) (?:de )?[2-9]\s*anos)\b/;
const otherCore = /\b(react(?: native)?|vue|svelte|next[ .]?js|java|spring boot|python|c#|golang|ruby|php|flutter|kotlin|swift|aws|azure|docker|kubernetes|pytorch|tensorflow|pandas|langchain|power automate|uipath|cypress|jest|dotnet)\b/;

function canonical(value) {
  const parsed = url(value);
  if (!parsed) return '';
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|ref$|refId$|trackingId$|position$|pageNum$|jobBoardSource$|source$|fbclid$|gclid$|gh_src$|trk$)/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  parsed.pathname = parsed.pathname.replace(/\/+$/,'') || '/';
  return parsed.href;
}

const gupyHost = (hostname) => hostname.endsWith('.gupy.io') && !['portal.gupy.io','login.gupy.io'].includes(hostname);

function fit(job, user, now) {
  const title=norm(job.title);
  const mandatory=norm(job.required.join(' '));
  const preferred=norm(job.preferred.join(' '));
  const body=norm(job.description);
  const userSkills=norm(user.skills.join(' '));
  const recognized=skills.filter(([,pattern])=>pattern.test(userSkills));
  const matches=recognized.filter(([,pattern])=>pattern.test(mandatory));
  const extras=recognized.filter(([,pattern])=>!pattern.test(mandatory) && pattern.test(preferred+' '+body));
  const mandatoryLines=job.required.map(norm);
  const isIntern=job.type==='Estágio';
  const alternatives=/\b(?:ou|or|equivalente|similar|qualquer linguagem)\b/;
  if (mandatoryLines.some((line)=>advanced.test(line) && !/sem (?:exigir )?experiencia|nao exigimos experiencia|dispensa experiencia|completo ou cursando|completo ou em andamento/.test(line))) return null;
  if (mandatoryLines.some((line)=>otherCore.test(line) && !otherCore.test(userSkills) &&
      !alternatives.test(line) && /\b(experiencia|experience|proficiency|dominio|proficiencia|obrigatori|atuacao)/.test(line))) return null;
  if (!isIntern && !matches.length && !extras.length) return null;
  if (!isIntern && /\b[1-9]\s*anos?\b/.test(mandatory) && !/\b(?:aprendiz|experiencia|estagio|desenvolvedora?|developer)\b/.test(norm(user.experience))) return null;
  const grad=String(user.graduation).replace('-','');
  const graduationText=mandatory+' '+body;
  const graduationLimits=[...graduationText.matchAll(/(?:formatura|conclusao)[^.!?;]{0,36}(?:a partir de|entre|prevista para)\s*(?:(\d{1,2})[/.])?(20\d\d)/g)];
  const semester=[...graduationText.matchAll(/(?:formatura|conclusao)[^.!?]{0,76}(?:a partir de|posterior a|igual ou posterior a|depois de)\s*(20\d\d)[/.-]([12])\b/g)];
  const months=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const namedDates=[...graduationText.matchAll(/(?:formatura|conclusao)[^.!?;]{0,36}(a partir de|entre|prevista para|ate)\s+([a-z]+)\s+(?:de\s+)?(20\d\d)/g)];
  if (isIntern && (graduationLimits.some((entry)=>entry[2]+String(entry[1] || '01').padStart(2,'0')>grad) ||
      semester.some((entry)=>entry[1]+(entry[2]==='2'?'07':'01')>grad) ||
      namedDates.some(([,operator,month,year])=>{
        if (!months.includes(month)) return false;
        const date=year+String(months.indexOf(month)+1).padStart(2,'0');
        return operator==='ate'?grad>date:grad<date;
      }))) return null;
  const explicitlyConflictingCourse = mandatoryLines.some((line)=>/\b(cursando|graduacao em andamento|matriculado)\b/.test(line) &&
    /\b(?:administracao|direito|engenharia civil|design grafico)\b/.test(line) &&
    !/analise|sistemas|computacao|software|tecnologia|correlat|afins|relacionad/.test(line));
  if (isIntern && explicitlyConflictingCourse) return null;
  if (isIntern && Date.parse(user.graduation+'-01')+31*DAY<now) return null;
  if (isIntern && !matches.length && !extras.length && !/computacao|sistemas|software|programacao|tecnologia/.test(mandatory+' '+title)) return null;

  const labels=[...matches,...extras].map(([label])=>label);
  const score=Math.min(99, (isIntern?66:59)+Math.min(24,matches.length*6)+Math.min(9,extras.length*3)+(/front[ -]?end|angular|desenvolvimento web/.test(title)?5:0)+(isIntern && user.course?3:0));
  const base = isIntern ? 'O estágio é de nível de entrada e pode ser compatível com sua formação em '+user.course+'.' : 'O cargo é de nível inicial e tem relação com sua experiência declarada.';
  const overlap=labels.length? ' A página cita '+labels.slice(0,4).join(', ')+'.':' A aderência considera a formação e a área da oportunidade.';
  return {skills:labels,score,reason:base+overlap};
}

function sourceForUrl(address) {
  const hostname=address.hostname;
  if (gupyHost(hostname)) return JOB_SOURCES.find((source)=>source.id==='gupy');
  return JOB_SOURCES.find((source)=>{
    const domains=source.domains || [new URL(source.url).hostname.replace(/^(?:www|br)\./,'')];
    return domains.some((host)=>hostname===host || hostname.endsWith('.'+host));
  });
}

function manualJobDetails(entry,user,now=Date.now()) {
  const address=url(entry.site);
  const portal=JOB_SOURCES.find((source)=>source.id===entry.portalId) || (address?sourceForUrl(address):null);
  const workplaceType={Remoto:'remote',Híbrido:'hybrid',Presencial:'on-site'}[entry.mode];
  const region=workplaceType && entry.location?place({jobLocation:entry.location},{workplaceType},''):null;
  const required=Array.isArray(entry.required)?entry.required:[];
  const preferred=Array.isArray(entry.preferred)?entry.preferred:[];
  const match=['Estágio','Júnior'].includes(entry.type) && (required.length || preferred.length || entry.description) ?
    fit({...entry,required,preferred},user,now):null;
  return {
    ...entry,required,preferred,manual:true,regionKey:region?.regionKey,
    channel:portal?.name || address?.hostname || '',
    publishedAt:entry.publishedOn?entry.publishedOn+'T12:00:00-03:00':null,
    skills:match?.skills || [],score:match?.score ?? null,
    reason:match?.reason.replace('A página cita','O registro menciona')
  };
}

function fingerprints(job) {
  const company=norm(job.company).replace(/[^a-z0-9]+/g,' ').trim().replace(/^(?:oportunidades|carreiras) (?:da |do |de )?/,'');
  const title=norm(job.title).replace(/[^a-z0-9]+/g,' ').trim();
  const address=url(job.sourceUrl);
  const linkedinId=address && sourceForUrl(address)?.id==='linkedin' && address.pathname.match(/\d+$/)?.[0];
  return [...new Set(['url:'+canonical(job.sourceUrl),'apply:'+canonical(job.applyUrl),...(linkedinId?['linkedin:'+linkedinId]:[]),...(company&&company!=='empresa nao informada'?['role:'+company+'|'+title]:[])])];
}

const localDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});

function localDate(now) {
  const parts = localDateFormatter.formatToParts(now);
  return ['year','month','day'].map((part)=>parts.find((item)=>item.type===part).value).join('-');
}

function nextDaily(time, now=Date.now()) {
  const today=Date.parse(localDate(now)+'T'+time+':00-03:00');
  return today>now ? today : today+DAY;
}

module.exports={
  DAY,profile,MODES,url,text,norm,full,fresh,expired,canonical,senior,junior,internship,relevant,excluded,
  skills,gupyHost,fit,sourceForUrl,manualJobDetails,fingerprints,localDate,nextDaily,coverageAllows
};
