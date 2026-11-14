// Tool output is untrusted data. Keep formatting bounded and never execute its contents.
const LABELS = {
  events: 'Eventos', event: 'Evento', records: 'Registros', items: 'Objetos',
  loot: 'Loot', history: 'Historial', characters: 'Personajes', roster: 'Roster',
  name: 'Nombre', title: 'Título', character: 'Personaje', item: 'Objeto',
  item_name: 'Objeto', character_name: 'Personaje', date: 'Fecha',
  start: 'Inicio', starts_at: 'Inicio', start_time: 'Inicio', end: 'Fin',
  ends_at: 'Fin', end_time: 'Fin', difficulty: 'Dificultad', response: 'Respuesta',
  note: 'Nota', status: 'Estado', role: 'Rol', rank: 'Rango', spec: 'Especialización',
  item_level: 'Nivel de objeto', ilvl: 'Nivel de objeto', count: 'Cantidad',
  total: 'Total', signups: 'Inscripciones', by_status: 'Por estado', by_role: 'Por rol',
  confirmed: 'Confirmados', tentative: 'Dudosos', declined: 'Rechazados',
  absent: 'Ausentes', accepted: 'Aceptados', tank: 'Tanque', healer: 'Sanador',
  dps: 'DPS', id: 'ID', event_id: 'ID del evento', team: 'Equipo',
  from: 'Desde', to: 'Hasta', data: 'Datos', results: 'Resultados',
  gear_issues: 'Problemas de equipo', missing_enchants: 'Encantamientos ausentes',
  empty_sockets: 'Huecos de gema vacíos', great_vault: 'Gran Cámara',
  mythic_plus: 'Míticas+', raid_progress: 'Progreso de raid', rating: 'Puntuación',
  message: 'Mensaje', description: 'Descripción', warnings: 'Avisos'
};
const label = key => Object.hasOwn(LABELS, key) ? LABELS[key] : key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
const clean = value => String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

export function unwrapToolResult(result) {
  if (typeof result === 'string') {
    try { return JSON.parse(result); } catch { return result; }
  }
  // MCP can return JSON in text blocks instead of structuredContent.
  if (Array.isArray(result) && result.length && result.every(block => block?.type === 'text' && typeof block.text === 'string')) {
    const values = result.map(block => {
      try { return JSON.parse(block.text); } catch { return block.text; }
    });
    return values.length === 1 ? values[0] : values;
  }
  return result;
}

export function formatToolResult(result) {
  const lines = [];
  let size = 0;
  let partial = false;
  const add = line => {
    if (size + line.length + 1 > 6000) { partial = true; return false; }
    lines.push(line); size += line.length + 1; return true;
  };
  const scalar = value => {
    if (value === null) return 'Sin dato';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    const text = clean(value);
    if (text.length > 300) { partial = true; return text.slice(0, 300) + '…'; }
    return text || 'Vacío';
  };
  const visit = (value, depth = 0, heading = '') => {
    if (depth > 6) { partial = true; return; }
    const prefix = '  '.repeat(depth);
    if (Array.isArray(value)) {
      if (heading && !add(`${prefix}${heading}:`)) return;
      if (!value.length) { add(`${prefix}Sin registros.`); return; }
      for (const [index, entry] of value.slice(0, 12).entries()) {
        if (!add(`${prefix}• Registro ${index + 1}`)) break;
        visit(entry, depth + 1);
      }
      if (value.length > 12) { partial = true; add(`${prefix}Se muestran 12 de ${value.length} registros.`); }
    } else if (value && typeof value === 'object') {
      if (heading && !add(`${prefix}${heading}:`)) return;
      const entries = Object.entries(value);
      if (!entries.length) { add(`${prefix}Sin datos.`); return; }
      for (const [key, child] of entries) {
        if (size >= 5900) { partial = true; break; }
        visit(child, depth + 1, clean(label(key)).slice(0, 100));
      }
    } else {
      add(`${prefix}${heading ? heading + ': ' : ''}${scalar(value)}`);
    }
  };
  visit(unwrapToolResult(result));
  return {
    text: lines.join('\n') || 'WoWAudit no devolvió datos que pueda mostrar.',
    notice: partial ? 'Vista parcial: se han limitado los registros o detalles mostrados. Acota la consulta para obtener más detalle.' : ''
  };
}

export function isReadableAnswer(answer) {
  if (typeof answer !== 'string' || !answer.trim()) return false;
  const text = answer.trim();
  // Reject raw JSON, fenced code and JSON embedded in a prose wrapper.
  if (/```|^[\[{]|"[^"\n]+"\s*:|<\/?think>/i.test(text)) return false;
  try { JSON.parse(text); return false; } catch { return true; }
}
