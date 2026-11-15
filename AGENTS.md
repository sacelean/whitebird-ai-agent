# Contexto de Whitebird

Antes de trabajar en este proyecto, consultar el contexto compartido en:
https://github.com/sacelean/Whitebird-context

Leer README.md, AGENTS.md, ARCHITECTURE.md, STATUS.md y DEPLOYMENT.md desde una copia local actualizada o mediante la conexión GitHub autorizada.
El repositorio de contexto es privado. Si no hay acceso, indicarlo y continuar con las tareas que puedan resolverse con las fuentes disponibles, sin inventar información.

## Al realizar cambios

- Leer también la documentación e instrucciones específicas de este proyecto.
- Verificar código y estado actual antes de dar por vigente una nota histórica.
- Distinguir lo propuesto, implementado, probado y desplegado.
- Revisar consumidores e integraciones si cambian comandos, variables, contratos o datos compartidos.
- Actualizar el contexto compartido cuando la tarea autorizada cambie arquitectura, operación o estado relevante; registrar fecha y evidencia.
- No desplegar ni modificar otros proyectos solo por estar mencionados en la documentación.
- No guardar secretos, archivos .env, tokens, bases de datos ni datos personales en el contexto.

## Conocimiento compartido del chatbot

Al cambiar comportamiento, comandos, configuración o integraciones, actualizar
Whitebird-context/STATUS.md y knowledge/bots.json. Consultar knowledge/README.md
en ese repositorio. Registrar fuentes, fecha y revisión implementada; acreditar
la revisión desplegada por separado mediante deployments/<componente>.json tras verificarla.
El agente lee el catálogo local publicado por la pipeline de Whitebird-context;
no requiere token GitHub ni git pull.
Validar el catálogo con npm run context:validate -- /ruta/bots.json.
La ayuda incluida en src/project-knowledge.js es un respaldo; mantenerla compatible
con el esquema y actualizar el enrutador al añadir proyectos o temas.
