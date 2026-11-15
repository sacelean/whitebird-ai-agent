import {parseQueryPeriod} from './bot-data.js';
import {resolveWowCharacter} from './character-target.js';
import { unwrapToolResult } from './result-format.js';

// Count source records before generic display truncation or model synthesis.
export function planLootRanking(question, {now=Date.now()}={}) {
  if(!/loot|bot[ií]n|(?:[ií]tems?|objetos?|piezas?) ha recibido/i.test(question))return null;
  const suffix=question.match(/\s+((?:en |durante )?los [uú]ltimos \d+ d[ií]as|este mes|mes pasado|hoy|ayer|esta semana|semana pasada|este a[nñ]o|en 20\d{2}|desde \d{4}-\d{2}-\d{2}(?: hasta \d{4}-\d{2}-\d{2})?|entre \d{4}-\d{2}-\d{2} y \d{4}-\d{2}-\d{2})[?¿!¡]*$/iu);
  let dates={};
  if(suffix){
    const periodText=suffix[1].normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
    if(!/^(?:en |durante )?los ultimos 30 dias$/.test(periodText))dates=parseQueryPeriod(periodText,now);
    question=question.slice(0,suffix.index);
  }
  if(dates.error)return {answer:dates.error};
  const text=question.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[¿?¡!.,]/g,'').replace(/\s+/g,' ').trim();
  const count=text.match(/^cuant[oa]s? (?:items?|objetos?|piezas?) ha (?:looteado|recibido) (.+?)(?: en los ultimos 30 dias)?$/);
  if(count){
    const original=question.trim().replace(/[¿?¡!]/g,'').replace(/\s+/g,' ').match(/^cu[aá]nt[oa]s? (?:[ií]tems?|objetos?|piezas?) ha (?:looteado|recibido) (.+?)(?: en los [uú]ltimos 30 d[ií]as)?$/iu);
    const selector=original?.[1]?.replace(/^["“]|["”]$/g,'');
    if(!selector||!/^\p{L}[\p{L}'’-]*(?:-[\p{L}'’ -]+)?$/u.test(selector)||/\b(?:hoy|ayer|este|mes|semana|desde|hasta|sin|mitico|heroico|normal)\b/.test(count[1]))return {answer:'Indica un solo personaje (Nombre o Nombre-reino) o una mención de Discord. Este recuento usa los últimos 30 días y todas las categorías.'};
    return {arguments:{limit:200,...dates},character:selector,explicitPeriod:Boolean(suffix)};
  }
  if(!/\b(?:quien(?:es)?|personajes?|jugadores?)\b/.test(text)||!/\b(?:mas|menos)\b/.test(text)||!/loot|botin/.test(text))return null;
  const match=text.match(/^(?:quien(?:es)? ha(?:n)? looteado (?:mas|menos)|quien(?:es)? ha(?:n)? recibido (?:mas|menos) (?:loot|botin)|que (?:personaje|jugador) ha (?:looteado (?:mas|menos)|recibido (?:mas|menos) (?:loot|botin)))(?: (.*))?$/);
  const remainder=match?.[1]||'';
  if(!match||remainder)return {answer:'Puedo comparar las asignaciones de loot por personaje de los últimos 30 días, contando todas las categorías registradas. Pregunta «quién ha looteado más en los últimos 30 días». Ese periodo o filtro no está soportado. Puedes indicar hoy, ayer, este mes, mes pasado o fechas YYYY-MM-DD.'};
  return {arguments:{limit:200,...dates},direction:/\bmenos\b/.test(text)?'menos':'mas',explicitPeriod:Boolean(suffix)};
}
const unavailable='No se pudo consultar el historial de loot de WoWAudit. Comprueba la conexión y la sesión de WoWAudit del agente; no tengo un recuento fiable.';
export async function askLootRanking(plan,client,{target,onQueryContext,subject,priorQuery}={}){
  if(plan.answer)return {tool:null,answer:plan.answer};
  try {
    const tool=client.listAllowedTools().find(t=>t.name==='loot_history');
    const limit=tool?.inputSchema?.properties?.limit;
    if(!tool||!limit||limit.maximum!==undefined&&limit.maximum<200)return {tool:null,answer:'La herramienta de historial de loot no está disponible con el límite necesario para este recuento. Comprueba la conexión y la versión de WoWAudit del agente.'};
    const args={...(!plan.explicitPeriod&&priorQuery?.kind==='loot'?priorQuery.arguments:{}),...plan.arguments};let identity;
    if((args.from&&!tool.inputSchema.properties.from)||(args.to&&!tool.inputSchema.properties.to))return {tool:null,answer:'La herramienta disponible no permite aplicar ese periodo; no puedo dar un recuento comparable.'};
    if(plan.character){
      if(!tool.inputSchema.properties.character)return {tool:null,answer:'WoWAudit no permite filtrar el historial por personaje con la herramienta disponible.'};
      try{identity=await resolveWowCharacter(client,target?.selector||plan.character);args.character=identity.id;}
      catch{return {tool:null,answer:'No pude identificar de forma única ese personaje en WoWAudit. Indica Nombre-reino o revisa la vinculación de Discord y su presencia en el equipo.'};}
    }
    const data=unwrapToolResult(await client.callReadTool('loot_history',args));
    if(!data||!Array.isArray(data.loot)||!Number.isSafeInteger(data.total)||data.total<0||data.loot.length>200)throw Error('Invalid loot data');
    const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
    if(!validDay(data.from)||!validDay(data.to)||data.from>data.to)throw Error('Invalid loot period');
    if((args.from&&data.from!==args.from)||(args.to&&data.to!==args.to))throw Error('Period filter ignored');
    const date=v=>new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'));
    const period=`del ${date(data.from)} al ${date(data.to)}`;
    if(data.total!==data.loot.length||data.partial===true||data.has_more===true||data.nextCursor||data.next_cursor)return {tool:'loot_history',answer:`El historial de loot ${period} está incompleto: recibí ${data.loot.length} de ${data.total} registros. No puedo dar un recuento completo con estos datos. El límite de consulta es de 200 registros.`};
    onQueryContext?.({kind:'loot',arguments:{limit:200,from:data.from,to:data.to},direction:plan.direction||'mas',subject:plan.character?(subject||plan.character):null});
    if(!data.total&&plan.direction!=='menos')return {tool:'loot_history',answer:`No hay asignaciones de loot registradas${identity?` para ${identity.name}-${identity.realm}`:''} en WoWAudit ${period}.`};
    const counts=new Map();
    for(const row of data.loot){
      if(typeof row?.character!=='string'||!row.character.trim()||row.character.length>100||/[\x00-\x1f]/.test(row.character)||typeof row.item!=='string'||!row.item)throw Error('Invalid loot record');
      counts.set(row.character,(counts.get(row.character)||0)+1);
    }
    if(identity){
      if([...counts.keys()].some(name=>name.toLocaleLowerCase('es')!==identity.name.toLocaleLowerCase('es')))throw Error('Character filter ignored');
      return {tool:'loot_history',answer:`${identity.name}-${identity.realm} tiene ${data.total} ${data.total===1?'ítem registrado':'ítems registrados'} ${period}.\n\nCuenta todas las categorías de loot de ese personaje, incluidos bonus, transfiguración y «Excluded» si aparecen. No incluye sus alters.`};
    }
    if(plan.direction==='menos'){
      if(!client.listAllowedTools().some(t=>t.name==='list_roster'))return {tool:'loot_history',answer:'Necesito el roster de WoWAudit para incluir a quienes recibieron cero ítems. Esa herramienta no está disponible.'};
      const roster=unwrapToolResult(await client.callReadTool('list_roster',{}));
      if(!Number.isSafeInteger(roster?.size)||roster.size<1||roster.size>500||!Array.isArray(roster.members)||roster.members.length!==roster.size||roster.partial||roster.has_more||roster.nextCursor||roster.next_cursor)throw Error('Incomplete roster');
      const names=new Map();
      for(const member of roster.members){
        const name=member?.character?.name;
        if(typeof name!=='string'||!name.trim()||name.length>100||/[\x00-\x1f]/.test(name))throw Error('Invalid roster');
        const key=name.normalize('NFC').toLocaleLowerCase('es');
        if(names.has(key))return {tool:'loot_history',answer:'El roster contiene personajes con el mismo nombre. El historial no permite distinguir sus reinos con seguridad; no puedo determinar el mínimo.'};
        names.set(key,{name,count:0});
      }
      for(const [name,count] of counts){const item=names.get(name.normalize('NFC').toLocaleLowerCase('es'));if(item)item.count+=count;}
      const minimum=Math.min(...[...names.values()].map(v=>v.count));
      const winners=[...names.values()].filter(v=>v.count===minimum).map(v=>v.name).sort((a,b)=>a.localeCompare(b,'es'));
      const who=winners.slice(0,10).join(', ')+(winners.length>10?` y ${winners.length-10} personajes más`:'');
      return {tool:'loot_history',answer:`${winners.length===1?`${who} es quien menos recibió`:`Empatan ${who}`}, con ${minimum} ${minimum===1?'asignación registrada':'asignaciones registradas'} ${period}.\n\nComparo el roster actual de WoWAudit, incluidos personajes con cero ítems; no acredita asistencia ni pertenencia durante todo el periodo. Cuento todas las categorías de loot, también bonus, transfiguración y «Excluded» si aparecen.`};
    }
    const maximum=Math.max(...counts.values());
    const winners=[...counts].filter(([,n])=>n===maximum).map(([name])=>name).sort((a,b)=>a.localeCompare(b,'es'));
    const names=winners.slice(0,10).join(', ');
    const result=winners.length===1?`${names} encabeza el recuento, con ${maximum} ${maximum===1?'asignación registrada':'asignaciones registradas'}`:`Hay un empate a ${maximum} ${maximum===1?'asignación':'asignaciones'} entre ${names}${winners.length>10?` y ${winners.length-10} personajes más`:''}`;
    return {tool:'loot_history',answer:`${result} ${period}.\n\nHe contado los ${data.total} registros del periodo, incluyendo todas las categorías (también bonus, transfiguración y «Excluded» si aparecen). Es un recuento por personaje, no por persona ni de mejoras de equipo.`};
  }catch{return {tool:'loot_history',answer:plan.direction==='menos'?'No pude obtener un historial de loot y un roster completos y fiables de WoWAudit. No puedo determinar quién recibió menos; comprueba la conexión y los datos disponibles.':unavailable};}
}
