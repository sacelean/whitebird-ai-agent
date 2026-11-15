import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projects } from '../src/project-knowledge.js';
import { createContextKnowledge, validateKnowledge } from '../src/context-knowledge.js';
import { projectHelp } from '../src/project-help.js';
const fixture = () => ({ schemaVersion: 1, reviewedAt: '2026-11-15', projects: projects.map(p => ({id:p.id,source:p.source,implementedRevision:'tested',deployedRevision:null,summary:p.summary,overview:p.overview,topics:p.topics.map(t=>t.text)})) });
test('local publication reloads without restarting and survives missing source and process restart', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'context-'));
 try {
  const filePath=join(dir,'bots.json'),cachePath=join(dir,'cache.json');
  const value=fixture();
  await writeFile(filePath,JSON.stringify(value));
  const service=createContextKnowledge({filePath,cachePath});
  await service.refresh();
  value.projects[1].overview='Nuevo flujo documentado';
  await writeFile(join(dir,'next.json'),JSON.stringify(value));
  await rename(join(dir,'next.json'),filePath);
  await service.refresh();
  assert.match(projectHelp('¿Cómo funciona Recruitment?',undefined,service.snapshot()).answer,/Nuevo flujo documentado/);
  assert.equal(JSON.parse(await readFile(cachePath,'utf8')).catalog.schemaVersion,1);
  await rm(filePath);await service.refresh();
  assert.match(projectHelp('¿Cómo funciona Recruitment?',undefined,service.snapshot()).answer,/copia local/);
  const restarted=createContextKnowledge({filePath,cachePath});
  const stop=await restarted.start();stop();
  assert.equal(restarted.snapshot().catalog.projects[1].overview,'Nuevo flujo documentado');
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('malformed, incomplete and oversized files cannot replace known good context',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'context-invalid-'));
 try {
  const filePath=join(dir,'bots.json');
  await writeFile(filePath,JSON.stringify(fixture()));
  const service=createContextKnowledge({filePath});await service.refresh();
  const original=service.snapshot().catalog;
  for(const raw of ['{',JSON.stringify({schemaVersion:2}),JSON.stringify({junk:'a'.repeat(270000)})]) {
   await writeFile(filePath,raw);await service.refresh();assert.equal(service.snapshot().catalog,original);
  }
  assert.throws(()=>validateKnowledge({...fixture(),projects:[]}));
  const unavailable=createContextKnowledge({filePath:join(dir,'absent')});
  await unavailable.refresh();assert.match(projectHelp('¿Cómo funciona Recruitment?',undefined,unavailable.snapshot()).answer,/respaldo/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
