# Contexto publicado por su propia pipeline

Whitebird-context tiene una pipeline independiente: valida los cambios y publica
el catálogo del chatbot por SSH. El agente solo lee un archivo local al arrancar
y cada diez segundos. No necesita GitHub, git pull ni token de lectura.
Panel y Discord comparten el mismo agente y reciben la misma ayuda.

## Flujo

1. Modificar el bot y su documentación técnica.
2. Publicar en Whitebird-context/knowledge/bots.json su explicación y
   implementedRevision con el SHA completo de 40 caracteres del bot. Actualizar
   STATUS.md, fecha y fuentes. Mantener el orden de topics del enrutador.
3. La pipeline del bot despliega y comprueba su conexión. Solo después registra
   deployments/<componente>.json en Whitebird-context con revisión, fecha y enlace
   al run. Ese commit vuelve a disparar la pipeline del contexto.
4. La pipeline del contexto activa la explicación solo si implementedRevision
   coincide exactamente con la revisión del registro de despliegue. Si hay
   documentación pendiente conserva la explicación previa si corresponde al bot
   desplegado; si no hay explicación compatible muestra ayuda no verificada.
5. Publica una release nueva y cambia el enlace current de forma atómica.
   El agente la recoge en hasta diez segundos sin reiniciarse.

Un cambio de código no escribe automáticamente su explicación. Hay que actualizar
el catálogo como parte del cambio. Los registros acreditan las comprobaciones de
la pipeline, no una auditoría continua de producción. Un rollback debe registrar
la revisión restaurada; las explicaciones antiguas se recuperan del historial Git
si ya no están en el catálogo actual. No modificar deployedRevision para saltarse
la comprobación: el publicador lo calcula a partir del registro de despliegue.

## Configurar el agente una vez

En su entorno privado:

```dotenv
WHITEBIRD_CONTEXT_PATH=/home/ubuntu/whitebird/context/current/bots.json
WHITEBIRD_CONTEXT_CACHE=/home/ubuntu/whitebird/shared/context-knowledge.json
```

La primera ruta debe coincidir con OCI_CONTEXT_PATH/current/bots.json en la
pipeline del contexto. La segunda es opcional y debe ser escribible por el
usuario del agente. Puede eliminarse WHITEBIRD_CONTEXT_TOKEN; ya no se usa.
Reiniciar el agente una vez tras configurar estas rutas y desplegar este código.
Después, los cambios de catálogo no requieren reinicios.

## Configurar Whitebird-context

En GitHub, secrets del environment oracle: OCI_HOST, OCI_USER, OCI_SSH_KEY,
OCI_KNOWN_HOSTS. La clave del host debe verificarse; no se acepta automáticamente.
Variables del repositorio: OCI_CONTEXT_PATH (ruta absoluta, sin espacios),
OCI_SSH_PORT (opcional, 22) y CONTEXT_DEPLOY_ENABLED=true para activar publicación.

En el servidor Linux con Node 22, tar y flock, preparar una carpeta dedicada,
propiedad del usuario SSH, por ejemplo /home/ubuntu/whitebird/context. Crear allí
el archivo vacío .allow-context-deploy. El usuario del agente necesita lectura y
acceso a esa carpeta. No hace falta clonar repositorios ni guardar tokens allí.
La publicación conserva releases previas y usa bloqueo; rechaza runs anteriores
que terminen después de uno más reciente. No reinicia ni despliega bots.

## Configurar las notificaciones de bots

Sync y Recruitment añaden un paso después de la comprobación de conexión a Discord.
Activarlo con la variable CONTEXT_REPORT_ENABLED=true y el secret
WHITEBIRD_CONTEXT_WRITE_TOKEN: token fino de GitHub con Contents: read/write solo
sobre Whitebird-context. El token permanece en CI, nunca en el agente.
El GITHUB_TOKEN de un bot no permite escribir en otro repositorio privado.
El commit se hace con ese token para que dispare la pipeline del contexto.
Un error de notificación se distingue en su paso: no deshace el bot ya desplegado.

Ruleta no tenía pipeline de despliegue. Se incluye un workflow manual para
registrar una revisión después de comprobar personalmente el despliegue; exige
SHA completo y confirmación. Ese workflow no instala ni comprueba el bot.
El agente también incorpora el paso de notificación al final de su despliegue.
El panel conserva su despliegue existente; hasta registrar su versión y documentar
el SHA correspondiente su ayuda publicada aparece como pendiente de verificación.

## Fallos y comprobaciones

El publicador valida el catálogo entero antes de cambiar current. Si falla,
conserva la release anterior. El agente rechaza archivos inválidos o mayores de
256 KiB y conserva el último válido en memoria y, opcionalmente, en caché.
Si falta el archivo publicado usa su ayuda incluida con aviso de respaldo;
ese respaldo no acredita el comportamiento desplegado.

Validar cambios: `npm run context:validate -- /ruta/knowledge/bots.json` desde el
agente, o `node scripts/catalog.mjs validate knowledge/bots.json` en contexto.
La pipeline del contexto ejecuta también pruebas de publicación y versiones.
No se han configurado secretos, activado pipelines ni desplegado servicios en
esta implementación. Los cambios remotos se preparan en ramas para revisión.
