# Whitebird AI Agent — local-first prototype

A simple, **read-only** natural-language assistant for WoWAudit MCP. Uses a local `llama-server` OpenAI-style chat endpoint at `127.0.0.1:8080`. No paid LLM API and no publicly exposed model listener.

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

src/project-knowledge.js contiene resúmenes revisados contra documentación y
código el 2026-11-15. src/project-help.js identifica el componente y el tema y
responde antes de seleccionar herramientas MCP o llamar al modelo. El contrato
sigue siendo {tool: null, answer}. Los textos caben completos en Discord.

El panel puede enviar project como contexto opcional en POST /ask, con uno de
wow, recruitment, roulette, agent, agent-discord o panel. Sirve para preguntas
como «¿Cómo funciona?» al tener seleccionado un componente. Los nombres
explícitos tienen prioridad. En Discord, indica el bot o su comando. Cada
pregunta se procesa por separado.

Las fuentes revisadas son README.md, src/wow-sync.js y src/index.js de
whitebird-wow-role-sync e0a4f9f; README.md, src/index.js y src/register-commands.js
de whitebird-recruitment-bot eb9a3f9; README.md y src/register-commands.js de
sacelean/whitebird-wow-wheel en main; README.md y docs/ai-agent.md del panel, y
el código del propio agente. Los campos source de cada proyecto registran las
fuentes. Revisa los resúmenes cuando cambie el comportamiento de esos proyectos.
La instalación efectiva y los errores reales se comprueban con el diagnóstico
del panel. Esta ayuda es un catálogo curado de funcionamiento y comandos, sin
lectura automática de repositorios ni historial conversacional.

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
- Tool selection depends on the local model's ability to follow strict JSON. If the model picks the wrong tool or parameters, the client rejects it; no writes are allowed.
- Tiny models may perform poorly with many tools. The agent exposes a shortlist of read tools, only one call per question.
- Discord adapter: see [setup and activation](docs/discord.md) for `/whitebird-ask`, role/channel restrictions and private replies. Requires the local agent service.
- Not optimized for simultaneous users. Run one conversation at a time until benchmarking on Oracle A1.

## Oracle Cloud / GitHub Actions

See [deployment instructions](deploy/README.md) for the GitHub Actions
pipeline (automatic on updates to main, with optional manual runs), VM prerequisites, SSH secrets, service restarts, runtime checks and rollback.
