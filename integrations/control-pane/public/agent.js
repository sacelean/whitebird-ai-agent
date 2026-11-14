const form = document.getElementById('agent-form');
const question = document.getElementById('agent-question');
const submit = document.getElementById('agent-submit');
const status = document.getElementById('agent-status');
const output = document.getElementById('agent-answer');
let csrf, busy = false;
async function init() {
  try {
    const response = await fetch('/api/agent');
    if (!response.ok) throw Error();
    const data = await response.json(); csrf = data.csrf;
    submit.disabled = !data.enabled;
    status.textContent = data.enabled ? 'Listo para consultar WoWAudit. Las consultas pueden tardar varios minutos.' : 'El agente todavía no está configurado en el servidor del panel.';
  } catch { status.textContent = 'No se pudo comprobar la configuración del agente. Recarga el panel.'; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || submit.disabled || !question.value.trim()) return;
  busy = true; submit.disabled = true; question.disabled = true;
  status.textContent = 'Consultando WoWAudit…'; output.textContent = '';
  try {
    const response = await fetch('/api/agent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel-CSRF': csrf },
      body: JSON.stringify({ question: question.value.trim() })
    });
    const data = await response.json();
    if (!response.ok) { status.textContent = data.error || 'No se pudo completar la consulta.'; return; }
    // Model and tool output is untrusted text, never HTML.
    output.textContent = data.answer;
    status.textContent = data.tool ? `Herramienta consultada: ${data.tool}` : 'Consulta completada.';
  } catch { status.textContent = 'No se pudo conectar con el agente. Vuelve a intentarlo.'; }
  finally { busy = false; submit.disabled = false; question.disabled = false; }
});
init();
