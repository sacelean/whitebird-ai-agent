import test from 'node:test';
import assert from 'node:assert/strict';
import {parseToolChoice, askWhitebird, validateLocalUrl} from '../src/agent.js';

test('model API cannot be remote',()=>{
  assert.throws(()=>validateLocalUrl('https://external.test/v1/chat/completions'), /loopback/);
  assert.equal(validateLocalUrl('http://127.0.0.1:8080/v1/chat/completions').hostname,'127.0.0.1');
});
test('rejects rogue model tools',()=>{
  assert.throws(()=>parseToolChoice('{"tool":"update_roster_members","arguments":{}}',['team_audit']), /forbidden/);
});
test('agent calls one permitted tool then synthesizes', async()=>{
  const calls=[];
  const fake={listAllowedTools:()=>[{name:'loot_history',description:'Loot history',inputSchema:{type:'object',properties:{from:{type:'string'}}}}],
    callReadTool:async(name,args)=>{calls.push({name,args});return {records:[{character:'Raider A',item:'item X'}]}}};
  let turn=0;
  const r=await askWhitebird('¿Qué loot hemos recibido?',fake,{chatFn:async()=>++turn===1?'{"tool":"loot_history","arguments":{}}':'Raider A recibió item X.'});
  assert.equal(r.tool,'loot_history'); assert.equal(calls.length,1);
  assert.match(r.answer,/Raider A/);
});
