'use strict';

const {matchesLocation,searchCoverage}=require('./src/workflow.js');
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const asArray = (value) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const regionNames = new Intl.DisplayNames('pt-BR',{type:'region',fallback:'none'});
let regions;

function regionCodes() {
  const englishRegions=new Intl.DisplayNames('en',{type:'region',fallback:'none'});
  const spanishRegions=new Intl.DisplayNames('es',{type:'region',fallback:'none'});
  const codes=new Map([
    ['uk','GB'],['eua','US'],['usa','US'],['united states of america','US'],['estados unidos da america','US'],
    ['england','GB'],['scotland','GB'],['wales','GB'],['northern ireland','GB'],['republic of ireland','IE']
  ]);
  const ignored=new Set(['EU','EZ','UN','QO','XA','XB','ZZ','XK','AC','CP','DG','EA','IC','TA','UK','SU','AN','BU','DD','FX','YD','YU','ZR','CS','TP','NT']);
  for (let first=65; first<=90; first++) {
    for (let second=65; second<=90; second++) {
      const code=String.fromCharCode(first,second);
      if (ignored.has(code)) continue;
      const label=regionNames.of(code);
      if (!label) continue;
      codes.set(normalize(code),code);
      for (const name of [label,englishRegions.of(code),spanishRegions.of(code)]) {
        if (name) codes.set(normalize(name),code);
      }
    }
  }
  return codes;
}

function asLabel(value) {
  return typeof value==='string' ? value.trim() : typeof value?.name==='string' ? value.name.trim() : '';
}

function countryCode(value) {
  const label=normalize(asLabel(value));
  if (!label) return '';
  regions ||= regionCodes();
  return regions.get(label) || '';
}

const brazilianStates=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const stateNames='acre|alagoas|amapa|amazonas|bahia|ceara|distrito federal|espirito santo|goias|maranhao|mato grosso|mato grosso do sul|minas gerais|para|paraiba|parana|pernambuco|piaui|rio de janeiro|rio grande do norte|rio grande do sul|rondonia|roraima|santa catarina|sao paulo|sergipe|tocantins'.split('|');
const stateCodes=new Map(stateNames.map((name,index)=>[name,[...brazilianStates][index]]));

function addressesOf(posting) {
  return asArray(posting.jobLocation).flatMap((entry)=>{
    const address=entry?.address;
    if (address && typeof address==='object') {
      const state=asLabel(address.addressRegion);
      const country=countryCode(address.addressCountry);
      const brazil=country==='BR' || !country && (stateCodes.has(normalize(state)) || brazilianStates.has(state.toUpperCase()));
      return [{
        city:asLabel(address.addressLocality),
        state:brazil?(stateCodes.get(normalize(state)) || state.toUpperCase()):state,
        country:brazil?'BR':country
      }];
    }
    const label=asLabel(address) || asLabel(entry);
    if (!label) return [];
    const parts=label.split(/\s*,\s*|\s+-\s+/);
    const state=parts.at(-1);
    if (parts.length===2 && (brazilianStates.has(state.toUpperCase()) || stateCodes.has(normalize(state)))) {
      return [{city:parts[0],state:stateCodes.get(normalize(state)) || state.toUpperCase(),country:'BR'}];
    }
    const country=countryCode(parts.at(-1));
    if (country) return [{city:parts.length>1?parts[0]:'',state:parts.length>2?parts[1]:'',country}];
    return [{city:parts[0],state:state===parts[0]?'':state,country:''}];
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

function place(posting, candidate, listing, radar) {
  listing=normalize(listing);
  const addresses=addressesOf(posting);
  if (candidate.city && candidate.state && candidate.sourceId==='gupy') {
    addresses.push({city:candidate.city,state:candidate.state,country:'BR'});
  }
  const targets=asArray(posting.applicantLocationRequirements);
  const foreign=addresses.find((address)=>address.country && address.country!=='BR');
  const workplace=normalize(candidate.workplaceType);
  const onSite=workplace==='on-site' || /\b(?:modelo(?: de trabalho)?|modalidade|regime)\s*[:-]?\s*presencial\b/.test(listing);
  const hybrid=workplace==='hybrid' || normalize(posting.jobLocationType)==='hybrid' || !workplace && !onSite &&
    /(?:modelo(?: de trabalho)?|modalidade|trabalho|regime|formato|vaga|atuacao)\s*[:\-]?\s*hibrid[oa]|\bhibrid[oa] (?:em (?:nosso|rio de janeiro|sao paulo)|workplace)\b|\btrabalho remoto\s*[:-]?\s*hibrid[oa]|\bhybrid (?:workplace|schedule|position|role|work model)\b|\b(?:work arrangement|workplace type|work model)[:\s]+hybrid\b/.test(listing);
  const remote=workplace==='remote' || !workplace && !onSite && (
    normalize(posting.jobLocationType)==='telecommute' ||
    /(?:modalidade|modelo(?: de trabalho)?|trabalho|regime|formato)\s*[:\-]?\s*(?:100% )?remot[oa]|100% remot[oa]|100% home office|remoto,? brasil|work model:\s*remote|fully remote|work from anywhere|remote worldwide|remote \(worldwide\)|anywhere remote/.test(listing));
  if (radar) {
    const placeLabel=({city,state,country})=>[...new Set([city,state,country && regionNames.of(country)].filter(Boolean))].join(', ');
    if (!remote || hybrid) {
      const locations=addresses.map(placeLabel).filter(Boolean);
      const location=locations.find((label)=>radar.locations.some((selected)=>matchesLocation(label,selected)));
      return location?{mode:hybrid?'Híbrido':'Presencial',location,locations,regionKey:'custom'}:null;
    }
    const world=/\b(worldwide|anywhere in the world|work from anywhere|qualquer pais|remot[oa] global)\b/;
    const exclusion=/(?:except|excluding|exceto|exclui|fora d[oe])\s+([^.;]+)/;
    const restricted=listing.match(/(?:must (?:be based|reside|be located)|somente para candidatos|remote only|residir)\s+(?:in |em |no |na |from |within )?([^.;]+)/)?.[1];
    const explicit=listing.match(/(?:^|\b)(?:remot[oa]|remote)(?:\s+(?:em|no|na|in|from|within))?\s*[-:,]?\s*([^.;]+)/)?.[1];
    const labels=targets.map((target)=>countryCode(target)?regionNames.of(countryCode(target)):asLabel(target));
    const unrestricted=!restricted && (labels.length?labels.some((label)=>world.test(normalize(label))):world.test(listing));
    const eligible=radar.remoteLocations.filter((selection)=>{
      const label=countryCode(selection)?regionNames.of(countryCode(selection)):selection;
      if (matchesLocation(listing.match(exclusion)?.[1],label)) return false;
      if (restricted && !matchesLocation(restricted,label)) return false;
      if (unrestricted || labels.some((target)=>matchesLocation(target,label))) return true;
      if (labels.length) return false;
      return matchesLocation(restricted || explicit,label) ||
        (!restricted && (addresses.some((address)=>matchesLocation(placeLabel(address),label)) ||
          (label==='Brasil' && workplace==='remote' && candidate.sourceId==='gupy')));
    });
    return eligible.length?{mode:'Remoto',location:eligible.join(' / '),remoteLocations:eligible,regionKey:'custom'}:null;
  }
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
  if (!searchCoverage(job,settings.modes,settings.radar)) return false;
  if (settings.radar) return true;
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
