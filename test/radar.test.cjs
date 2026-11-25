'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {parsePage,scan,publicListings}=require('../jobs.cjs');
const {profile,jobLevels,fitRadar}=require('../job-model.cjs');
const {radarPreferences,searchCoverage}=require('../src/workflow.js');
const {place}=require('../geography.cjs');

const now=Date.parse('2026-11-25T12:00:00Z');
const original='https://www.glassdoor.com.br/job-listing/jv?jl=123456789';
const user={...profile,course:'Design Gráfico',graduation:'2028-12',skills:['Figma','Adobe Illustrator']};
const radar=radarPreferences({
  titles:'Designer de Produto',areas:'Design',levels:['Pleno','Sênior'],
  locations:'Curitiba, PR\nLisboa, Portugal',remoteLocations:'Portugal\nBrasil',useCourse:true
});
const settings={modes:['Presencial','Híbrido','Remoto'],sourceIds:['glassdoor'],firecrawl:true,radar};

function ad(properties={}) {
  const data={
    '@type':'JobPosting',title:'Designer de Produto Pleno',hiringOrganization:{name:'Empresa de Design'},
    datePosted:'2026-11-24',description:'<p>Requisitos</p><ul><li>Figma e Adobe Illustrator</li></ul>',
    jobLocation:{address:{addressLocality:'Curitiba',addressRegion:'Paraná',addressCountry:'BR'}},
    ...properties
  };
  return '<html><main><script type="application/ld+json">'+JSON.stringify(data)+
    '</script><a href="https://example.com/candidatura">Candidatar-se</a></main></html>';
}

test('classifica a senioridade e identifica competências de uma área fora de tecnologia',()=>{
  assert.deepEqual(jobLevels('Analista de Comunicação Sênior'),['Sênior','Analista']);
  assert.deepEqual(jobLevels('Trainee Comercial'),['Trainee']);
  const found=parsePage(ad(),original,{},user,now,settings);
  assert.equal(found.kind,'verified');
  assert.equal(found.job.type,'Pleno');
  assert.equal(found.job.channel,'Glassdoor');
  assert.equal(found.job.location,'Curitiba, PR, Brasil');
  assert.deepEqual(found.job.skills,['Figma','Adobe Illustrator']);
  assert.equal(parsePage(ad({title:'Designer de Produto Júnior'}),original,{},user,now,settings).kind,'filtered');
  assert.equal(parsePage(ad({title:'Analista Contábil Pleno',description:'Contabilidade fiscal'}),original,{},user,now,settings).kind,'filtered');
});

test('aceita uma segunda localidade e verifica a elegibilidade para remoto',()=>{
  const lisbon=ad({jobLocation:'Lisboa, Portugal'});
  assert.equal(parsePage(lisbon,original,{},user,now,settings).job.location,'Lisboa, Portugal');
  const remote={jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{name:'Portugal'}};
  const found=parsePage(ad(remote),original,{},user,now,settings);
  assert.deepEqual(found.job.remoteLocations,['Portugal']);
  assert.equal(searchCoverage(found.job,settings.modes,{...radar,remoteLocations:['Brasil']}),false);
  assert.equal(parsePage(ad({...remote,applicantLocationRequirements:{name:'Estados Unidos'}}),original,{},user,now,settings).kind,'filtered');
  assert.equal(place({jobLocation:'Rio de Janeiro - RJ'},{},'').regionKey,'rio');
});

test('busca por palavras-chave, resolve um anúncio do Google e confirma a página do Glassdoor',async ()=>{
  const redirected='https://www.google.com/url?q='+encodeURIComponent(
    'https://www.glassdoor.com.br/partner/jobListing.htm?jobListingId=123456789'
  );
  const queries=[];
  const fetcher=async (address,options)=>{
    const target=new URL(address);
    if (target.hostname==='api.firecrawl.dev') {
      queries.push(JSON.parse(options.body).query);
      return Response.json({data:{web:[{url:redirected,title:'Designer de Produto Pleno'}]}});
    }
    if (address===original) return new Response(ad(),{headers:{'content-type':'text/html'}});
    return new Response('<html><title>Vagas</title></html>');
  };
  const report=await scan({settings,user,now,fetcher});
  assert.ok(queries.some((q)=>q.includes('Designer de Produto') && q.includes('Lisboa, Portugal')));
  assert.deepEqual(report.jobs.map(({sourceUrl,channel})=>[sourceUrl,channel]),[[original,'Glassdoor']]);
  assert.equal((await scan({settings,user,now,fetcher,importUrl:redirected})).kind,'verified');
  assert.equal((await scan({settings,user,now,fetcher,importUrl:'https://www.google.com/search?q=vagas'})).kind,'unverified');
  assert.ok(publicListings('indeed',settings,user).some(({url})=>new URL(url).searchParams.get('l')==='Curitiba, PR'));
});

test('usa o curso como termo e rejeita vagas expiradas ou sem candidatura verificável',()=>{
  const courseRadar={...radar,titles:[],areas:[],useCourse:true};
  assert.ok(fitRadar({title:'Analista Pleno',type:'Pleno',required:['Design Gráfico'],preferred:[],description:''},user,courseRadar,now));
  assert.equal(parsePage(ad({datePosted:'2026-09-01'}),original,{},user,now,settings).kind,'closed');
  const noLink=ad().replace('<a href="https://example.com/candidatura">Candidatar-se</a>','');
  assert.equal(parsePage(noLink,original,{},user,now,settings).kind,'unverified');
});
