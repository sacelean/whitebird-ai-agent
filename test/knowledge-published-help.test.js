import test from 'node:test';
import assert from 'node:assert/strict';
import { projects } from '../src/project-knowledge.js';
import { projectHelp } from '../src/project-help.js';
test('a source collection failure shows the last published help with a warning',()=>{
 const p=projects.find(p=>p.id==='recruitment');
 const entry={...p,collectionUnavailable:true,implementedRevision:'a'.repeat(40),deployedRevision:'a'.repeat(40),topics:p.topics.map(t=>t.text)};
 const context={catalog:{reviewedAt:'2026-11-15',projects:[entry]},stale:false};
 const result=projectHelp('¿Cómo funciona Recruitment?',undefined,context);
 assert.match(result.answer,/New Apply/);
 assert.match(result.answer,/Fuente no disponible/);
});
