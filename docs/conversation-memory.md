# Memoria temporal entre consultas

Revisión: 2026-11-15. Implementada en el código de `5961e81` (merge de #8).
Fuentes: src/conversation-memory.js, src/server.js y src/discord.js.
El despliegue y el envío de UUID desde el panel requieren comprobación en destino.

El servicio /ask conserva solo el último contexto de lectura reconocido: tipo de
consulta, herramienta, periodo, personaje y filtros. No almacena respuestas,
resultados, transcripciones ni archivos de conversación. No requiere base de datos,
secretos nuevos o entrenamiento del modelo.

Discord envía `conversationId=discord:<canal>`; la clave combina ese valor con
`actor=discord:<servidor>:<usuario>`. Para activar memoria en el panel, su integración debe enviar un UUID por página/pestaña; el proxy
construye `conversationId=panel:<UUID>` y `actor=panel:<csrf>`. Un nuevo UUID tras recargar
la página inicia otra conversación. CLI y llamadas sin una identidad/conversación
reconocibles siguen sin memoria, evitando un contexto global para actor=api.
Los identificadores no sustituyen la autenticación ni los permisos existentes.

Caduca tras 15 minutos de inactividad. Se comprueba la caducidad al leer y se purga
cada minuto; máximo 256 conversaciones con expulsión de las más antiguas. El cierre
del servicio limpia memoria y temporizador. No sobrevive a reinicios. «Olvida el
contexto», «borra el contexto» o «nueva conversación» borra solo la conversación
actual. Una consulta completa sustituye la anterior; cambiar el proyecto del panel
invalida el contexto anterior. Una pregunta completa de ayuda o administración también
lo descarta, aunque no cree un nuevo contexto de lectura. Una continuación sin contexto o ambigua pide precisión.

Ejemplos:

- «Quién ha looteado más» → «¿y el que menos?»: consulta de nuevo WoWAudit con las
  mismas fechas concretas devueltas por la fuente, sin recalcular el periodo relativo.
- «Quién ha looteado más este mes» → «¿y Uno?»: recuento individual de Uno con ese
  periodo. «¿Y mes pasado?» sustituye las fechas y conserva el personaje.
- Una mención recordada se resuelve de nuevo en el panel en cada consulta; no guarda
  el resultado de su vinculación. Los cambios de main se reflejan en la siguiente.
- Las continuaciones de registros conservan personaje y periodo; las consultas MCP
  generales reciben únicamente el plan de lectura anterior como contexto, sin datos
  antiguos. El modelo interpreta estos últimos casos dentro de las herramientas
  permitidas; no se promete interpretar cualquier frase.

Para el mínimo de loot se consulta list_roster y se incluye cero asignaciones entre
los personajes actuales. No se infiere roster histórico o asistencia. No se declara
un mínimo con roster/loot incompletos o nombres repetidos sin identidad inequívoca.
Ver [alcance del loot](loot-ranking.md). Todas las categorías cuentan.

Se conservan las restricciones de Discord, respuestas privadas, menciones
silenciadas, equipo MCP y llamadas autenticadas al panel. La memoria no hereda
confirmaciones ni acciones administrativas y no puede guardar/aplicar cambios.
Las propuestas mantienen su flujo explícito de revisión y confirmación.
Las continuaciones de calderos y BIS requieren una consulta completa; no se
reutilizan sus filtros automáticamente.

Desplegar la revisión del panel que envía el UUID y después el agente. Discord usa
el mismo despliegue del agente; no hace falta registrar otra vez el comando.
No se modifican ni reinician Recruitment o WoW Sync.
