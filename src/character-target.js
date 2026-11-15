import {unwrapToolResult} from './result-format.js';
const mention=/<@!?(\d{17,20})>/g;
const valid=v=>typeof v==='string'&&v.length>0&&v.length<=80&&!/[\x00-\x1f"<>@]/.test(v);
export async function resolveQuestionMentions(question,{panelClient,actor='api'}={}){
 const tokens=[...question.matchAll(mention)];
 if(!tokens.length&&!/@/.test(question))return {question,targets:[]};
 if(/@/.test(question.replace(mention,'')))return {answer:'Selecciona una mención real de Discord (@usuario). No puedo identificar con seguridad un nombre escrito con @, un rol o @everyone.'};
 const ids=[...new Set(tokens.map(m=>m[1]))];
 if(ids.length>1)return {answer:'Consulta un usuario de Discord cada vez para poder usar su personaje vinculado sin mezclar resultados.'};
 if(!panelClient)return {answer:'Necesito la conexión con el panel para consultar el personaje vinculado a esa mención de Discord.'};
 try {
  const data=await panelClient.call('wow_resolve_user',{project:'wow',userId:ids[0]},actor);
  if(data.available!==true)return {answer:'No se pudo consultar la vinculación de Discord. Comprueba la conexión del panel y los registros de WoW Sync.'};
  if(actor.startsWith('discord:')&&data.guildId!==actor.split(':')[1])return {answer:'La vinculación pertenece a otro servidor. No puedo utilizarla en esta consulta.'};
  if(data.status==='not_found')return {answer:'Ese usuario de Discord no tiene un personaje vinculado. Un oficial debe vincularlo antes de consultarlo por mención.'};
  if(data.status!=='resolved'||!valid(data.character)||!valid(data.realm))return {answer:'No hay una vinculación única y válida para esa mención. Revisa el personaje y reino vinculados antes de consultar.'};
  const target={character:data.character,realm:data.realm,selector:`${data.character}-${data.realm}`};
  return {question:question.replace(mention,()=>`"${data.character}"`),targets:[target]};
 }catch{return {answer:'No se pudo resolver la mención de Discord mediante el panel. Comprueba que el panel esté actualizado y conectado.'};}
}
export async function resolveWowCharacter(client,selector){
 const definition=client.listAllowedTools().find(t=>t.name==='get_character');
 if(!definition?.inputSchema?.properties?.character)throw Error('Character lookup unavailable');
 const args={character:selector};if(definition.inputSchema.properties.include_gear)args.include_gear=false;
 const data=unwrapToolResult(await client.callReadTool('get_character',args));
 const c=data?.character;
 if(data?.needs_character||!c||!Number.isSafeInteger(c.id)||c.id<=0||!valid(c.name)||!valid(c.realm))throw Error('Ambiguous character');
 // For linked names, keep the realm exact after normalizing Blizzard realm slugs.
 const normalize=v=>v.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const nameKey=v=>v.normalize('NFC').toLocaleLowerCase('es');
 const wanted=selector.split('-');
 if(wanted.length>1&&(nameKey(c.name)!==nameKey(wanted[0])||normalize(c.realm)!==normalize(wanted.slice(1).join('-'))))throw Error('Character mismatch');
 if(wanted.length===1&&nameKey(c.name)!==nameKey(selector))throw Error('Character mismatch');
 return {id:String(c.id),name:c.name,realm:c.realm};
}
