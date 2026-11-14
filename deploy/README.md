# Despliegue en Oracle Cloud

## Estado comprobado el 13 de noviembre de 2026

- Release activa en la VM: `20261113153958-1` (despliegue manual por SSH).
- OAuth, modelo local y conexión MCP verificados; 12 pruebas pasan en la VM.
- La consulta de próximos eventos ejecuta `list_events` para Whitebird (66082).
- Pendiente mejorar la presentación: en la prueba real el modelo copió JSON y
  lo truncó al alcanzar el límite de salida, en lugar de resumirlo en español.

## Procedimiento de despliegue

El workflow `Deploy agent to Oracle VM` instala el agente CLI y el cliente MCP
por SSH al actualizar `main` (incluido cada merge), y también permite ejecución
manual. No crea una VM ni instala el modelo. Para gestionar servicios ya activos
o habilitados requiere permisos `sudo -n` de start/stop sobre
`whitebird-ai-agent.service` y `whitebird-ai-discord.service`. Compatible con una VM
Linux ARM64 o x86_64 que tenga Bash, GNU tar/coreutils, Node.js >=22, npm y acceso
a npm y WoWAudit por HTTPS. Node debe estar disponible en sesiones SSH no
interactivas (no basta una configuración de nvm en el terminal interactivo).

## Preparación única de la VM

1. Crea un usuario dedicado con acceso SSH por clave y espacio para varias releases.
2. Instala Node.js >=22 y npm para la arquitectura de la VM.
3. Arranca el modelo con Docker Compose como se explica abajo. Su endpoint
   `/health` debe responder en `127.0.0.1:8080`.
4. Como usuario de despliegue, ejecuta:

   ```bash
   mkdir -p ~/whitebird/shared
   chmod 700 ~/whitebird ~/whitebird/shared
   ```

   Crea `~/whitebird/shared/agent.env` a partir de `.env.example`, con endpoint y
   configuración OAuth de WoWAudit. Después ejecuta:

   ```bash
   chmod 600 ~/whitebird/shared/agent.env
   ```

   La sesión OAuth se queda en la VM. Completa el login descrito abajo antes
   del despliegue; la conexión de ChatGPT no transfiere su autorización.
5. Permite SSH desde el runner de GitHub en las reglas de red de Oracle y el
   firewall del sistema. Si la VM solo es accesible por red privada, este workflow
   necesita un runner con acceso a esa red en lugar de `ubuntu-24.04`.

## Modelo con Docker Compose (usuario ubuntu)

Docker y Compose ya están instalados en la VM. Copia `deploy/compose.yaml` de
este repositorio a `/home/ubuntu/whitebird/model/compose.yaml`. Puedes hacerlo
con estos comandos desde tu Mac, situado en el directorio del repositorio
(sustituye `IP_VM` por tu host real):

```bash
ssh -i ~/Downloads/ssh-key-2026-10-03.key ubuntu@IP_VM 'mkdir -p ~/whitebird/model'
scp -i ~/Downloads/ssh-key-2026-10-03.key deploy/compose.yaml ubuntu@IP_VM:whitebird/model/compose.yaml
```

En la VM:

```bash
sudo systemctl enable --now docker
cd ~/whitebird/model
sudo docker compose config --quiet
sudo docker compose pull
sudo docker compose up -d
sudo docker compose logs --tail=50 -f llama
```

La primera ejecución descarga Qwen3 1.7B Q4_K_M de Hugging Face y lo guarda en
el volumen `whitebird-model_model-cache`. Espera a que cargue; sal de los logs
con Ctrl+C (el contenedor sigue funcionando). Después comprueba:

```bash
curl --fail http://127.0.0.1:8080/health
```

Debe responder `{"status":"ok"}`. Durante la carga puede devolver HTTP 503.
El contenedor se reinicia automáticamente después de reiniciar Docker o la VM.
Dentro del contenedor escucha en `0.0.0.0`; Docker publica el puerto únicamente
en `127.0.0.1` de la VM. No abras el puerto 8080 en Oracle.

Si la VM tiene una sola CPU disponible, crea `~/whitebird/model/.env` con
`LLAMA_THREADS=1` antes de arrancar. El archivo `.env` de Compose es independiente
de `~/whitebird/shared/agent.env`, que contiene las credenciales del agente.

La imagen oficial `ghcr.io/ggml-org/llama.cpp:server` soporta ARM64 y AMD64;
Docker selecciona la arquitectura de la VM. El tag `server` puede cambiar:
para fijar una versión, configura `LLAMA_IMAGE=ghcr.io/ggml-org/llama.cpp@sha256:DIGEST_REAL`
en el `.env` de Compose con el digest verificado de la imagen que hayas probado.

Para detenerlo, `sudo docker compose down`. El volumen se conserva; no uses
`down -v` si quieres conservar el modelo descargado. La pipeline despliega el
agente y comprueba este servicio; no actualiza ni reinicia el contenedor.

Referencias: [Docker oficial de llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/docs/docker.md)
y [modelo GGUF](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF).

## OAuth: autorización inicial antes de desplegar

Usa la revisión del cliente MCP que incluye `src/oauth.js` y `src/login.js`.
Los cambios de ese repositorio deben subirse a GitHub y su SHA debe usarse como
`mcp_ref` en una ejecución manual o fijarse en `deploy/mcp-ref` para los
despliegues automáticos. La pipeline comprueba su presencia antes del despliegue.

Configura `~/whitebird/shared/agent.env` con `.env.example`: endpoint MCP oficial,
equipo, modelo y rutas OAuth. Elimina `WOWAUDIT_MCP_TOKEN`; ya no se utiliza.
El endpoint facilitado para esta instalación es `https://wowaudit.com/mcp`,
ya incluido en `.env.example`.
El registro dinámico, el login OAuth y el listado de herramientas se verificaron
contra el servidor real desde esta VM el 13 de noviembre de 2026.

Para preparar el primer login sin una release activa, desde tu Mac, en la carpeta
de este proyecto, copia el cliente local (incluye sus cambios OAuth actuales):

```bash
tar -czf /tmp/whitebird-mcp-login.tar.gz -C ../whitebird-wowaudit-mcp src package.json package-lock.json
scp -i ~/Downloads/ssh-key-2026-10-03.key /tmp/whitebird-mcp-login.tar.gz ubuntu@130.162.51.21:whitebird/mcp-login.tar.gz
ssh -i ~/Downloads/ssh-key-2026-10-03.key -o ExitOnForwardFailure=yes -L 8787:127.0.0.1:8787 ubuntu@130.162.51.21
```

Si el cliente ya está instalado en `~/whitebird-wowaudit-mcp-setup`, reutiliza esa
carpeta: no necesitas copiarlo ni extraerlo otra vez. Abre el túnel SSH anterior,
entra en esa carpeta y ejecuta el comando de login con el entorno compartido.

En esa sesión SSH de la VM:

```bash
mkdir -p ~/whitebird/oauth-setup
tar -xzf ~/whitebird/mcp-login.tar.gz -C ~/whitebird/oauth-setup
cd ~/whitebird/oauth-setup
npm ci --ignore-scripts --no-audit --no-fund
node --env-file="$HOME/whitebird/shared/agent.env" src/login.js
```

Abre la URL mostrada en el navegador de tu Mac y autoriza WoWAudit. Mantén la
sesión SSH abierta: el callback `http://127.0.0.1:8787/callback` llega a la VM
por el túnel. No abras 8787 en Oracle. El login expira a los cinco minutos.

El cliente existente usa PKCE, comprueba state e issuer y guarda la sesión con
permisos 0600 en `/home/ubuntu/whitebird/shared/wowaudit-oauth.json`. La sesión
permanece fuera de las releases y el SDK puede renovar los tokens. No copies el
JSON a GitHub ni ejecutes varios procesos que renueven esa sesión a la vez.

Si WoWAudit no permite registro dinámico, tendrás que registrar un cliente con
ese callback y configurar `WOWAUDIT_OAUTH_CLIENT_ID`, `WOWAUDIT_OAUTH_ISSUER` y,
solo si corresponde, `WOWAUDIT_OAUTH_CLIENT_SECRET`. El login real es necesario
para confirmar qué política admite WoWAudit; no se reutiliza el cliente de ChatGPT.

Para volver a autorizar después de desplegar, abre el mismo túnel y ejecuta:

```bash
cd ~/whitebird/current/whitebird-ai-agent
node --env-file="$HOME/whitebird/shared/agent.env" ../whitebird-wowaudit-mcp/src/login.js
```

Referencia: [OAuth del SDK MCP](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/oauth.md).

## Configuración de GitHub

Crea el environment `oracle` en este repositorio y limita sus ramas de despliegue
a la rama de confianza. Añade estos secrets en ese environment (o en el repositorio
si tu plan no admite secrets de environment):

| Secret | Contenido |
| --- | --- |
| `ORACLE_SSH_HOST` | IP pública o DNS IPv4 de la VM |
| `ORACLE_SSH_USER` | Usuario Linux de despliegue |
| `ORACLE_SSH_KEY` | Clave privada SSH dedicada, sin passphrase |
| `ORACLE_SSH_KNOWN_HOSTS` | Línea de known_hosts de la VM, verificada por un canal de confianza |
| `MCP_REPO_TOKEN` | Token con Contents: read sobre `sacelean/whitebird-wowaudit-mcp`, si es privado |

Variable opcional `ORACLE_SSH_PORT`: puerto SSH; por defecto 22. Con un puerto
personalizado, known_hosts debe usar `[host]:puerto`. No se acepta automáticamente
una clave de servidor desconocida. El `GITHUB_TOKEN` habitual no da acceso a otro
repositorio privado.

## Ejecutar y comprobar

Cada actualización de `main`, incluidos los merges, lanza `Deploy agent to Oracle VM`.
Los despliegues automáticos usan el SHA del cliente MCP fijado en `deploy/mcp-ref`;
actualiza ese archivo en un PR para cambiar de versión del cliente. No se sigue
la rama main de MCP automáticamente.

También puedes usar Actions → `Deploy agent to Oracle VM` → Run workflow.
`mcp_ref` es opcional: vacío usa el archivo fijado; un SHA o tag permite elegir
otra versión para esa ejecución. Se conserva el environment `oracle` y sus reglas
de protección; si exige aprobación, el job esperará esa aprobación.

La pipeline prueba ambos proyectos, empaqueta fuentes, locks y SHA, y transmite
la release por SSH. La VM usa `npm ci`, repite las pruebas y toma un bloqueo
exclusivo de despliegue. Las instalaciones y pruebas se realizan antes de detener
los servicios, para reducir la interrupción.

Si los servicios del agente/Discord están activos o habilitados, el instalador:

1. Comprueba permisos no interactivos para start/stop y los archivos necesarios.
2. Detiene Discord y después el agente, antes de las comprobaciones OAuth.
3. Comprueba modelo y MCP y registra `/whitebird-ask` si gestiona Discord.
4. Activa `current`, arranca el agente, verifica `/health` autenticado y arranca
   Discord. Comprueba que ambos procesos siguen activos.

Si falla después de detener servicios, intenta recuperar el enlace anterior y
arrancar los servicios gestionados, manteniendo el job como fallido. No revierte
el registro remoto del comando Discord. Un fallo de permisos o recuperación
puede requerir intervención manual; revisar el log del job. Los servicios
inactivos y deshabilitados se mantienen parados; el instalador no instala ni
habilita nuevas unidades systemd ni modifica sus archivos de entorno.

La comprobación de Discord confirma proceso activo, no una consulta real ni la
recepción del evento de conexión. La comprobación del modelo/MCP no acredita la
calidad de sus respuestas. Para una consulta manual CLI, detener primero ambos
servicios y arrancarlos al terminar para no compartir simultáneamente OAuth.

Las versiones quedan en `~/whitebird/releases/<run-id>-<attempt>`. Para rollback,
detén primero los dos servicios y, como el mismo usuario, elige una versión
anterior existente:

```bash
ln -s "$HOME/whitebird/releases/ID-ANTERIOR" "$HOME/whitebird/rollback"
mv -Tf "$HOME/whitebird/rollback" "$HOME/whitebird/current"
```

Arranca después los servicios compatibles con la versión restaurada y verifica
su estado. No se borran automáticamente releases. Para la instalación inicial
de los servicios y la conexión del panel, sigue
[la guía de integración](../docs/control-panel.md). Las plantillas systemd usan
`--preserve-symlinks-main` para arrancar correctamente mediante `current`.
Si las unidades existentes no tienen ese argumento, actualízalas una vez y
ejecuta `sudo systemctl daemon-reload` antes del primer despliegue automático.
