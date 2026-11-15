# Consultas de registros de Recruitment y WoW Sync

El agente distingue ayuda (cómo funciona) de consultas de datos (cuántos, últimas,
quién lleva). Las consultas reconocidas se resuelven con herramientas del panel
antes del catálogo, del modelo y de WoWAudit. Panel y Discord comparten /ask.
No se envía SQL del usuario ni se permite seleccionar archivos o servidores.

## Herramientas de solo lectura

| Herramienta | Datos y alcance |
| --- | --- |
| recruitment_summary | Aceptadas/rechazadas completadas y pendientes; no solicitudes abiertas |
| recruitment_recent | Decisiones registradas, con personaje, reino, fecha y estado |
| wow_links | Número y lista de vinculaciones actuales guardadas; no roster vivo |
| wow_sync_history | Cambios de roles registrados; no ciclos de sincronización |
| wow_cauldrons | Reparto semanal actual; no entregas ni recordatorios confirmados |
| wow_bis_summary | Propuestas por estado y número de listas activas; no objetos de una lista |
| wow_promotions | Felicitaciones de ascenso y su estado; no todos los ascensos históricos |

Cada consulta se limita al DISCORD_GUILD_ID guardado en el archivo del componente
registrado en el panel. El backend resuelve DATABASE_PATH desde ese componente,
abre SQLite con readonly, fileMustExist y query_only, usa parámetros preparados
y no importa el código de los bots. No crea bases ni modifica esquemas.
Tablas ausentes o ilegibles producen «no disponible», nunca un cero inventado.

El registro de Recruitment empieza cuando el bot incorporó las decisiones;
no reconstruye solicitudes antiguas ni abiertas a partir de transcripciones.
Los reintentos de una decisión conservan un único registro. Completada y pendiente
son los estados persistidos, no una comprobación en vivo de Discord.

## Preguntas de ejemplo

- ¿Cuántos applies hemos aceptado?
- ¿Cuántas solicitudes hemos rechazado este mes?
- Muestra los últimos 3 applies aceptados.
- ¿Quién ha sido el último en ser reclutado? (una aceptación completada registrada).
- ¿Cuántos personajes tenemos vinculados en WoW Sync?
- Muéstrame el historial de cambios de roles de WoW Sync hoy.
- ¿Quién lleva los calderos el miércoles?
- ¿Cuántas listas BIS activas hay?
- Lista los últimos ascensos de WoW Sync.

Para filtrar personaje, escribirlo entre comillas: historial de WoW Sync de
"Personaje". El filtro es una coincidencia parcial literal, sin comodines SQL.
Se muestran cinco filas por defecto, máximo diez, indicando el total y vista
parcial. Solicitar límites mediante «últimos 3 registros/applies/cambios…».
Un resumen no devuelve nombres Discord, IDs de solicitantes/oficiales, motivos
ni transcripciones. Los listados solo incluyen campos explícitos de cada consulta.

## Fechas

API: from/to opcionales YYYY-MM-DD, ambos días inclusivos en Europe/Madrid.
La base conserva marcas UTC; la consulta convierte límites locales a UTC,
incluyendo cambios de horario de verano. No se permite filtrar periodos en
vinculaciones/BIS actuales como si fueran una reconstrucción histórica.

El agente reconoce hoy, ayer, esta semana (lunes a hoy), semana pasada, este mes,
mes pasado, este año, últimos N días (incluye hoy, máximo 366), en YYYY y rangos
«desde YYYY-MM-DD hasta YYYY-MM-DD». Intervalos no entendidos requieren precisión.
Los calderos se filtran por un día de semana, hoy o mañana; muestran siempre el
reparto semanal actual. Las fechas de decisión no equivalen a la de finalización.
El primer evento disponible no prueba cuándo se empezó a registrar información.

## Activación y límites

Requiere incorporar y desplegar el panel y el agente actualizados. No hay nueva
credencial: se reutilizan PANEL_TOOLS_URL/PANEL_TOOLS_TOKEN y PANEL_AGENT_TOOLS_TOKEN,
con el mismo secreto de al menos 32 caracteres y loopback. Las rutas de .env y
SQLite deben ser las reales del servidor. Las tablas ya existen en los bots
actuales; esta implementación no cambia ni despliega esos bots.
La autorización y respuestas privadas de Discord se mantienen; los usuarios
permitidos por servidor, canal y roles acceden a estas consultas igual que a las
herramientas del panel existentes. Revisar esas listas según el acceso deseado.

No todas las preguntas naturales son reconocibles ni todas las propiedades se
guardan en SQLite. Ante una consulta no soportada se pide precisión o se indica
su límite. No se reemplaza un dato ausente por una explicación o por una inferencia
sobre Blizzard, Discord o WoWAudit. La ayuda documental sigue el flujo del contexto.

Pruebas usan SQLite temporal y servidores HTTP locales, con el recorrido Discord
→ agente → cliente autenticado del panel. No se consulta producción en esta tarea.

## Presentación de los recuentos

El resumen de Recruitment se redacta en frases breves, con singular/plural y sin
mostrar categorías a cero. Las decisiones pendientes siguen diferenciadas de las
completadas. Las fechas se presentan en español y horario de Madrid, sin la hora
UTC ni etiquetas internas. La fecha más antigua solo aparece en recuentos globales,
no como si fuera el inicio de la captura ni el primer registro de un personaje.
Una única aclaración conserva el límite: no se incluyen solicitudes abiertas ni
decisiones antiguas no guardadas. La respuesta se construye desde los números del
panel sin llamar al modelo; se mantiene el mismo contrato de herramientas.

«Reclutado/reclutada» identifica Recruitment y filtra aceptaciones completadas.
«Último/última» sin cantidad solicita una fila; los límites numéricos prevalecen.
Se devuelve personaje y reino guardados, no identidad Discord ni roster en vivo.
La fecha corresponde a la decisión registrada, no acredita su hora de finalización.
