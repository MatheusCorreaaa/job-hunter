'use strict';

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const asArray = (value) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const regionNames = new Intl.DisplayNames('pt-BR',{type:'region',fallback:'none'});
const englishRegions = new Intl.DisplayNames('en',{type:'region',fallback:'none'});
const spanishRegions = new Intl.DisplayNames('es',{type:'region',fallback:'none'});
const regions = new Map([
  ['uk','GB'],['eua','US'],['usa','US'],['united states of america','US'],['estados unidos da america','US'],
  ['england','GB'],['scotland','GB'],['wales','GB'],['northern ireland','GB'],['republic of ireland','IE']
]);

for (let first=65; first<=90; first++) {
  for (let second=65; second<=90; second++) {
    const code=String.fromCharCode(first,second);
    if (['EU','EZ','UN','QO','XA','XB','ZZ','XK','AC','CP','DG','EA','IC','TA','UK','SU','AN','BU','DD','FX','YD','YU','ZR','CS','TP','NT'].includes(code)) continue;
    const label=regionNames.of(code);
    if (!label) continue;
    regions.set(normalize(code),code);
    for (const name of [label,englishRegions.of(code),spanishRegions.of(code)]) {
      if (name) regions.set(normalize(name),code);
    }
  }
}

function asLabel(value) {
  return typeof value==='string' ? value.trim() : typeof value?.name==='string' ? value.name.trim() : '';
}

function countryCode(value) {
  return regions.get(normalize(asLabel(value))) || '';
}

function addressesOf(posting) {
  return asArray(posting.jobLocation).flatMap((entry)=>{
    const address=entry?.address;
    if (address && typeof address==='object') {
      return [{
        city:asLabel(address.addressLocality),
        state:asLabel(address.addressRegion),
        country:countryCode(address.addressCountry)
      }];
    }
    const label=asLabel(address) || asLabel(entry);
    if (!label) return [];
    const parts=label.split(/\s*,\s*/);
    const country=countryCode(parts.at(-1));
    if (country) return [{city:parts.length>1?parts[0]:'',state:'',country}];
    const brazil=label.match(/^(Rio de Janeiro|São Paulo)\s*[-,]\s*(RJ|SP)$/i);
    return brazil ? [{city:brazil[1],state:brazil[2],country:'BR'}] : [];
  });
}

function isCity(address, city, state, listing) {
  const place=normalize(address.city);
  const region=normalize(address.state);
  if (address.country && address.country!=='BR') return false;
  const hasState=region===state || region==='br-'+state || region===city;
  const townNamed=new RegExp('\\b(?:presencial|hibrid[oa])\\s*(?:(?:em|no)\\s+)?'+city+'\\b|\\b(?:local(?: de trabalho)?|cidade)\\s*:\\s*'+city+'\\b').test(listing);
  return (place===city || place===city+' e regiao' && townNamed) &&
    (hasState || !region&&address.country==='BR');
}

function targetCoversBrazil(target) {
  return countryCode(target)==='BR' ||
    /\b(?:worldwide|global|anywhere|mundial|qualquer pais|latin america|america latina|latam|south america|america do sul)\b/.test(normalize(asLabel(target)));
}

function place(posting, candidate, listing) {
  listing=normalize(listing);
  const addresses=addressesOf(posting);
  if (candidate.city && candidate.state && candidate.sourceId==='gupy') {
    addresses.push({city:candidate.city,state:candidate.state,country:'BR'});
  }
  const targets=asArray(posting.applicantLocationRequirements);
  const foreign=addresses.find((address)=>address.country && address.country!=='BR');
  const workplace=normalize(candidate.workplaceType);
  const onSite=workplace==='on-site' || /\b(?:modelo(?: de trabalho)?|modalidade|regime)\s*[:-]?\s*presencial\b/.test(listing);
  const hybrid=workplace==='hybrid' || !workplace && !onSite &&
    /(?:modelo(?: de trabalho)?|modalidade|trabalho|regime|formato|vaga|atuacao)\s*[:\-]?\s*hibrid[oa]|\bhibrid[oa] (?:em (?:nosso|rio de janeiro|sao paulo)|workplace)\b|\btrabalho remoto\s*[:-]?\s*hibrid[oa]|\bhybrid (?:workplace|schedule|position|role|work model)\b|\b(?:work arrangement|workplace type|work model)[:\s]+hybrid\b/.test(listing);
  const remote=workplace==='remote' || !workplace && !onSite && (
    normalize(posting.jobLocationType)==='telecommute' ||
    /(?:modalidade|modelo(?: de trabalho)?|trabalho|regime|formato)\s*[:\-]?\s*(?:100% )?remot[oa]|100% remot[oa]|100% home office|remoto,? brasil|work model:\s*remote|fully remote|work from anywhere|remote worldwide|remote \(worldwide\)|anywhere remote/.test(listing));
  if (remote && !hybrid) {
    const brazilianAddress=addresses.some((address)=>address.country==='BR');
    const explicitBrazil=/\b(?:remot[oa]|home office)\b[^.!?]{0,25}\b(?:brasil|brazil)\b|todo o brasil|basead[oa] no brasil|based in brazil/.test(listing);
    const worldwide=/\b(?:worldwide|anywhere in the world|work from anywhere|remot[oa] mundia[lm]|qualquer pais|global remote|remote global|america latina|latin america|latam|south america)\b/.test(listing);
    const excludesBrazil=/(?:excluding|except|exceto|fora d[oe])\s+(?:the\s+)?(?:brazil|brasil)\b|\b(?:brazil|brasil)\s+(?:is )?(?:not eligible|not supported|excluded|inelegivel|excluido)\b/.test(listing);
    const restrictedElsewhere=/(?:residir|residencia|somente para candidatos|must (?:reside|be based|be located)|based only in|remote (?:only )?(?:within|from))[^.!?]{0,35}(?:sao paulo|minas gerais|parana|curitiba|porto alegre|united states|\busa\b|\bus only\b|canada|germany|portugal|united kingdom|\buk only\b|europe only)/.test(listing);
    const regionalRemote=/\bremote\s*(?:only\s+)?(?:(?:in|within|from)\s+|[-:(]\s*)?(?:united states|usa|us only|canada|uk only|portugal|germany|europe)\b/.test(listing);
    const eligible=targets.length ? targets.some(targetCoversBrazil) :
      explicitBrazil || worldwide || brazilianAddress || (workplace==='remote'&&candidate.sourceId==='gupy');
    if (!eligible || excludesBrazil || (restrictedElsewhere||regionalRemote&&!worldwide)&&!explicitBrazil&&!targets.some(targetCoversBrazil)) return null;
    if (foreign || worldwide&&!brazilianAddress&&!explicitBrazil) {
      const origin=foreign ? regionNames.of(foreign.country) : 'Internacional';
      return {mode:'Remoto',location:origin+' · aceita Brasil',regionKey:'international',country:foreign?.country||null};
    }
    return {mode:'Remoto',location:'Brasil',regionKey:'br',country:'BR'};
  }
  const rio=addresses.some((address)=>isCity(address,'rio de janeiro','rj',listing));
  if (rio) return {mode:hybrid?'Híbrido':'Presencial',location:'Rio de Janeiro, RJ',regionKey:'rio',country:'BR'};
  const saoPaulo=addresses.some((address)=>isCity(address,'sao paulo','sp',listing));
  if (saoPaulo && hybrid) return {mode:'Híbrido',location:'São Paulo, SP',regionKey:'sp',country:'BR'};
  if (!foreign) return null;
  const country=regionNames.of(foreign.country);
  const city=foreign.city && normalize(foreign.city)!==normalize(country) ? foreign.city+', ' : '';
  return {mode:hybrid?'Híbrido':'Presencial',location:city+country,regionKey:'international',country:foreign.country};
}

function coverageAllows(job, settings) {
  if (!settings.modes.includes(job.mode)) return false;
  if (job.regionKey==='sp') return settings.includeSaoPaulo!==false;
  if (job.regionKey==='international') return settings.includeInternational!==false;
  return true;
}

function authorizationNotes(lines) {
  return [...new Set(lines.filter((line)=>
    /\b(?:visa sponsorship|sponsor.{0,15}visa|work authori[sz]ation|authori[sz]ed to work|eligib.{0,14}to work|right to work|work permit|visa requirements|visto de trabalho|autorizacao (?:legal )?(?:para |de )trabalh(?:ar|o)|permissao (?:de |para )trabalh(?:ar|o))\b/.test(normalize(line))
  ))].slice(0,5);
}

module.exports={place,coverageAllows,authorizationNotes};
