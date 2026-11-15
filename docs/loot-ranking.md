# Recuento de loot por personaje

Revisión: 2026-11-15. Implementado en src/loot-ranking.js y src/agent.js;
pendiente de merge/despliegue y verificación en la VM.

«Quién ha looteado más» y «quién ha recibido más botín» llaman directamente a
loot_history con limit=200. El cliente MCP conserva el equipo configurado e
inyecta team; el usuario y el modelo no lo seleccionan. El periodo por defecto de
WoWAudit es de 30 días y la respuesta muestra from/to devueltos por la fuente.
No se interpreta como todo el histórico. Otros periodos o filtros reciben una
petición de precisión con el alcance actualmente soportado; no se ignoran.

Cada fila es una asignación registrada. Se agrupa por el nombre de personaje que
WoWAudit devuelve, contando todas las categorías, incluidos bonus, transfiguración
u «Excluded». No se deduplican objetos, no se agrupan alters por persona y no se
infiere mejora, valor, asistencia ni equidad del reparto. La respuesta lo explica.
Los empates se conservan; se muestran hasta diez nombres y el número restante.

El recuento ocurre antes del recorte de la vista genérica (12 registros / 6.000
caracteres) y del límite genérico de 12.000 caracteres. No usa el modelo para
seleccionar la herramienta, calcular o redactar el resultado. Se exige que total
coincida con la longitud de loot y que no haya señales de paginación/resultado
parcial. Si faltan filas, no se declara ganador. No se intenta paginar con campos
que el contrato no ofrece. Datos inválidos o errores MCP producen un aviso de
consulta no fiable, nunca un cero inventado.

El esquema de entrada debe exponer limit y permitir 200. Se admiten respuestas
estructuradas y JSON en bloques de texto MCP, como hace el cliente. Se comprueban
fechas, total y campos necesarios. Las notas y demás texto externo no se envían al
modelo ni se interpretan como instrucciones. Se mantienen respuestas privadas,
menciones desactivadas y los permisos habituales del adaptador Discord.

En las consultas generales, fallo del modelo/JSON al seleccionar herramienta y
fallo de la llamada a WoWAudit producen respuestas distintas sin detalles internos.
El error genérico de Discord sigue indicando fallos de transporte/API; no demuestra
por sí mismo que OAuth o el modelo estén averiados. /health no valida conexiones.

Evidencia: contrato de loot_history en la conexión WoWAudit y lectura del equipo
predeterminado comprobados el 2026-11-15 desde esta sesión. Esto no verifica OAuth,
servicios ni datos consultados por el agente de la VM. Las pruebas automatizadas
usan personajes y registros ficticios; no se guarda el historial real.
