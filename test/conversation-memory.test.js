import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationMemory} from '../src/conversation-memory.js';
import {askWhitebird} from '../src/agent.js';
import {createAgentServer} from '../src/server.js';
import {createDiscordHandler,discordConfig} from '../src/discord.js';
const user='123456789012345678',guild='223456789012345678',channel='323456789012345678';
const options={actor:`discord:${guild}:${user}`,conversationId:`discord:${channel}`};
const noModel=()=>assert.fail('Deterministic loot follow-ups must not call the model');
function fixture(){
 const calls=[];let changed=false;
 const client={listAllowedTools:()=>[{name:'loot_history',inputSchema:{properties:{limit:{maximum:200},from:{type:'string'},to:{type:'string'},character:{type:'string'}}}},{name:'list_roster'},{name:'get_character',inputSchema:{properties:{character:{type:'string'}}}}],callReadTool:async(tool,args)=>{
  calls.push({tool,args});
  if(tool==='get_character')return {character:{id:123,name:'Uno',realm:'realm'}};
  if(tool==='list_roster')return {size:3,members:['Uno','Dos','Cero'].map((name,id)=>({character:{id:id+1,name,realm:'realm'}}))};
  return {from:args.from||'2026-10-16',to:args.to||'2026-11-15',total:3,loot:[{character:'Uno',item:'A'},{character:args.character?'Uno':'Dos',item:'B'},{character:changed?'Dos':'Uno',item:'C'}]};
 }};
 const memory=createConversationMemory();
 const ask=(q,opts=options)=>memory.ask(q,client,{...opts,chatFn:noModel},askWhitebird);
 return {client,calls,memory,ask,change:()=>{changed=true;}};
}
test('more → less retains the exact source period, fetches again and includes roster zeroes',async()=>{
 const f=fixture();assert.match((await f.ask('quien ha looteado mas')).answer,/Uno encabeza/);
 f.change();const result=await f.ask('¿Y el que menos?');assert.match(result.answer,/Cero es quien menos recibió, con 0/);
 assert.deepEqual(f.calls[1],{tool:'loot_history',args:{limit:200,from:'2026-10-16',to:'2026-11-15'}});assert.equal(f.calls[2].tool,'list_roster');
 const again=await f.ask('y el que más');assert.match(again.answer,/Dos encabeza/);assert.equal(f.calls.filter(c=>c.tool==='loot_history').length,3);
});
test('period and character follow-ups update only the requested filter',async()=>{
 const f=fixture();await f.ask('quien ha looteado mas este mes');const first=f.calls[0].args;assert.match(first.from,/^\d{4}-\d{2}-01$/);
 await f.ask('y el que menos');assert.deepEqual(f.calls[1].args,first);
 await f.ask('y Uno');assert.equal(f.calls.at(-1).args.character,'123');assert.equal(f.calls.at(-1).args.from,first.from);
 await f.ask('y mes pasado');assert.notEqual(f.calls.at(-1).args.from,first.from);
});
test('users, guilds, channels, panels and selected projects do not share context',async()=>{
 const f=fixture();await f.ask('quien ha looteado mas');
 for(const opts of [{...options,actor:`discord:${guild}:423456789012345678`},{...options,actor:`discord:523456789012345678:${user}`},{...options,conversationId:'discord:623456789012345678'},{actor:'panel:csrf',conversationId:'panel:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{...options,project:'recruitment'},{actor:'api',conversationId:options.conversationId}]){
  const result=await f.ask('y el que menos',opts);assert.match(result.answer,/No tengo contexto reciente/);
 }
 assert.equal(f.calls.length,1);
});
test('expiry, restart, reset, capacity and topic changes clear references without replaying results',async()=>{
 let now=0;const memory=createConversationMemory({now:()=>now,ttlMs:900000,maxEntries:2});let calls=0;
 const ask=async(_q,_c,o)=>{calls++;o.onQueryContext({kind:'loot',arguments:{limit:200,from:'2026-10-16',to:'2026-11-15'},direction:'mas'});return {tool:'loot_history',answer:'fresh'};};
 const run=(q,opts=options)=>memory.ask(q,{},opts,ask);
 await run('loot');now=900000;assert.match((await run('y el que menos')).answer,/No tengo contexto/);assert.equal(calls,1);assert.equal(memory.size(),0);
 await run('loot');await run('olvida el contexto');assert.equal(memory.size(),0);assert.match((await run('y el que menos')).answer,/No tengo contexto/);
 await run('loot');await memory.ask('Recruitment',{},options,async()=>({tool:null,answer:'help'}));assert.match((await run('y el que menos')).answer,/No tengo contexto/);
 await run('loot');await run('loot',{...options,conversationId:'discord:423456789012345678'});await run('loot',{...options,conversationId:'discord:523456789012345678'});assert.equal(memory.size(),2);assert.match((await run('y el que menos')).answer,/No tengo contexto/);
 memory.clear();assert.equal(memory.size(),0);assert.equal(createConversationMemory().size(),0);
});
test('ambiguous continuations ask for clarification without calling tools',async()=>{
 const f=fixture();await f.ask('quien ha looteado mas');const count=f.calls.length;
 assert.match((await f.ask('y por qué ocurre eso')).answer,/No puedo interpretar/);assert.equal(f.calls.length,count);
 assert.match((await f.ask('y reinícialo')).answer,/No puedo interpretar/);assert.equal(f.calls.length,count);
});
test('roster failures, duplicate names and partial loot never fabricate a minimum',async()=>{
 for(const roster of [{size:3,members:[]},{size:2,members:[{character:{name:'Uno'}},{character:{name:'Uno'}}]},{size:1,members:[{character:{name:'Uno'}}],partial:true}]){
  const f=fixture(),call=f.client.callReadTool;f.client.callReadTool=(tool,args)=>tool==='list_roster'?Promise.resolve(roster):call(tool,args);
  const result=await f.ask('quien ha looteado menos');assert.doesNotMatch(result.answer,/es quien menos recibió|Empatan/);
 }
 const f=fixture();f.client.callReadTool=async()=>({from:'2026-10-16',to:'2026-11-15',total:201,loot:[]});assert.match((await f.ask('quien ha looteado menos')).answer,/incompleto/);
});
test('bot data continuations retain character and period without calling the model',async()=>{
 const memory=createConversationMemory();const calls=[];
 const panelClient={call:async(tool,args)=>{calls.push({tool,args});return {available:true,total:0,acceptedCompleted:0,rejectedCompleted:0,acceptedPending:0,rejectedPending:0};}};
 const run=q=>memory.ask(q,{}, {...options,panelClient,chatFn:noModel},askWhitebird);
 await run('cuantos applies de "Uno" desde 2026-11-01 hasta 2026-11-05');await run('y Dos');
 assert.deepEqual(calls[1].args,{project:'recruitment',character:'Dos',from:'2026-11-01',to:'2026-11-05'});
});
test('Discord HTTP conversation survives turns while preserving private replies and authorization',async t=>{
 const f=fixture(),token='x'.repeat(32),memory=createConversationMemory();
 const server=createAgentServer({client:f.client,token,memory,ask:(q,c,o)=>askWhitebird(q,c,{...o,chatFn:noModel})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const config=discordConfig({DISCORD_BOT_TOKEN:'fake',DISCORD_APPLICATION_ID:'723456789012345678',DISCORD_GUILD_ID:guild,DISCORD_CHANNEL_IDS:channel,DISCORD_ROLE_IDS:'823456789012345678',AGENT_API_TOKEN:token,DISCORD_AGENT_URL:`http://127.0.0.1:${server.address().port}`});
 let now=0;const handler=createDiscordHandler(config,{now:()=>now});
 const run=async question=>{const messages=[];await handler({isChatInputCommand:()=>true,commandName:'whitebird-ask',guildId:guild,channelId:channel,member:{roles:config.roles},user:{id:user},options:{getString:()=>question},deferReply:async m=>messages.push(m),editReply:async m=>messages.push(m),reply:async m=>messages.push(m)});return messages;};
 await run('quien ha looteado mas');now=31000;const messages=await run('y el que menos');assert.equal(messages[0].flags,64);assert.match(messages[1].content,/Cero es quien menos recibió/);assert.deepEqual(messages[1].allowedMentions,{parse:[]});
 now=62000;await run('olvida el contexto');assert.equal(memory.size(),0);
});

test('a retained Discord subject is re-resolved after a link changes',async()=>{
 const f=fixture();let character='Uno',lookups=0;
 const panelClient={call:async()=>{lookups++;return {available:true,status:'resolved',guildId:guild,character,realm:'realm'};}};
 const original=f.client.callReadTool;
 f.client.callReadTool=async(tool,args)=>{
  if(tool==='get_character')return {character:{id:character==='Uno'?123:456,name:character,realm:'realm'}};
  if(args.character)return {from:args.from||'2026-10-16',to:args.to||'2026-11-15',total:1,loot:[{character,item:'Objeto'}]};
  return original(tool,args);
 };
 const run=q=>f.memory.ask(q,f.client,{...options,panelClient,chatFn:noModel},askWhitebird);
 await run(`cuantos items ha looteado <@${user}>`);character='Dos';const result=await run('y este mes');
 assert.equal(lookups,2);assert.match(result.answer,/Dos-realm tiene 1 ítem/);
});

test('general WoWAudit follow-ups use typed context without storing or reusing response text',async()=>{
 const memory=createConversationMemory();let turn=0;const prompts=[];let calls=0;
 const client={listAllowedTools:()=>[{name:'list_events',inputSchema:{properties:{from:{type:'string'}}}}],callReadTool:async()=>{calls++;return {events:[],message:'PRIVATE_RESULT'};}};
 const chatFn=async messages=>{prompts.push(messages);return ++turn%2?' {"tool":"list_events","arguments":{}}':'No hay eventos.';};
 const run=q=>memory.ask(q,client,{...options,chatFn},askWhitebird);
 await run('Proximos eventos');await run('y esta semana');assert.equal(calls,2);
 const decision=prompts[2];assert.ok(decision.some(m=>m.content.includes('"kind":"mcp"')));assert.ok(!decision.some(m=>m.content.includes('PRIVATE_RESULT')));
});
