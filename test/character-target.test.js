import test from 'node:test';
import assert from 'node:assert/strict';
import {askWhitebird} from '../src/agent.js';
const user='123456789012345678',guild='223456789012345678';
const lootTool={name:'loot_history',inputSchema:{properties:{character:{type:'string'},limit:{type:'integer',maximum:200}}}};
const characterTool={name:'get_character',inputSchema:{properties:{character:{type:'string'},include_gear:{type:'boolean'}}}};
const noModel=()=>assert.fail('No model for character loot counts');
function fixture(){
 const calls=[];
 const panelClient={call:async(tool,args,actor)=>{calls.push({source:'panel',tool,args,actor});return {available:true,status:'resolved',guildId:guild,character:'Raíder',realm:'zuljin'};}};
 const client={listAllowedTools:()=>[lootTool,characterTool],callReadTool:async(tool,args)=>{
  calls.push({source:'mcp',tool,args});
  if(tool==='get_character')return {character:{id:123,name:'Raíder',realm:"Zul'jin"}};
  assert.equal(args.character,'123');return {from:'2026-10-16',to:'2026-11-15',total:2,loot:[{character:'Raíder',item:'Espada'},{character:'Raíder',item:'Anillo'}]};
 }};
 return {calls,panelClient,client};
}
test('Discord mentions resolve their current linked main and realm before querying WoWAudit by id',async()=>{
 for(const token of [`<@${user}>`,`<@!${user}>`]){
  const f=fixture(),actor=`discord:${guild}:323456789012345678`;
  const result=await askWhitebird(`cuantos items ha looteado ${token}`,f.client,{panelClient:f.panelClient,actor,chatFn:noModel});
  assert.match(result.answer,/Raíder-Zul'jin tiene 2 ítems registrados/);assert.match(result.answer,/No incluye sus alters/);
  assert.deepEqual(f.calls[0],{source:'panel',tool:'wow_resolve_user',args:{project:'wow',userId:user},actor});
  assert.deepEqual(f.calls[1].args,{character:'Raíder-zuljin',include_gear:false});assert.deepEqual(f.calls[2].args,{limit:200,character:'123'});
 }
});
test('bare and quoted character names query WoWAudit directly without Discord resolution',async()=>{
 for(const name of ['Raíder','"Raíder"','Raíder-zuljin']){
  const f=fixture();const result=await askWhitebird(`¿Cuántos ítems ha looteado ${name}?`,f.client,{panelClient:{call:noModel},chatFn:noModel});
  assert.match(result.answer,/tiene 2 ítems/);assert.equal(f.calls.length,2);assert.equal(f.calls[0].args.character,name.replaceAll('"',''));
 }
});
test('unresolved, ambiguous, malformed or cross-guild mentions never reach model or MCP',async()=>{
 for(const response of [{available:false},{available:true,status:'not_found'},{available:true,status:'ambiguous'},{available:true,status:'resolved',guildId:'other',character:'Raíder',realm:'zuljin'}]){
  const result=await askWhitebird(`cuantos items ha looteado <@${user}>`,{listAllowedTools:noModel},{panelClient:{call:async()=>response},actor:`discord:${guild}:323456789012345678`,chatFn:noModel});
  assert.doesNotMatch(result.answer,/tiene \d/);
 }
 for(const text of ['@Raíder',`<@&${user}>`,'@everyone',`<@${user}> y <@423456789012345678>`]){
  const result=await askWhitebird('cuantos items ha looteado '+text,{listAllowedTools:noModel},{panelClient:{call:noModel},chatFn:noModel});assert.ok(result.answer);
 }
 const mixed=fixture();assert.match((await askWhitebird('cuantos items ha looteado Raíder en los últimos 30 días',mixed.client,{chatFn:noModel})).answer,/tiene 2 ítems/);
 const missing=await askWhitebird(`cuantos items ha looteado <@${user}>`,{listAllowedTools:noModel},{chatFn:noModel});assert.match(missing.answer,/conexión con el panel/);
});
test('WoWAudit character ambiguity, wrong realm and ignored loot filter never produce counts',async()=>{
 for(const identity of [{needs_character:true,options:[]},{character:{id:123,name:'Otro',realm:'zuljin'}},{character:{id:123,name:'Raíder',realm:'otro-reino'}}]){
  const f=fixture();f.client.callReadTool=async(tool)=>{assert.equal(tool,'get_character');return identity;};
  const result=await askWhitebird(`cuantos items ha looteado <@${user}>`,f.client,{panelClient:f.panelClient,chatFn:noModel});assert.match(result.answer,/identificar de forma única/);
 }
 const f=fixture(),call=f.client.callReadTool;f.client.callReadTool=async(tool,args)=>tool==='get_character'?call(tool,args):{from:'2026-10-16',to:'2026-11-15',total:1,loot:[{character:'Otro',item:'Objeto'}]};
 assert.match((await askWhitebird('cuantos items ha looteado Raíder',f.client,{chatFn:noModel})).answer,/no tengo un recuento fiable/);
});
test('general MCP questions enforce linked identity, and SQL records receive the linked realm',async()=>{
 const f=fixture();let turns=0;
 const r=await askWhitebird(`qué equipo tiene <@${user}>`,f.client,{panelClient:f.panelClient,chatFn:async()=>++turns===1?' {"tool":"get_character","arguments":{"character":"Inventado"}}':'Equipo del personaje vinculado.'});
 assert.match(r.answer,/Equipo del personaje vinculado/);assert.equal(f.calls.at(-1).args.character,'123');
 const g=fixture();g.panelClient.call=async(tool,args)=>{
  if(tool==='wow_resolve_user')return {available:true,status:'resolved',guildId:guild,character:'Raíder',realm:'zuljin'};
  assert.equal(tool,'wow_sync_history');assert.equal(args.character,'Raíder');assert.equal(args.realm,'zuljin');return {available:true,total:0,rows:[]};
 };
 await askWhitebird(`historial de wow-sync de <@${user}>`,{listAllowedTools:noModel},{panelClient:g.panelClient,chatFn:noModel});
});

test('Discord → HTTP agent → authenticated panel resolution → WoWAudit uses linked character id',async t=>{
 const {default:http}=await import('node:http');
 const {createAgentServer}=await import('../src/server.js');
 const {createPanelClient}=await import('../src/panel-client.js');
 const {createDiscordHandler,discordConfig}=await import('../src/discord.js');
 const f=fixture(),panelToken='p'.repeat(32),agentToken='a'.repeat(32);let resolved=0;
 const panel=http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,`Bearer ${panelToken}`);
  const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));
  assert.equal(body.tool,'wow_resolve_user');assert.deepEqual(body.arguments,{project:'wow',userId:user});resolved++;
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(await f.panelClient.call(body.tool,body.arguments,body.actor)));
 });await new Promise(r=>panel.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>panel.close(r)));
 const server=createAgentServer({client:f.client,token:agentToken,panelClient:createPanelClient({url:`http://127.0.0.1:${panel.address().port}`,token:panelToken})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const config=discordConfig({DISCORD_BOT_TOKEN:'fake',DISCORD_APPLICATION_ID:'100000000000000001',DISCORD_GUILD_ID:guild,DISCORD_CHANNEL_IDS:'100000000000000003',DISCORD_ROLE_IDS:'100000000000000004',AGENT_API_TOKEN:agentToken,DISCORD_AGENT_URL:`http://127.0.0.1:${server.address().port}`});
 const messages=[];await createDiscordHandler(config)({isChatInputCommand:()=>true,commandName:'whitebird-ask',guildId:guild,channelId:config.channels[0],member:{roles:config.roles},user:{id:'323456789012345678'},options:{getString:()=>`cuantos items ha looteado <@${user}>`},deferReply:async m=>messages.push(m),editReply:async m=>messages.push(m),reply:async m=>messages.push(m)});
 assert.equal(resolved,1);assert.match(messages[1].content,/Raíder-Zul'jin tiene 2 ítems/);assert.equal(messages[0].flags,64);assert.deepEqual(messages[1].allowedMentions,{parse:[]});
});
