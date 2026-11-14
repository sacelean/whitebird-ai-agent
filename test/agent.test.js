import test from 'node:test';
import assert from 'node:assert/strict';
import {parseToolChoice, askWhitebird, validateLocalUrl, chat} from '../src/agent.js';

test('model request disables Qwen thinking and rejects empty answers', async()=>{
  const fetchFn=async(url,options)=>{
    assert.equal(JSON.parse(options.body).chat_template_kwargs.enable_thinking,false);
    return {ok:true,json:async()=>({choices:[{message:{content:'Respuesta'}}]})};
  };
  assert.equal(await chat([],{fetchFn}),'Respuesta');
  await assert.rejects(chat([],{fetchFn:async()=>({ok:true,json:async()=>({choices:[{message:{content:''}}]})})}),/empty answer/);
});

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

test('team selection stays with the client and does not mutate server schemas', async()=>{
  const schema={type:'object',properties:{team:{type:'string'},limit:{type:'integer'}},required:['team']};
  const fake={listAllowedTools:()=>[{name:'list_events',inputSchema:schema}],
    callReadTool:async(name,args)=>{assert.deepEqual(args,{});return {events:[]}}};
  let turn=0;
  await askWhitebird('Próximos eventos',fake,{chatFn:async(messages)=>{
    if (++turn===1) {
      const exposed=JSON.parse(messages[0].content.split('input schema: ')[1]);
      assert.equal('team' in exposed.properties,false);
      assert.deepEqual(exposed.required,[]);
      return '{"tool":"list_events","arguments":{}}';
    }
    return 'No hay eventos.';
  }});
  assert.ok(schema.properties.team);
  assert.deepEqual(schema.required,['team']);
});

for (const question of ['¿que puedes hacer?', '¿QUÉ PUEDES HACER?', '  qué puedes hacer  ', 'Hola, ¿qué puedes hacer?', '¿Cómo puedes ayudarme?', 'ayuda', 'help']) {
  test(`help responds without model or WoWAudit calls: ${question}`, async () => {
    const client = {
      listAllowedTools: () => [{ name: 'list_events' }, { name: 'loot_history' }, { name: 'update_roster_members' }],
      callReadTool: () => assert.fail('Help must not call WoWAudit')
    };
    const result = await askWhitebird(question, client, { chatFn: () => assert.fail('Help must not call model') });
    assert.equal(result.tool, null);
    assert.match(result.answer, /próximos eventos/);
    assert.match(result.answer, /historial de loot/);
    assert.doesNotMatch(result.answer, /abalorios|update_roster_members/);
  });
}

test('help explains when no supported tools are available', async () => {
  const result = await askWhitebird('¿Qué puedes hacer?', { listAllowedTools: () => [] }, {
    chatFn: () => assert.fail('Help must not call model')
  });
  assert.equal(result.tool, null);
  assert.match(result.answer, /no tengo herramientas/);
});
