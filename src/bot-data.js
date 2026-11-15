const normalize = text => text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const dayShift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
function today(now){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
function period(text,now){
 if(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(text))return {error:'Indica las fechas como YYYY-MM-DD para evitar confundir día y mes.'};
 if(/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/.test(text))return {error:'Indica mes y año mediante fechas YYYY-MM-DD, o usa «este mes» o «mes pasado».'};
 const days=[...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(m=>m[0]);
 if(/\bhoy\b/.test(text)&&/\bayer\b/.test(text))return {error:'Indica un solo periodo: hoy, ayer o fechas explícitas.'};
 const d=today(now),weekStart=dayShift(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));
 if(days.length){
  if(days.some(v=>!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v))return {error:'Indica fechas válidas con formato YYYY-MM-DD.'};
  if(days.length===2 && /desde|entre/.test(text)&&/hasta|\by\b/.test(text))return days[0]<=days[1]?{from:days[0],to:days[1]}:{error:'La fecha inicial es posterior a la final.'};
  if(days.length===1)return /desde/.test(text)?{from:days[0]}:/hasta/.test(text)?{to:days[0]}:{from:days[0],to:days[0]};
  return {error:'Indica el periodo como «desde YYYY-MM-DD hasta YYYY-MM-DD».'};
 }
 if(/\bhoy\b/.test(text))return {from:d,to:d};
 if(/\bayer\b/.test(text)){const v=dayShift(d,-1);return {from:v,to:v};}
 const last=text.match(/ultimos? (\d+) dias?/);
 if(last){const n=Number(last[1]);return n>=1&&n<=366?{from:dayShift(d,1-n),to:d}:{error:'Indica un periodo de 1 a 366 días o fechas explícitas.'};}
 if(/semana pasada/.test(text))return {from:dayShift(weekStart,-7),to:dayShift(weekStart,-1)};
 if(/esta semana/.test(text))return {from:weekStart,to:d};
 if(/mes pasado/.test(text)){const end=dayShift(d.slice(0,7)+'-01',-1);return {from:end.slice(0,7)+'-01',to:end};}
 if(/este mes/.test(text))return {from:d.slice(0,7)+'-01',to:d};
 if(/este ano/.test(text))return {from:d.slice(0,4)+'-01-01',to:d};
 const year=text.match(/\ben (20\d{2})\b/);if(year)return {from:year[1]+'-01-01',to:year[1]+'-12-31'};
 if(/\b(?:semanas?|mes(?:es)?|anos?|horas?|dias?|desde|hasta|periodo|temporada|fechas?)\b/.test(text))return {error:'Concreta el periodo con fechas YYYY-MM-DD; no puedo interpretar ese intervalo con seguridad.'};
 return {};
}
const weekdays={lunes:'monday',martes:'tuesday',miercoles:'wednesday',jueves:'thursday',viernes:'friday',sabado:'saturday',domingo:'sunday'};
export function planBotDataQuery(question,selectedProject,{now=Date.now()}={}){
 const text=normalize(question).replace(/[¿?¡!]/g,'').trim();
 if(/^(?:como|explica|que comando|que pasos|para que|que es|como puedo)\b/.test(text))return null;
 if(/\b(?:como (?:se|funciona|puedo)|explicame|explica|que comando|para que)\b/.test(text))return null;
 if(!/\b(?:cuant[oa]s?|numero|total|recuento|estadisticas|ultim[oa]s?|historial|historico|lista|listado|muestra(?:me)?|dime|ver|quien(?:es)?|cual(?:es)?)\b|\bque (?:cambios|personajes|vinculaciones|decisiones|solicitudes|calderos|listas|ascensos|rol)\b/.test(text))return null;
 if(/\b(?:configuracion|configurado|horarios?|permisos?|logs?|tokens?|puertos?|diagnostica)\b/.test(text))return null;
 if(/\b(?:eventos?|loot|abalorios?|recetas?|wowaudit)\b/.test(text))return null;
 const recruitment=/\b(?:recruitment|reclutamiento|apply|applies|solicitudes?)\b/.test(text);
 const wow=/\b(?:wow[- _]*(?:role[- _]*)?sync|role[- _]*sync|vinculaciones?|vinculad[oa]s?|calderos?|bis|ascensos?)\b|sincroniz/.test(text);
 let project=recruitment?'recruitment':wow?'wow':['wow','recruitment'].includes(selectedProject)?selectedProject:null;
 if(recruitment&&wow)return {answer:'Indica si quieres consultar decisiones de Recruitment o registros de WoW Role Sync.'};
 if(!project)return null;
 const result={project};let tool;
 const quoted=question.match(/["“]([^"”]{1,80})["”]/);
 const list=/\b(?:quien(?:es)?|cual(?:es)?|ultim[oa]s?|lista|listado|muestra(?:me)?|ver|historial|historico)\b/.test(text)&&!/\b(?:cuant[oa]s?|numero|total|recuento)\b/.test(text);
 if(project==='recruitment'){
  if(/\b(?:clase|oficial|oficiales|usuario|raza)\b|\bpor (?!favor\b)|\bha (?:aceptado|rechazado)\b/.test(text))return {answer:'Puedo consultar totales y decisiones por periodo o personaje entre comillas. Todavía no admito agrupaciones o filtros por oficial, usuario o clase.'};
  if(/\babiert[oa]s?\b/.test(text)||(/pendientes?/.test(text)&&!/decision|aceptacion|rechaz/.test(text)))return {answer:'El registro distingue decisiones iniciadas y completadas, pero no permite contar todas las solicitudes abiertas. Puedo consultar aceptadas, rechazadas o decisiones pendientes de completar.'};
  tool=list?'recruitment_recent':'recruitment_summary';
  if(list){if(/acept/.test(text)&&!/rechaz/.test(text))result.decision='aceptada';if(/rechaz/.test(text)&&!/acept/.test(text))result.decision='rechazada';result.status=/pendient|sin completar/.test(text)?'pending':'completed';}
 }else{
  if(/calder/.test(text))tool='wow_cauldrons';
  else if(/\bbis\b/.test(text))tool='wow_bis_summary';
  else if(/ascens|felicit/.test(text))tool='wow_promotions';
  else if(/historial|historico|cambios?.*(?:roles?|rangos?)|(?:roles?|rangos?).*cambios?/.test(text))tool='wow_sync_history';
  else if(/vincul|\bmains?\b|canales?.*raider/.test(text))tool='wow_links';
  else return {answer:'Puedo consultar vinculaciones, cambios de roles registrados, calderos, propuestas BIS y felicitaciones de ascenso. Indica qué registros quieres; el histórico no permite contar ciclos de sincronización.'};
 }
 if(quoted && tool==='recruitment_summary')result.character=quoted[1];
 if(tool==='wow_bis_summary' && (quoted||/\b(?:objetos?|equipo|bis de)\b/.test(text)))return {answer:'Puedo consultar el recuento de propuestas y listas BIS activas, pero todavía no los objetos de una lista concreta.'};
 if(tool==='wow_cauldrons'){
  const named=Object.keys(weekdays).filter(w=>new RegExp(`\\b${w}\\b`).test(text));
  if(named.length>1)return {answer:'Indica un solo día para consultar calderos, o pide la lista semanal.'};
  if(named.length)result.weekday=weekdays[named[0]];
  else if(/\bhoy\b|\bmanana\b/.test(text))result.weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(dayShift(today(now),/manana/.test(text)?1:0)+'T12:00:00Z').getUTCDay()];
  else if(/ayer|semana pasada|mes|\d{4}-\d{2}-\d{2}/.test(text))return {answer:'Solo puedo consultar el reparto semanal actual de calderos, no reconstruir entregas o asignaciones pasadas.'};
 }else{
  const dates=period(text.replace(/["“][^"”]*["”]/g,''),now);if(dates.error)return {answer:dates.error};
  if((tool==='wow_links'||tool==='wow_bis_summary')&&(dates.from||dates.to))return {answer:'Esta consulta muestra datos actuales guardados, sin reconstrucción histórica por fechas. Para periodos puedo consultar decisiones, cambios de roles o felicitaciones registradas.'};
  Object.assign(result,dates);
 }
 if(!['recruitment_summary','wow_bis_summary'].includes(tool)){
  const limit=text.match(/(?:ultim[oa]s?|primer[oa]s?)\s+(\d+)\s+(?:applies|solicitudes|decisiones|cambios|registros|vinculaciones|personajes|ascensos)/);
  if(limit){if(+limit[1]<1||+limit[1]>10)return {answer:'Puedo mostrar de 1 a 10 registros por consulta. Concreta el límite o usa un recuento.'};result.limit=+limit[1];}
  if(quoted&&tool!=='wow_cauldrons')result.character=quoted[1];
 }
 return {tool,arguments:result};
}
const titles={recruitment_summary:'Decisiones de Recruitment',recruitment_recent:'Últimas decisiones de Recruitment',wow_links:'Vinculaciones guardadas',wow_sync_history:'Cambios de roles registrados',wow_cauldrons:'Reparto semanal de calderos',wow_bis_summary:'Propuestas BIS guardadas',wow_promotions:'Felicitaciones de ascenso registradas'};
const states={completed:'completada',pending:'pendiente',accepted:'aceptada',rejected:'rechazada',superseded:'sustituida',cleared:'desactivada',failed:'fallida',sent:'enviada',sending:'en envío',awaiting_spec:'esperando especialización',awaiting_source:'esperando fuente',building:'en preparación'};
const days={monday:'lunes',tuesday:'martes',wednesday:'miércoles',thursday:'jueves',friday:'viernes',saturday:'sábado',sunday:'domingo'};
const safe=v=>String(v??'').replace(/[\x00-\x1f]/g,' ').slice(0,100);
const stamp=v=>v?`${safe(v)} UTC`:'sin registros';
function humanDay(value, timestamp=false){
 if(typeof value!=='string')return null;
 const raw=timestamp?value.replace(' ','T'):value+'T12:00:00Z';
 const iso=timestamp&&!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)?raw+'Z':raw;
 const date=new Date(iso);
 if(!Number.isFinite(+date))return null;
 return new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'numeric',month:'long',year:'numeric'}).format(date);
}
function recruitmentSummary(data){
 const n=data.total,accepted=data.acceptedCompleted,rejected=data.rejectedCompleted;
 const pendingAccept=data.acceptedPending,pendingReject=data.rejectedPending;
 const known=accepted+rejected+pendingAccept+pendingReject;
 if(known>n)throw Error('Inconsistent recruitment counts');
 let context='';
 if(data.filters?.character)context+=` que coinciden con «${safe(data.filters.character)}»`;
 if(data.period){
  const from=humanDay(data.period.from),to=humanDay(data.period.to);
  context+=from&&to?(data.period.from===data.period.to?` el ${from}`:` entre el ${from} y el ${to}`):from?` desde el ${from}`:to?` hasta el ${to}`:'';
 }
 let answer;
 if(n===0)answer=`No hay decisiones registradas${context}.`;
 else {
  const intro=`Hay ${n} ${n===1?'solicitud':'solicitudes'} con una decisión registrada${context}`;
  let detail;
  if(accepted===n)detail=n===1?'fue aceptada':`las ${n} fueron aceptadas`;
  else if(rejected===n)detail=n===1?'fue rechazada':`las ${n} fueron rechazadas`;
  else {
   const parts=[];
   if(accepted)parts.push(`${accepted} ${accepted===1?'aceptada':'aceptadas'}`);
   if(rejected)parts.push(`${rejected} ${rejected===1?'rechazada':'rechazadas'}`);
   if(pendingAccept)parts.push(`${pendingAccept} con aceptación pendiente de completar`);
   if(pendingReject)parts.push(`${pendingReject} con rechazo pendiente de completar`);
   if(n>known)parts.push(`${n-known} con otro estado registrado`);
   detail=parts.length>1?parts.slice(0,-1).join(', ')+' y '+parts.at(-1):parts[0];
  }
  answer=`${intro}: ${detail}.`;
 }
 const first=!data.period&&!data.filters?.character?humanDay(data.firstRecordedAt,true):null;
 const coverage=first?`La decisión más antigua disponible es del ${first}. `:'';
 return {tool:'recruitment_summary',answer:answer+'\n\n'+coverage+'Este recuento no incluye solicitudes abiertas ni decisiones antiguas que no se hayan guardado.'};
}
export function formatBotData(tool,data){
 if(data.available!==true)return {tool,answer:'No se pudo consultar el registro solicitado. Comprueba la conexión del panel, la versión del bot y la ruta/permisos de SQLite. No dispongo de un recuento fiable.'};
 const fields=tool==='recruitment_summary'?['total','acceptedCompleted','rejectedCompleted','acceptedPending','rejectedPending']:tool==='wow_bis_summary'?['total','currentLists']:['total'];
 if(fields.some(k=>!Number.isSafeInteger(data[k])||data[k]<0))throw Error('Invalid database response');
 if(!['recruitment_summary','wow_bis_summary'].includes(tool)&&!Array.isArray(data.rows))throw Error('Invalid database rows');
 if(tool==='recruitment_summary')return recruitmentSummary(data);
 let lines=[titles[tool]];
 if(data.filters?.character)lines.push(`Personaje contiene: ${safe(data.filters.character)}.`);
 if(data.period)lines.push(`Periodo: ${data.period.from||'inicio del registro'} a ${data.period.to||'última fecha disponible'}, días inclusivos de Europe/Madrid.`);
 if(tool==='wow_bis_summary')lines.push(`Listas activas: ${data.currentLists}. Propuestas guardadas: ${data.total}.`,...(data.statuses||[]).map(s=>`• ${safe(states[s.status]||s.status)}: ${s.count}`));
 else {
  lines.push(`Registros coincidentes: ${data.total}.`);
  for(const r of data.rows||[]){
   if(tool==='recruitment_recent')lines.push(`• ${safe(r.character)}-${safe(r.realm)}: ${safe(r.decision)}, ${states[r.status]||safe(r.status)} · ${stamp(r.date)}`);
   if(tool==='wow_links')lines.push(`• ${safe(r.character)}-${safe(r.realm)} · canal Raider ${r.hasRaiderChannel?'guardado':'sin asociar'}`);
   if(tool==='wow_sync_history')lines.push(`• ${safe(r.character)}: ${r.action==='added'?'añadido':r.action==='removed'?'retirado':safe(r.action)} ${safe(r.role)} (${safe(r.category)}) · ${stamp(r.date)}`);
   if(tool==='wow_cauldrons')lines.push(`• ${days[r.weekday]||safe(r.weekday)} · ${safe(({potis:'pociones',frascos:'frascos'})[r.type]||r.type)}: ${safe(r.character)}`);
   if(tool==='wow_promotions')lines.push(`• ${safe(r.character)}: ${states[r.status]||safe(r.status)} · ${stamp(r.sentAt||r.date)}`);
  }
 }
 if(data.firstRecordedAt)lines.push(`Primer registro disponible: ${stamp(data.firstRecordedAt)}. No acredita cuándo comenzó la captura.`);
 if(data.partial)lines.push('Vista parcial: se muestran menos registros que el total. Concreta personaje o periodo.');
 lines.push(safeScope(data.scope));
 let answer=lines.join('\n');if(answer.length>1850){const tail='\nVista parcial: respuesta recortada. Concreta la consulta.\n'+safeScope(data.scope);answer=answer.slice(0,1850-tail.length)+tail;}
 return {tool,answer};
}
const safeScope=s=>String(s||'Solo datos guardados; no estado vivo.').replace(/[\x00-\x1f]/g,' ').slice(0,350);
export async function askBotData(plan,{panelClient,actor='api'}={}){
 if(plan.answer)return {tool:null,answer:plan.answer};
 if(!panelClient)return {tool:null,answer:'Para consultar registros reales, conecta las herramientas del panel con PANEL_TOOLS_URL y PANEL_TOOLS_TOKEN en el agente y PANEL_AGENT_TOOLS_TOKEN en el panel.'};
 try {return formatBotData(plan.tool,await panelClient.call(plan.tool,plan.arguments,actor));}
 catch {return {tool:null,answer:'No se pudo consultar la base de datos a través del panel. Comprueba la conexión y que ambos servicios estén actualizados; no tengo un resultado fiable.'};}
}
