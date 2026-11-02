# Termux Bridge

Puente experimental entre una cola de tareas en Cloudflare Workers y un agente local en Termux.

## Estado

- API Cloudflare con autenticación Bearer.
- Cola persistente mediante Durable Objects (SQLite).
- Operaciones permitidas inicialmente: `pwd`, `python-version`, `list-workspace`.
- Despliegue automático desde GitHub Actions.
- **Todavía no ejecuta comandos arbitrarios ni conecta ChatGPT directamente con el teléfono.**

## GitHub Actions

Configura estos secretos en **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Al subir cambios a `main`, el workflow despliega el Worker.

## Secreto del Worker

Después del primer despliegue, crea un secreto llamado `BRIDGE_TOKEN` en la configuración del Worker de Cloudflare. Usa un valor aleatorio largo y privado. El mismo token se configurará después en el agente local.

## API

- `GET /health` — estado público del Worker.
- `POST /v1/tasks` — crea una tarea permitida. JSON: `{"operation":"pwd"}`.
- `GET /v1/next` — reclama la siguiente tarea pendiente.
- `POST /v1/tasks/:id/result` — registra el resultado de una tarea.

Todas las rutas excepto `/health` requieren `Authorization: Bearer <BRIDGE_TOKEN>`.

## Seguridad

El servidor local de Termux debe seguir enlazado a `127.0.0.1`. El agente local solo ejecutará operaciones de una lista permitida y nunca debe aceptar comandos de shell arbitrarios desde la nube.
