# Despliegue en Oracle Cloud

El workflow `Deploy agent to Oracle VM` instala el agente CLI y el cliente MCP
por SSH, sin sudo. No crea una VM ni instala el modelo. Compatible con una VM
Linux ARM64 o x86_64 que tenga Bash, GNU tar/coreutils, Node.js >=22, npm y acceso
a npm y WoWAudit por HTTPS. Node debe estar disponible en sesiones SSH no
interactivas (no basta una configuración de nvm en el terminal interactivo).

## Preparación única de la VM

1. Crea un usuario dedicado con acceso SSH por clave y espacio para varias releases.
2. Instala Node.js >=22 y npm para la arquitectura de la VM.
3. Instala llama.cpp y un modelo GGUF como describe el README principal. Configura
   su arranque persistente, por ejemplo con systemd. Su endpoint `/health` debe
   responder en `127.0.0.1:8080`; mantén ese puerto limitado a loopback.
4. Como usuario de despliegue, ejecuta:

   ```bash
   mkdir -p ~/whitebird/shared
   chmod 700 ~/whitebird ~/whitebird/shared
   ```

   Crea `~/whitebird/shared/agent.env` a partir de `.env.example`, con endpoint y
   token Bearer reales de WoWAudit. Después ejecuta:

   ```bash
   chmod 600 ~/whitebird/shared/agent.env
   ```

   Los secretos de WoWAudit se quedan en la VM. La conexión de ChatGPT no los
   proporciona: hay que verificar que WoWAudit admita este tipo de autenticación.
5. Permite SSH desde el runner de GitHub en las reglas de red de Oracle y el
   firewall del sistema. Si la VM solo es accesible por red privada, este workflow
   necesita un runner con acceso a esa red en lugar de `ubuntu-24.04`.

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

En Actions, abre `Deploy agent to Oracle VM` → Run workflow. Selecciona la rama
del agente e introduce en `mcp_ref` un SHA de commit del cliente MCP (recomendado)
o un tag. Se instalan y prueban ambos proyectos en el runner. Se empaquetan sus
package-lock generados y los SHA de origen; la VM usa `npm ci` para instalar las
mismas resoluciones en su propia arquitectura.

La VM vuelve a ejecutar las pruebas y comprueba el modelo y la conexión MCP antes
de activar la release. No ejecuta consultas de jugadores durante el despliegue.
Si un control falla, `current` sigue apuntando a la versión anterior y el job falla.
La comprobación de salud no verifica la calidad de las respuestas del modelo.

Después, por SSH:

```bash
~/whitebird/bin/whitebird-ask '¿Qué loot hemos recibido?'
```

Las versiones quedan en `~/whitebird/releases/<run-id>-<attempt>`. Para rollback,
como el mismo usuario, elige una versión anterior existente:

```bash
ln -s "$HOME/whitebird/releases/ID-ANTERIOR" "$HOME/whitebird/rollback"
mv -Tf "$HOME/whitebird/rollback" "$HOME/whitebird/current"
```

No se borran automáticamente releases; elimina manualmente las antiguas cuando
hayas comprobado el funcionamiento. El agente es un CLI, no un servicio HTTP o
un bot de Discord; este despliegue no crea un daemon para el agente.
