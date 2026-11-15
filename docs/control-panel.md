# Conexión con Whitebird-control-pane

Implementado el 2026-11-14. No desplegado ni verificado contra Oracle/WoWAudit
en esta sesión. Las pruebas usan dobles del modelo y MCP, sin datos de miembros.

## Contrato

Navegador → API del panel `POST /api/agent` (Host/Origin y CSRF existentes) →
agente `POST /ask` (Bearer) → `askWhitebird()` → modelo local y MCP de lectura.
El navegador nunca recibe el token del servicio ni la sesión OAuth.

El agente escucha exclusivamente en `127.0.0.1:3090`; el panel conserva su
puerto 3080. Ambos servicios deben estar en el mismo host. El modelo permanece
en loopback:8080. No abrir estos puertos en Oracle.

Entrada JSON: `{"question":"¿Qué eventos tenemos próximamente?"}`.
Salida JSON: `{"tool":"list_events","answer":"…"}` (tool también admite null).
Preguntas: 1–1000 caracteres después de quitar espacios externos; cuerpo máximo
8192 bytes. Solo una consulta en curso: HTTP 429 si está ocupado, sin cola
persistente ni reintentos automáticos. Un fallo del modelo/MCP devuelve 502 sin
detalles internos. `/health` exige el mismo Bearer e indica proceso activo y busy;
no verifica la salud del modelo ni vigencia de OAuth.

## Instalar el agente

1. Instalar una release con este código y el cliente MCP OAuth, siguiendo
   [la guía existente](../deploy/README.md). El instalador no crea nuevas unidades; requiere los pasos siguientes para
   la primera instalación. Después gestiona los servicios activos o habilitados.
2. Completar el login OAuth antes de arrancar el servicio. Añadir a
   `~/whitebird/shared/agent.env` `AGENT_PORT=3090` y `AGENT_API_TOKEN` con un
   secreto aleatorio de al menos 32 caracteres (por ejemplo, generado con
   `openssl rand -hex 32`). Mantener modo 0600 y fuera del repositorio.
3. Ajustar usuario, grupo, rutas y ubicación de Node del
   [servicio systemd](../deploy/whitebird-ai-agent.service) a la instalación.
   El ejemplo usa ubuntu y Node en `/usr/bin/node`. Instalar como administrador:

   ```sh
   sudo install -m 0644 deploy/whitebird-ai-agent.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now whitebird-ai-agent
   sudo systemctl status whitebird-ai-agent
   ```

También admite arranque manual desde la raíz del agente:
`node --env-file=/ruta/agent.env src/server.js`.
Debe existir una única instancia que use el almacén OAuth. Parar el servicio
antes de usar el CLI o renovar el login manualmente. El apagado espera la
consulta en curso antes de cerrar MCP.

La pipeline al actualizar main detiene y arranca los servicios activos o
habilitados, evitando concurrencia OAuth durante sus comprobaciones. Después
comprobar una consulta desde el panel. Para despliegues fuera del instalador,
parar primero los servicios y arrancarlos al terminar. Para rollback, restaurar la release y
reiniciar el servicio. Una release anterior sin `src/server.js` requiere dejar
el servicio parado y desactivar la integración del panel.

## Instalar el lado del panel

[integrations/control-pane/](../integrations/control-pane/) contiene los archivos
del panel afectados: `server.js`, `agent-api.js`, `diagnostics.js`, `public/index.html` y
`public/agent.js`. Los dos archivos existentes parten del main remoto consultado
el 2026-11-14; revisar diferencias si el panel ha cambiado antes de incorporarlos.
No sustituir el resto del panel ni sus dependencias.

En el entorno del servicio del panel, configurar:

```dotenv
PANEL_AGENT_URL=http://127.0.0.1:3090
PANEL_AGENT_TOKEN=EL_MISMO_SECRETO_DE_AGENT_API_TOKEN
```

El panel no necesita leer `agent.env` ni el almacén OAuth. Su archivo de entorno
debe mantener permisos restringidos. Reiniciar solo el panel después de
incorporar los archivos y configurar las variables. Un valor URL inválido impide
arrancar; si faltan variables, el formulario indica integración sin configurar.
La sección «Consultar al agente de IA» funciona aunque no haya bots configurados.
Las respuestas se muestran como texto, sin interpretar HTML del modelo.

## Verificar

Ejecutar `npm test` en el agente y en el panel después de incorporar los cambios.
Abrir el panel mediante su túnel SSH y preguntar por próximos eventos. Comprobar
que aparece `list_events` y una respuesta legible. Mientras procesa, una segunda
consulta devuelve ocupado. Comprobar servicio parado y token incorrecto: deben
mostrar un error genérico sin credenciales.

La calidad de la síntesis y el truncamiento histórico del modelo siguen pendientes
de validación real. La integración no añade comandos Discord ni modifica bots.


## Diagnóstico del panel (2026-11-15)

El chat del panel admite «diagnostica el panel», «¿por qué Recruitment no
arranca?» y «revisa los logs del agente». La implementación reside en
Whitebird-control-pane y se incluye una copia del adaptador en
integrations/control-pane. Usa los esquemas actuales de config.js del panel,
incluidos agentModules y agentDiscordModules. Incorpora los cambios sobre una
revisión actual del panel y conserva sus archivos y dependencias restantes.

Los diagnósticos se resuelven en el backend del panel con configuración guardada,
comparaciones de conexiones, metadatos de archivos, comandos fijos de lectura y
/health local. Funcionan aunque el agente o el modelo estén caídos. Las consultas
WoWAudit conservan el flujo /ask existente. La respuesta sigue {tool, answer}.

El navegador recibe resultados y pasos de corrección, con tool=panel_diagnostics.
Los valores de configuración, logs originales y errores internos permanecen en
el backend. Los logs se clasifican por patrones reconocidos en las últimas 60
líneas, con límite de cinco segundos y 128 KiB por comando. Los permisos reales
de Discord, la vigencia OAuth y cambios guardados pendientes de aplicar requieren
comprobación adicional. Los errores de logs pueden ser históricos.

Pruebas locales del panel: validación, secretos, comandos acotados, conexiones,
exclusión de diagnósticos simultáneos y recorrido HTTP con CSRF y agente ausente.
Pendiente de verificación en la VM con sus permisos, servicios y datos reales.
