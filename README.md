# Whitebird AI Agent — local-first prototype

A natural-language assistant for WoWAudit MCP and Whitebird bot administration. WoWAudit tools remain read-only. Administrative changes use reviewable proposals and explicit chat controls. Uses a local `llama-server` OpenAI-style chat endpoint at `127.0.0.1:8080`. No paid LLM API and no publicly exposed model listener.

## Control panel

The agent also provides a loopback HTTP service (`npm start`) for the Whitebird
control panel. See [panel integration](docs/control-panel.md) for configuration,
installation, verification and local configuration/runtime diagnostics in the panel chat. The CLI remains available when the service is
stopped. Do not run the CLI or OAuth login concurrently with the service: they
share the OAuth session store.

## Setup (Node >= 20)

From `whitebird-wowaudit-mcp`: `npm install && npm test`.

From this directory: `npm install && npm test`.

Build/install [llama.cpp](https://github.com/ggml-org/llama.cpp) for ARM64, download a legally licensed Qwen3 1.7B GGUF Q4_K_M model into a private `models/` directory, and start:

```bash
./build/bin/llama-server -m /absolute/path/qwen3-1.7b-q4_k_m.gguf \
  --host 127.0.0.1 --port 8080 -c 4096 -t 2
```

Use `-t 1` for a VM with only one OCPU. Do not expose port 8080 outside the VM. Set model path according to the actual downloaded GGUF.

Provide WoWAudit endpoint and authentication variables from `.env.example` in your shell or deployment secret management, then:

```bash
npm run ask -- '¿Qué jugadores necesitan un abalorio concreto?'
```

Las preguntas de ayuda como «¿Qué puedes hacer?» reciben una respuesta directa con las herramientas disponibles, sin consultar el modelo ni ejecutar consultas a WoWAudit.

## Ayuda de los bots de Whitebird

El agente explica WoW Role Sync, Recruitment, Ruleta de alters, Whitebird IA y
el control pane desde el mismo servicio usado por panel y Discord. Puedes pedir
una descripción general o preguntar por una función, comando, permisos o
configuración. Por ejemplo:

- «¿Cómo funciona Recruitment?» o «¿Cómo se acepta un apply?».
- «¿Cómo funciona el ranking de alters?».
- «¿Cómo se configuran los roles de WoW Role Sync?».
- «¿Cómo funcionan los calderos o las propuestas BIS?».
- «¿Cómo se usa Whitebird IA desde Discord?».
- «¿Qué bots conoces?».

La pipeline de Whitebird-context publica el catálogo en el servidor. El agente
lee `WHITEBIRD_CONTEXT_PATH` al arrancar y cada diez segundos, sin acceso a GitHub. Conserva una caché persistente
y usa `src/project-knowledge.js` como respaldo si no dispone de contexto válido.
Las respuestas indican la revisión documental y los límites del despliegue.
Véase [configuración y mantenimiento del contexto](docs/context-knowledge.md).

El panel puede enviar `project` en POST /ask: wow, recruitment, roulette, agent,
agent-discord o panel. Los nombres explícitos tienen prioridad. Cada pregunta
se procesa por separado; la ayuda mantiene `{tool: null, answer}`.

## Respuestas legibles

Después de consultar WoWAudit, el agente convierte los datos en texto con etiquetas
legibles y pide al modelo una explicación en español. Si la explicación falla,
está vacía o contiene JSON o bloques de código, muestra el texto formateado como
respaldo. Las respuestas MCP con JSON en bloques de texto también se decodifican.
El contrato sigue siendo `{tool, answer}`; panel y Discord muestran `answer`.

Se mantiene el límite de 12.000 caracteres del resultado original. Dentro de ese
límite, la vista para el modelo y el respaldo se acotan a 6.000 caracteres,
12 registros por lista y detalles de longitud/profundidad limitada. Si se omite
información, la respuesta incluye un aviso de vista parcial. Las fechas se
conservan como las devuelve WoWAudit, sin inferir una zona horaria. La explicación
del modelo sigue necesitando validación con consultas reales.

## Known limitations

- Use the OAuth-enabled MCP client revision and complete the browser login described in deploy/README.md. OAuth login and tool discovery against `https://wowaudit.com/mcp` were verified on Oracle on 2026-11-13; do not reuse ChatGPT tokens.
- Tool selection depends on the local model's ability to follow strict JSON. The MCP client rejects unsupported tool choices and parameters. WoWAudit tools remain read-only.
- Tiny models may perform poorly with many tools. The agent exposes a shortlist of read tools, only one call per question.
- Discord adapter: see [setup and activation](docs/discord.md) for `/whitebird-ask`, role/channel restrictions and private replies. Requires the local agent service.
- Not optimized for simultaneous users. Run one conversation at a time until benchmarking on Oracle A1.

## Oracle Cloud / GitHub Actions

See [deployment instructions](deploy/README.md) for the GitHub Actions
pipeline (automatic on updates to main, with optional manual runs), VM prerequisites, SSH secrets, service restarts, runtime checks and rollback.


## Administración desde la IA

Conecta las herramientas del panel para preguntar «¿Cómo está configurado WoW
Role Sync?», «Cambia el horario de sincronización a las 5» o «Investiga por qué
Recruitment no puede publicar en su canal». El agente puede consultar la
configuración guardada, estado, logs redactados y permisos reales de Discord,
y elegir comprobaciones sucesivas a partir de la evidencia.

En el entorno del agente configura PANEL_TOOLS_URL (por defecto
http://127.0.0.1:3080) y PANEL_TOOLS_TOKEN. En el entorno del panel configura
PANEL_AGENT_TOOLS_TOKEN con el mismo secreto aleatorio de al menos 32 caracteres.
Este secreto es independiente del token de /ask. La API de herramientas del
panel está en /api/agent-tools, protegida por Bearer y loopback.

El modelo dispone de list_projects, read_config, runtime_state, read_logs,
discord_permissions, diagnose, prepare_config y prepare_restart. La investigación
admite hasta cinco decisiones y 150 segundos. Si el modelo falla, muestra la
evidencia recogida. Logs y campos de texto se tratan como datos externos.

Las propuestas muestran los valores anteriores y nuevos. Guardar valida la
revisión y usa el guardado atómico del panel. Aplicar y reiniciar usa la
configuración guardada y un trabajo consultable con Estado. Las confirmaciones
se ofrecen en panel y Discord. Se vinculan al solicitante y caducan a los 15
minutos. El panel conserva las propuestas en memoria, por lo que reiniciarlo las
invalida. Las confirmaciones repetidas son idempotentes durante su vigencia.
Un fallo de aplicación conserva el archivo guardado e indica revisar estado y
logs antes de preparar otro reinicio. Las credenciales se editan mediante los
formularios del panel.

Para bots Docker se mantiene PANEL_RESTART_ENABLED. Para los servicios IA,
PANEL_SYSTEMD_RESTART_ENABLED=true habilita las solicitudes de reinicio de las
unidades fijas whitebird-ai-agent y whitebird-ai-discord. El usuario del panel
necesita permisos efectivos para esas operaciones. Los reinicios son asíncronos
para poder consultar su resultado aunque se reinicie el agente o su adaptador.
La confirmación de reinicio se contrasta con la conexión y funcionamiento real.

La inspección Discord usa el token propio del componente y solo consultas GET.
Comprueba permisos de servidor, overwrites de canales configurados o un canal
concreto, roles existentes y jerarquía del bot. Cubre canales de texto,
anuncios, categorías y foros. Los hilos y permisos particulares de comandos
requieren inspección específica. Véase el
[algoritmo de permisos de Discord](https://docs.discord.com/developers/topics/permissions).

La autorización de Discord sigue usando servidor, canales y roles permitidos
existentes. Esos usuarios pasan a poder utilizar la administración al conectar
las herramientas. Las operaciones y credenciales permanecen en el backend del
panel. La respuesta HTTP conserva tool y answer, con proposal opcional para
el flujo de revisión. POST /actions del agente procesa confirmaciones autenticadas.

## Documentación del chatbot

Mantener [docs/knowledge.json](docs/knowledge.json) junto con cada cambio de comportamiento. La pipeline publica la versión verificada en este mismo repositorio y Whitebird-context la recoge con acceso de lectura. Ver [flujo y comprobaciones](docs/context-publication.md).

## Consultas de registros de bots

El agente consulta decisiones de Recruitment y vinculaciones, cambios de roles,
calderos, listas BIS y felicitaciones de WoW Sync mediante el panel en solo lectura.
«Cuántos applies hemos aceptado» consulta SQLite; «cómo se acepta un apply»
conserva la ayuda. Véase [herramientas, ejemplos y activación](docs/bot-data.md).
