#!/usr/bin/env node
const fs=require('fs');
const catalog=JSON.parse(fs.readFileSync('data/source-catalog.json','utf8'));
const health=JSON.parse(fs.readFileSync('data/source-health.json','utf8'));
const cross=JSON.parse(fs.readFileSync('data/source-cross-validation.json','utf8'));
const required=['rain','ina','snih','salto','nasa','geoglows','viirs','opera','gfm','floodhub','magyp','smn'];
const statuses=new Set(['Producción','Validada','En validación','Experimental','Pendiente']);
const confidence=new Set(['Muy alto','Alto','Medio','Bajo','Experimental']);
const natures=new Set(['Observado propio','Observado externo','Preliminar externo','Modelado','Satelital','Administrativo']);
for(const id of required) if(!catalog.some(x=>x.id===id)) throw Error(`Falta ${id}`);
for(const s of catalog){
  for(const key of ['id','name','group','nature','status','provider','resolutionSpatial','resolutionTemporal','coverage','updateFrequency','limitations','methodology','confidenceLevel']) if(s[key]===undefined||s[key]===null||s[key]==='') throw Error(`${s.id}: falta ${key}`);
  if(!statuses.has(s.status)||!confidence.has(s.confidenceLevel)||!natures.has(s.nature)) throw Error(`${s.id}: clasificación inválida`);
  if(!Array.isArray(s.limitations)||!s.limitations.length) throw Error(`${s.id}: limitaciones vacías`);
  if(s.status!=='Pendiente' && (!/^https:\/\//.test(s.sourceUrl)||!s.documentationUrl)) throw Error(`${s.id}: URL oficial o documentación inválida`);
}
for(const h of health){if(!catalog.some(s=>s.id===h.id)||!['OK','WARNING','ERROR','UNAVAILABLE'].includes(h.status)||!h.lastValidation) throw Error(`${h.id}: salud inválida`)}
if(cross.schemaVersion!==1||!Array.isArray(cross.events)) throw Error('Validación cruzada inválida');
console.log(`Auditoría de fuentes: ${catalog.length} fichas y ${health.length} estados válidos.`);
