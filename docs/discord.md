# Consultar desde Discord

Implementado el 2026-11-14. Pendiente de despliegue y prueba real en Discord.

Discord → bot dedicado `/whitebird-ask pregunta:…` → API local `/ask` → modelo y
MCP existentes. El adaptador no abre puertos ni accede al almacén OAuth. Panel
y Discord comparten el límite de una consulta del servidor; HTTP 429 si está
ocupado. No lanzar otro CLI durante el servicio.

## Configurar

1. Crear una aplicación dedicada en Discord Developer Portal, añadir un bot y
   obtener su token. No necesita intents privilegiados ni Message Content.
2. Invitarla al servidor con scopes `bot` y `applications.commands`, sin
   Administrator. Permitir acceso al canal elegido y uso de comandos de
   aplicaciones a los usuarios autorizados.
3. Crear `~/whitebird/shared/discord.env` con permisos 0600, fuera del repositorio:

   ```dotenv
   DISCORD_BOT_TOKEN=SECRETO_DEL_BOT
   DISCORD_APPLICATION_ID=ID_APLICACION
   DISCORD_GUILD_ID=ID_SERVIDOR
   DISCORD_CHANNEL_IDS=ID_CANAL
   DISCORD_ROLE_IDS=ID_ROL_AUTORIZADO
   DISCORD_AGENT_URL=http://127.0.0.1:3090
   AGENT_API_TOKEN=MISMO_SECRETO_DEL_SERVICIO_AGENTE
   ```

   Canales y roles admiten varios IDs separados por comas. Ambas listas son
   obligatorias. Un usuario debe tener al menos uno de los roles autorizados;
   también se comprueban servidor y canal, incluso para administradores.
   Habilitar modo desarrollador en Discord para copiar los IDs. No compartir
   tokens en el chat. El bot no necesita las variables OAuth.
4. Instalar dependencias y registrar el comando desde la release del agente:

   ```sh
   npm ci --ignore-scripts --no-audit --no-fund
   node --env-file=/home/ubuntu/whitebird/shared/discord.env src/discord.js --register
   ```

   El registro afecta solo a `/whitebird-ask` en ese servidor y se repite cuando
   cambie su definición. No elimina otros comandos.
5. Con el servicio HTTP del agente configurado y activo, ajustar usuario y rutas
   de `deploy/whitebird-ai-discord.service` e instalarlo:

   ```sh
   sudo install -m 0644 deploy/whitebird-ai-discord.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now whitebird-ai-discord
   sudo systemctl status whitebird-ai-discord
   ```

## Verificar y operar

Usar `/whitebird-ask pregunta:¿Qué eventos tenemos próximamente?` en el canal
autorizado. Respuesta privada (ephemeral), sin menciones, y recorte explícito si
supera el tamaño admitido. Espera máxima del backend: cinco minutos. Cada usuario
tiene 30 segundos entre consultas; el límite se reinicia al reiniciar el bot.
Las respuestas pueden contener datos de WoWAudit: elegir roles con acceso al
equipo configurado. No hay conversaciones persistentes ni historial.

Comprobar rechazo desde otro canal/rol, agente parado y consulta simultánea
desde el panel. Los fallos muestran un mensaje genérico sin credenciales.

La pipeline de main detiene y arranca los servicios activos o habilitados al
actualizar la release, y vuelve a registrar el comando si gestiona Discord.
Para renovar OAuth o actualizar fuera del instalador, parar este servicio y el
agente antes, arrancarlos después y repetir una consulta real. Para rollback a una release sin
adaptador, mantener Discord detenido y eliminar `/whitebird-ask` desde la aplicación
si ya no se usa. No reutilizar el token de un bot que ya esté en ejecución.
