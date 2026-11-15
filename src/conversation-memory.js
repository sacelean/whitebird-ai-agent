const normalize=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[¿?¡!.,]/g,'').trim().replace(/\s+/g,' ');
const followup=s=>/^(?:y\b|el que menos$|el que mas$|en el mismo periodo$)/.test(s);
export function createConversationMemory({now=Date.now,ttlMs=15*60*1000,maxEntries=256}={}){
 const entries=new Map();
 const prune=()=>{for(const [key,item] of entries)if(item.expires<=now())entries.delete(key);};
 const keyFor=({actor,conversationId}={})=>{
  if(typeof actor!=='string'||typeof conversationId!=='string'||conversationId.length>100)return null;
  if(!(/^discord:\d{17,20}:\d{17,20}$/.test(actor)&&/^discord:\d{17,20}$/.test(conversationId))&&!(/^panel:[^\s]{1,120}$/.test(actor)&&/^panel:[a-f0-9-]{36}$/.test(conversationId)))return null;
  return JSON.stringify([actor,conversationId]);
 };
 return {prune,clear:()=>entries.clear(),size:()=>{prune();return entries.size;},
  async ask(question,client,options,ask){
   prune();const key=keyFor(options),text=normalize(question);
   if(/^(?:olvida (?:el )?contexto|borra (?:el )?contexto|nueva conversacion)$/.test(text)){
    if(key)entries.delete(key);return {tool:null,answer:'He borrado el contexto temporal de esta conversación.'};
   }
   const old=key?entries.get(key):null;
   if(old&&old.project!==options.project)entries.delete(key);
   const previous=old&&old.project===options.project?old.context:null;
   const continued=followup(text);
   let priorQuery;
   if(continued){
    if(old)old.expires=now()+ttlMs;
    if(!previous)return {tool:null,answer:'No tengo contexto reciente para esa continuación. Indica el tema, personaje y periodo de la consulta.'};
    if(/^y (?:reinici|aplica|guarda|borra|cambia|modifica|elimina|despliega|configura|haz|ejecuta|manana|eso|aquel)/.test(text))return {tool:null,answer:'No puedo interpretar esa continuación con seguridad. Escribe una consulta completa.'};
    if(previous.kind==='loot'){
     const part=question.trim().replace(/^[¿?¡!]+/g,'').replace(/^y\s+/i,'').replace(/[¿?¡!]/g,'').trim();
     const short=normalize(part);
     const direction=/^(?:el |la )?que menos$|^quien menos$/.test(short)?'menos':/^(?:el |la )?que mas$|^quien mas$/.test(short)?'mas':null;
     if(direction){question=`quien ha looteado ${direction}`;priorQuery={...previous,subject:null,direction};}
     else if(/^(?:este mes|mes pasado|hoy|ayer|esta semana|semana pasada|este ano|en \d{4}|desde \d{4}-|entre \d{4}-|los ultimos \d+ dias)/.test(short)){
      question=(previous.subject?`cuantos items ha looteado ${previous.subject}`:`quien ha looteado ${previous.direction||'mas'}`)+' '+part;
     }else if(/^(?:<@!?\d{17,20}>|[\p{L}][\p{L}'’-]*|"[^"\r\n]{1,80}")$/u.test(part)){
      question=`cuantos items ha looteado ${part}`;priorQuery={...previous,subject:part};
     }else return {tool:null,answer:'No puedo interpretar esa continuación con seguridad. Indica si quieres cambiar el personaje, el periodo o consultar quién recibió más o menos loot.'};
    }else if(previous.kind==='mcp'){
     if(/(?:el que|la que|quien) (?:menos|mas)/.test(text))return {tool:null,answer:'Indica qué dato quieres comparar; no puedo deducirlo de esa consulta.'};
     priorQuery=previous;
     if(previous.subject&&!/@/.test(question)&&/mes|semana|hoy|ayer|periodo/.test(text))question+=` para ${previous.subject}`;
    }else if(previous.kind==='bot-data'){
     const bases={recruitment_summary:'cuantos applies',recruitment_recent:'lista de decisiones de recruitment',wow_links:'lista de vinculaciones de wow-sync',wow_sync_history:'historial de wow-sync',wow_promotions:'lista de ascensos de wow-sync',wow_cauldrons:'quien lleva calderos',wow_bis_summary:'cuantas listas BIS activas'};
     const tail=question.replace(/^[¿?¡!]+/g,'').replace(/^y\s+/i,'').replace(/[¿?¡!]/g,'').trim();
     const short=normalize(tail);
     const period=/^(?:este mes|mes pasado|hoy|ayer|esta semana|semana pasada|este ano|en \d{4}|desde \d{4}-|entre \d{4}-|los ultimos \d+ dias)/.test(short);
     if(['wow_cauldrons','wow_bis_summary'].includes(previous.tool))return {tool:null,answer:'Concreta la consulta completa de calderos o BIS; no puedo aplicar esa continuación como un filtro seguro.'};
     const subject=/^(?:<@!?\d{17,20}>|[\p{L}][\p{L}'’-]*|"[^"\r\n]{1,80}")$/u.test(tail);
     if(!period&&!subject)return {tool:null,answer:'Indica el personaje o el periodo de esa continuación.'};
     let base=bases[previous.tool];if(!base)return {tool:null,answer:'Concreta la consulta de registros.'};
     const args=previous.arguments;
     if(args.decision)base+=' '+args.decision;if(args.status==='pending')base+=' pendientes';
     if(args.limit)base=base.replace('lista',`lista de ultimos ${args.limit} registros`);
     const person=period?previous.subject:tail;
     if(person)base+=' de '+(person.startsWith('<@')?person:`"${person.replaceAll('"','')}"`);
     const dates=period?tail:args.from&&args.to?`desde ${args.from} hasta ${args.to}`:args.from?`desde ${args.from}`:args.to?`hasta ${args.to}`:'';
     question=base+(dates?' '+dates:'');
    }else return {tool:null,answer:'Indica el tema y los filtros de la consulta para evitar mezclar contextos.'};
   }
   if(key&&!continued)entries.delete(key);
   let next;
   const result=await ask(question,client,{...options,priorQuery,onQueryContext:context=>{
    if(context&&['loot','mcp','bot-data'].includes(context.kind)&&JSON.stringify(context).length<=3000)next=structuredClone(context);
   }});
   if(key&&next){entries.delete(key);while(entries.size>=maxEntries)entries.delete(entries.keys().next().value);entries.set(key,{context:next,project:options.project,expires:now()+ttlMs});}
   return result;
  }
 };
}
