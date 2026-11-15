# Recogida central de documentación

Cada componente mantiene docs/knowledge.json en su propio repositorio. Su pipeline
publica una copia verificada en la rama knowledge-published del MISMO repositorio,
en published/knowledge.json. Usa el GITHUB_TOKEN automático; no escribe en contexto.

Whitebird-context recoge las cinco publicaciones mediante peticiones GET con su
propia credencial de lectura, cada cinco minutos o al ejecutar Run workflow sobre
main. GitHub puede retrasar el horario programado. La descarga se fija al commit
observado de la rama para evitar mezclar revisiones. Se validan repositorio,
identificador, revisión, procedencia, tamaño y formato. No se ejecuta código remoto.

El catálogo agregado y sus registros se generan en build/, no se editan ni se
commitean. El contexto publica una release por SSH y cambia current atómicamente.
El agente lee el archivo local cada diez segundos, sin acceder a GitHub.

## Configuración que se conserva

En el agente:

```dotenv
WHITEBIRD_CONTEXT_PATH=/home/ubuntu/whitebird/context/current/bots.json
WHITEBIRD_CONTEXT_CACHE=/home/ubuntu/whitebird/shared/context-knowledge.json
```

La caché es opcional. No se necesita un token GitHub en el agente. No reiniciar
por cambios de documentación; solo si se modifican las variables del servicio.

En Whitebird-context, variables de repositorio (no secrets):

| Variable | Valor |
| --- | --- |
| CONTEXT_DEPLOY_ENABLED | true |
| OCI_CONTEXT_PATH | Ruta absoluta de la carpeta de contexto preparada en la VM |
| OCI_SSH_PORT | Puerto SSH, opcional, por defecto 22 |

En el environment oracle, conservar los secrets OCI_HOST, OCI_USER, OCI_SSH_KEY y
OCI_KNOWN_HOSTS. La carpeta debe contener .allow-context-deploy y ser escribible
por el usuario SSH. Node 22, tar y flock deben estar disponibles en SSH.

## Credencial de lectura, solo en Whitebird-context

Configurar CONTEXT_SOURCES_READ_TOKEN como secret de repositorio o del environment
oracle (que puede sustituir el valor del repositorio): token fino de GitHub,
Contents: read-only, con acceso a estos cinco repositorios:

- sacelean/whitebird-wow-role-sync
- sacelean/whitebird-recruitment-bot
- sacelean/whitebird-wow-wheel
- sacelean/whitebird-ai-agent
- sacelean/Whitebird-control-pane

No necesita permisos de escritura ni Actions. El GITHUB_TOKEN del contexto no
puede leer otros repositorios privados. Esa credencial no va a bots ni al agente.
Los bots ya no usan los antiguos tokens de escritura al contexto ni la variable
que activaba las notificaciones; pueden eliminarse después de incorporar el cambio.

## Mantenimiento y migración

1. Actualizar docs/knowledge.json y documentación técnica en el proyecto afectado.
   Cambiar reviewedAt y fuentes; mantener el orden de topics del enrutador.
2. Validar con node scripts/publish-knowledge.mjs --validate. Las pruebas del
   publicador se ejecutan con node --test scripts/check-knowledge.mjs.
3. Tras verificar el despliegue, la pipeline publica documento y SHA automáticamente
   en su propio repositorio. No copiar SHA ni resúmenes al contexto.
4. Ejecutar la pipeline de contexto o esperar a la recogida programada. Comprobar
   el paso de recogida y publicación, después preguntar al chatbot.

Incorporar primero los cambios de los proyectos de origen. Para disponer de la
primera publicación, ejecutar su despliegue habitual. Ruleta mantiene despliegue
manual: su workflow exige confirmar que la revisión está en ejecución y que la
documentación corresponde a ella; no verifica esa declaración automáticamente.
Después configurar el secret de lectura e incorporar el contexto recolector.
Sin publicaciones o sin credencial, el recolector falla con mensaje y conserva
el catálogo ya desplegado. Si solo falla una fuente, conserva su última ayuda y
marca collectionUnavailable. El agente actualizado muestra ese aviso. Antes de la
primera publicación de un componente, su ayuda puede figurar como no disponible.

La verificación acredita el último despliegue publicado, no el estado en vivo.
Tras un rollback, volver a publicar la documentación que corresponda a la revisión
restaurada. No conservar documentación de la versión nueva como si fuera actual.
Los datos reales, logs y configuración se comprueban con las herramientas del panel.

El flujo de recogida GitHub está implementado en main. Su evidencia de ejecución se registra en Whitebird-context/STATUS.md. La recogida desde carpetas locales de la VM no está implementada.

La corrección de redespliegues antiguos y los planes de revisión de contenido y temas dinámicos se describen en Whitebird-context/knowledge/IMPROVEMENT-PLAN.md. Las propuestas de contenido/temas no están implementadas en esta revisión.
