const form = document.getElementById('agent-form');
const question = document.getElementById('agent-question');
const submit = document.getElementById('agent-submit');
const status = document.getElementById('agent-status');
const messages = document.getElementById('agent-messages');
const dialog = document.getElementById('agent-dialog');
const launcher = document.getElementById('agent-open');
const retry = document.getElementById('agent-retry');
let csrf, busy = false, enabled = false;
launcher.addEventListener('click', () => {
  dialog.showModal();
  if (enabled && !busy) question.focus();
});
document.getElementById('agent-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => launcher.focus());
function addMessage(author, text) {
  const message = document.createElement('div');
  message.className = `agent-message ${author === 'Tú' ? 'agent-user' : 'agent-assistant'}`;
  const label = document.createElement('strong');
  label.textContent = author;
  const content = document.createElement('p');
  // Model and tool output is untrusted text, never HTML.
  content.textContent = text;
  message.append(label, content);
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}
async function init() {
  enabled = false; submit.disabled = true; question.disabled = true; retry.hidden = true;
  status.textContent = 'Comprobando configuración del agente…';
  try {
    const response = await fetch('/api/agent');
    if (!response.ok) throw Error();
    const data = await response.json(); csrf = data.csrf; enabled = data.enabled === true;
    status.textContent = enabled ? (data.wowaudit ? 'Puedes pedir un diagnóstico del panel o consultar WoWAudit.' : 'Diagnóstico local disponible. Para consultar WoWAudit, configura la conexión del agente.') : 'El chat está disponible, pero falta conectar el servicio de IA. Configura PANEL_AGENT_URL y PANEL_AGENT_TOKEN en el servidor del panel y reinícialo.';
  } catch { status.textContent = 'No se pudo comprobar la conexión del agente. Vuelve a comprobarla.'; }
  submit.disabled = !enabled; question.disabled = !enabled; retry.hidden = enabled;
}
retry.addEventListener('click', init);
form.addEventListener('submit', async event => {
  event.preventDefault();
  const prompt = question.value.trim();
  if (busy || !enabled || !prompt) return;
  busy = true; submit.disabled = true; question.disabled = true;
  addMessage('Tú', prompt);
  status.textContent = 'Comprobando la consulta…';
  try {
    const response = await fetch('/api/agent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel-CSRF': csrf },
      body: JSON.stringify({ question: prompt, project: document.getElementById('project').value })
    });
    const data = await response.json();
    if (!response.ok) {
      const error = data.error || 'No se pudo completar la consulta.';
      addMessage('Asistente', error); status.textContent = error;
      if (response.status === 403) { enabled = false; retry.hidden = false; }
      return;
    }
    addMessage('Asistente', data.answer); question.value = '';
    status.textContent = data.tool ? `Herramienta consultada: ${data.tool}` : 'Consulta completada.';
  } catch {
    const error = 'No se pudo conectar con el agente. Vuelve a intentarlo.';
    addMessage('Asistente', error); status.textContent = error;
  } finally {
    busy = false; submit.disabled = !enabled; question.disabled = !enabled;
    if (dialog.open && enabled) question.focus();
  }
});
init();
