import { planBotDataQuery } from './bot-data.js';
import { contextKnowledge } from './context-knowledge.js';
import { projects as bundledProjects } from './project-knowledge.js';

const normalize = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const explanation = /como|funciona|explica|que hace|para que|ayuda|comandos|configur|permis/;
const catalog = projects => projects.map(project => `• ${project.name} — ${project.summary}`).join('\n');

export const PROJECT_IDS = ['wow', 'recruitment', 'roulette', 'agent', 'agent-discord', 'panel'];

export function projectHelp(question, selectedProject, context = contextKnowledge.snapshot()) {
  if (planBotDataQuery(question, selectedProject)) return null;
  const projects = bundledProjects.map(p => {
    const entry = context.catalog?.projects.find(e => e.id === p.id);
    return entry ? { ...p, ...entry, aliases: p.aliases, topics: p.topics.map((t, i) => ({ ...t, text: entry.topics[i] })) } : p;
  });
  const text = normalize(question);
  if (/que bots|cada (?:uno de los )?bots|cada bot|funcionan los bots|bots (?:conoces|disponibles)/.test(text)) {
    return { tool: null, answer: `Puedo explicar estos componentes de Whitebird\n\n${catalog(projects)}\n\nIndica el bot y la función que quieres conocer, por ejemplo «¿Cómo se acepta un apply?» o «¿Cómo funciona el ranking de alters?».` };
  }
  let candidates = projects.filter(project => project.aliases.test(text));
  if (candidates.length > 1) {
    return { tool: null, answer: candidates.map(project => `${project.name}\n${project.summary}`).join('\n\n') + '\n\nPara más detalle, indica un bot y una función. Recruitment comparte las vinculaciones con WoW Role Sync. La ruleta conserva sus propios personajes y asignaciones.' };
  }
  if (!candidates.length && /sincroniz.*(?:roles|rangos)|(?:roles|rangos).*sincroniz|calder|\bbis\b|vinculacion-|informe[- ](?:de )?raiders|equipo-comprobar/.test(text)) {
    candidates = projects.filter(project => project.id === 'wow');
  }
  if (!candidates.length && explanation.test(text) && selectedProject) {
    const id = selectedProject === 'agent-discord' ? 'agent' : selectedProject;
    candidates = projects.filter(project => project.id === id);
  }
  if (!candidates.length && /como funciona|explica.*bot|ayuda.*bots/.test(text)) {
    return { tool: null, answer: `Indica qué componente quieres conocer\n\n${catalog(projects)}` };
  }
  if (!candidates.length) return null;
  const project = candidates[0];
  const topicText = text.replace(project.aliases, "");
  const topic = [...project.topics].reverse().find(topic => topic.match.test(topicText));
  const body = topic?.text || project.overview;
  const entry = context.catalog?.projects.find(e => e.id === project.id);
  const notice = entry
    ? `Contexto revisado ${context.catalog.reviewedAt}.${context.stale ? ' Sincronización no disponible; usando copia local.' : ''}${entry.collectionUnavailable ? ' Fuente no disponible; se conserva la última ayuda publicada.' : ''} ${entry.deployedRevision === null ? 'Despliegue sin verificar.' : `Versión desplegada documentada: ${entry.deployedRevision}.${entry.deployedRevision !== entry.implementedRevision ? ' La versión implementada difiere; esta ayuda puede incluir cambios pendientes.' : ''}`} Comprueba el estado real en el panel.`
    : 'Ayuda local de respaldo; contexto compartido no disponible. Despliegue sin verificar. Comprueba el estado real en el panel.';
  return { tool: null, answer: `${project.name}\n\n${body}\n\n${notice}` };
}
