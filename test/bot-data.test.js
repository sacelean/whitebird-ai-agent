import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { planBotDataQuery, formatBotData } from '../src/bot-data.js';
import { projectHelp } from '../src/project-help.js';
import { askWhitebird } from '../src/agent.js';
import { createPanelClient } from '../src/panel-client.js';
import { createAgentServer } from '../src/server.js';
import { createDiscordHandler, discordConfig } from '../src/discord.js';
const now=Date.parse('2026-11-15T23:30:00Z'); // Nov 16 in Madrid.
const summary={available:true,total:9,acceptedCompleted:4,rejectedCompleted:2,acceptedPending:2,rejectedPending:1,firstRecordedAt:'2026-11-01 12:00:00',scope:'Solo decisiones registradas; las anteriores no se incluyen.'};
for(const [question,tool] of [
 ['cuantos applies hemos aceptado?','recruitment_summary'],
 ['¿Cuántas solicitudes hemos rechazado este mes?','recruitment_summary'],
 ['Muestra los últimos 3 applies aceptados','recruitment_recent'],
 ['¿Cuántos personajes tenemos vinculados en wow-sync?','wow_links'],
 ['Muéstrame el historial de cambios de roles de WoW Sync','wow_sync_history'],
 ['¿Quién lleva los calderos hoy?','wow_cauldrons'],
 ['¿Cuántas listas BIS activas hay?','wow_bis_summary'],
 ['Lista los últimos ascensos de WoW Sync','wow_promotions']
])test(`live records: ${question}`,()=>{
 const plan=planBotDataQuery(question,undefined,{now});assert.equal(plan.tool,tool);
 assert.equal(projectHelp(question),null);
});
test('relative dates use Madrid, explicit invalid dates and ambiguous intervals ask for detail',()=>{
 assert.deepEqual(planBotDataQuery('cuantos applies aceptados hoy',null,{now}).arguments,{project:'recruitment',from:'2026-11-16',to:'2026-11-16'});
 assert.equal(planBotDataQuery('cuantos applies aceptados esta semana',null,{now}).arguments.from,'2026-11-16');
 assert.equal(planBotDataQuery('cuantos applies aceptados este mes',null,{now}).arguments.from,'2026-11-01');
 assert.match(planBotDataQuery('cuantos applies aceptados desde 2026-02-30').answer,/fechas válidas/);
 assert.match(planBotDataQuery('cuantos applies en los últimos meses').answer,/Concreta/);
 assert.match(planBotDataQuery('cuantos applies desde 2026-12-01 hasta 2026-01-01').answer,/posterior/);
 assert.equal(planBotDataQuery('quien lleva calderos lunes').arguments.weekday,'monday');
 assert.match(planBotDataQuery('quien lleva calderos lunes y martes').answer,/un solo día/);
});
test('explanations and WoWAudit retain their routes, data scope is not inferred as an unsupported count',()=>{
 assert.equal(planBotDataQuery('¿Cómo se acepta un apply?'),null);
 assert.equal(planBotDataQuery('Dime cómo se acepta un apply'),null);
 assert.match(planBotDataQuery('cuantos applies ha aceptado un oficial').answer,/no admito/);
 assert.match(projectHelp('¿Cómo se acepta un apply?').answer,/apply-aceptar/);
 assert.equal(planBotDataQuery('¿Cuántos eventos de WoWAudit tenemos?','wow'),null);
 assert.equal(planBotDataQuery('Muestra la configuración actual de Recruitment'),null);
 assert.match(planBotDataQuery('cuantos applies abiertos').answer,/no permite contar/);
 assert.match(planBotDataQuery('cuantas vinculaciones habia este mes').answer,/sin reconstrucción histórica/);
 assert.match(planBotDataQuery('cuantas sincronizaciones hemos ejecutado').answer,/no permite contar ciclos/);
 assert.equal(planBotDataQuery('cuantos hemos aceptado','recruitment').tool,'recruitment_summary');
 assert.equal(planBotDataQuery('cuantos applies aceptados','wow').arguments.project,'recruitment');
 assert.match(planBotDataQuery('cuantos applies en recruitment y wow-sync').answer,/Indica si/);
 assert.equal(planBotDataQuery('cuantos applies de \"Alpha\"').arguments.character,'Alpha');
 assert.match(planBotDataQuery('cuantos objetos BIS tiene \"Alpha\"').answer,/todavía no los objetos/);
 assert.equal(planBotDataQuery('lista de decisiones aceptadas y rechazadas de Recruitment').arguments.decision,undefined);
});
test('the reported count bypasses documentation, model and MCP; no panel never invents a count',async()=>{
 const client={listAllowedTools:()=>assert.fail('Not WoWAudit')},chatFn=()=>assert.fail('Not a model query');
 const result=await askWhitebird('cuantos applies hemos aceptado?',client,{chatFn,actor:'discord:authorized',panelClient:{call:async(tool,args,actor)=>{
  assert.equal(tool,'recruitment_summary');assert.deepEqual(args,{project:'recruitment'});assert.equal(actor,'discord:authorized');return summary;
 }}});
 assert.match(result.answer,/Aceptadas completadas: 4/);assert.doesNotMatch(result.answer,/apply-aceptar/);
 assert.match((await askWhitebird('cuantos applies hemos aceptado?',client,{chatFn})).answer,/conecta las herramientas/);
 const unavailable=await askWhitebird('cuantos applies hemos aceptado?',client,{panelClient:{call:async()=>({available:false})}});assert.match(unavailable.answer,/recuento fiable/);
});
test('answers state scope, partial views and do not exceed the Discord limit',()=>{
 const result=formatBotData('recruitment_recent',{available:true,total:100,partial:true,rows:Array.from({length:10},()=>({character:'x'.repeat(160),realm:'y'.repeat(160),decision:'aceptada',status:'completed',date:'2026-11-01 00:00:00'})),scope:'No incluye las decisiones anteriores al registro.'.repeat(10)});
 assert.ok(result.answer.length<=1900);assert.match(result.answer,/Vista parcial/);assert.match(result.answer,/No incluye/);
});
test('Discord → HTTP agent → authenticated panel client uses the count tools and keeps private replies',async t=>{
 const panelToken='p'.repeat(32),agentToken='a'.repeat(32);let calls=0;
 const panel=http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,`Bearer ${panelToken}`);assert.equal(req.url,'/api/agent-tools');
  const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));
  assert.equal(body.tool,'recruitment_summary');assert.match(body.actor,/discord/);calls++;
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(summary));
 });await new Promise(r=>panel.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>panel.close(r)));
 const panelClient=createPanelClient({url:`http://127.0.0.1:${panel.address().port}`,token:panelToken});
 const server=createAgentServer({client:{listAllowedTools:()=>assert.fail('Unexpected MCP')},token:agentToken,panelClient});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const config=discordConfig({DISCORD_BOT_TOKEN:'fake',DISCORD_APPLICATION_ID:'100000000000000001',DISCORD_GUILD_ID:'100000000000000002',DISCORD_CHANNEL_IDS:'100000000000000003',DISCORD_ROLE_IDS:'100000000000000004',AGENT_API_TOKEN:agentToken,DISCORD_AGENT_URL:`http://127.0.0.1:${server.address().port}`});
 const messages=[];const handle=createDiscordHandler(config);
 await handle({isChatInputCommand:()=>true,commandName:'whitebird-ask',guildId:config.guildId,channelId:config.channels[0],member:{roles:config.roles},user:{id:'authorized'},options:{getString:()=> 'cuantos applies hemos aceptado?'},deferReply:async m=>messages.push(m),editReply:async m=>messages.push(m),reply:async m=>messages.push(m)});
 assert.equal(calls,1);assert.equal(messages[0].flags,64);assert.match(messages[1].content,/Aceptadas completadas: 4/);assert.deepEqual(messages[1].allowedMentions,{parse:[]});
});
