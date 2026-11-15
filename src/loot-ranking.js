import { unwrapToolResult } from './result-format.js';

// Count source records before generic display truncation or model synthesis.
export function planLootRanking(question) {
  const text=question.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[¿?¡!.,]/g,'').replace(/\s+/g,' ').trim();
  if(!/\b(?:quien(?:es)?|personajes?|jugadores?)\b/.test(text)||!/\bmas\b/.test(text)||!/loot|botin/.test(text))return null;
  const match=text.match(/^(?:quien(?:es)? ha(?:n)? looteado mas|quien(?:es)? ha(?:n)? recibido mas (?:loot|botin)|que (?:personaje|jugador) ha (?:looteado mas|recibido mas (?:loot|botin)))(?: (.*))?$/);
  const suffix=match?.[1]||'';
  if(!match||suffix&&!/^(?:en |durante )?los ultimos 30 dias$/.test(suffix))return {answer:'Puedo comparar las asignaciones de loot por personaje de los últimos 30 días, contando todas las categorías registradas. Pregunta «quién ha looteado más en los últimos 30 días». Todavía no aplico otros periodos o filtros a este recuento.'};
  return {arguments:{limit:200}};
}
const unavailable='No se pudo consultar el historial de loot de WoWAudit. Comprueba la conexión y la sesión de WoWAudit del agente; no tengo un recuento fiable.';
export async function askLootRanking(plan,client){
  if(plan.answer)return {tool:null,answer:plan.answer};
  try {
    const tool=client.listAllowedTools().find(t=>t.name==='loot_history');
    const limit=tool?.inputSchema?.properties?.limit;
    if(!tool||!limit||limit.maximum!==undefined&&limit.maximum<200)return {tool:null,answer:'La herramienta de historial de loot no está disponible con el límite necesario para este recuento. Comprueba la conexión y la versión de WoWAudit del agente.'};
    const data=unwrapToolResult(await client.callReadTool('loot_history',plan.arguments));
    if(!data||!Array.isArray(data.loot)||!Number.isSafeInteger(data.total)||data.total<0||data.loot.length>200)throw Error('Invalid loot data');
    const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
    if(!validDay(data.from)||!validDay(data.to)||data.from>data.to)throw Error('Invalid loot period');
    const date=v=>new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'));
    const period=`del ${date(data.from)} al ${date(data.to)}`;
    if(data.total!==data.loot.length||data.partial===true||data.has_more===true||data.nextCursor||data.next_cursor)return {tool:'loot_history',answer:`El historial de loot ${period} está incompleto: recibí ${data.loot.length} de ${data.total} registros. No puedo determinar quién ha looteado más con estos datos. El límite de consulta es de 200 registros.`};
    if(!data.total)return {tool:'loot_history',answer:`No hay asignaciones de loot registradas en WoWAudit ${period}.`};
    const counts=new Map();
    for(const row of data.loot){
      if(typeof row?.character!=='string'||!row.character.trim()||row.character.length>100||/[\x00-\x1f]/.test(row.character)||typeof row.item!=='string'||!row.item)throw Error('Invalid loot record');
      counts.set(row.character,(counts.get(row.character)||0)+1);
    }
    const maximum=Math.max(...counts.values());
    const winners=[...counts].filter(([,n])=>n===maximum).map(([name])=>name).sort((a,b)=>a.localeCompare(b,'es'));
    const names=winners.slice(0,10).join(', ');
    const result=winners.length===1?`${names} encabeza el recuento, con ${maximum} ${maximum===1?'asignación registrada':'asignaciones registradas'}`:`Hay un empate a ${maximum} ${maximum===1?'asignación':'asignaciones'} entre ${names}${winners.length>10?` y ${winners.length-10} personajes más`:''}`;
    return {tool:'loot_history',answer:`${result} ${period}.\n\nHe contado los ${data.total} registros del periodo, incluyendo todas las categorías (también bonus, transfiguración y «Excluded» si aparecen). Es un recuento por personaje, no por persona ni de mejoras de equipo.`};
  }catch{return {tool:'loot_history',answer:unavailable};}
}
