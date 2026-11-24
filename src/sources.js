'use strict';

const JOB_SOURCES = [
  {id:'gupy', name:'Gupy', url:'https://portal.gupy.io/', logo:'gupy.png', description:'Portal de carreiras e candidaturas'},
  {id:'jobbol', name:'Jobbol', url:'https://www.jobbol.com.br/', logo:'jobbol.png', description:'Vagas publicadas no portal'},
  {id:'linkedin', name:'LinkedIn', url:'https://www.linkedin.com/jobs/', logo:'linkedin.png', description:'Vagas públicas e páginas de empresas'},
  {id:'indeed', name:'Indeed', url:'https://br.indeed.com/', logo:'indeed.png', description:'Vagas públicas e anúncios de empresas'},
  {id:'riovagas', name:'RioVagas', url:'https://riovagas.com.br/', logo:'riovagas.png', description:'Publicações de emprego e estágio no Rio'},
  {id:'vagas', name:'Vagas.com', url:'https://www.vagas.com.br/', logo:'vagas.png', description:'Vagas corporativas e programas de estágio'},
  {id:'superestagios', name:'Super Estágios', url:'https://www.superestagios.com.br/vagas/', logo:'superestagios.png', description:'Estágios por cidade e curso'},
  {id:'empregos', name:'Empregos.com.br', url:'https://www.empregos.com.br/', logo:'empregos.png', description:'Vagas por cargo, empresa e região'},
  {id:'catho', name:'Catho', url:'https://www.catho.com.br/', logo:'catho.png', searchable:false, description:'Vagas de emprego e estágio · acesso manual'},
  {id:'infojobs', name:'Infojobs', url:'https://www.infojobs.com.br/', logo:'infojobs.png', description:'Vagas públicas e páginas de empresas'},
  {id:'solides', name:'Sólides Vagas', url:'https://vagas.solides.com.br/', domains:['solides.com.br','solides.jobs'], logo:'solides.png', description:'Vagas em empresas que recrutam pela Sólides'},
  {id:'glassdoor', name:'Glassdoor', url:'https://www.glassdoor.com.br/', domains:['glassdoor.com.br','glassdoor.com','glassdoor.co.uk','glassdoor.ca','glassdoor.de','glassdoor.fr','glassdoor.ie','glassdoor.es','glassdoor.com.au'], logo:'glassdoor.png', description:'Anúncios no Brasil e no exterior'},
  {id:'99jobs', name:'99jobs', url:'https://www.99jobs.com/', logo:'99jobs.png', searchable:false, description:'Vagas e programas de estágio e trainee · acesso manual'},
  {id:'jooble', name:'Jooble', url:'https://br.jooble.org/', domains:['jooble.org'], logo:'jooble.png', description:'Busca de vagas no Brasil e no exterior'}
];

if (typeof module === 'object') module.exports = JOB_SOURCES;
