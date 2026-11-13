# Despliegue de Kudlab

Arquitectura:

```
 Docente ──► kudlab-docente.pages.dev ──(/api/* proxy, misma cookie)──► API en Northflank ──► PostgreSQL (Northflank)
 Estudiante ─► kudlab-play.pages.dev ──(llamadas directas /api/v1/game-runtime)──┘
                    └─ /juegos/tg-02..04 (copias de los repos TD-*, descargadas al compilar)
```

Servicios (todos con plan gratuito):

| Servicio | Para qué | ¿Tarjeta? |
|---|---|---|
| GitHub | Este repositorio | No |
| Northflank | API (Docker) + PostgreSQL | Puede pedirla para verificar; plan Developer gratuito |
| Cloudflare Pages | Docente y Play | No |
| Gmail (contraseña de aplicación) | Invitaciones y recuperación de contraseña | No (requiere verificación en dos pasos) |
| Cloudflare R2 | Documentos de consentimiento (opcional) | Sí |

> Sin R2 la plataforma funciona, pero **no se pueden subir consentimientos** y por tanto no se pueden activar
> estudiantes ni asignarles actividades. Para la demostración se puede activar R2 después.

## 0. Antes de empezar

- Decide los nombres de los proyectos de Pages. La guía usa `kudlab-docente` y `kudlab-play`;
  si están ocupados, Cloudflare asigna otro nombre y debes usar ese en todo lo que sigue.
- Genera los secretos en tu computador (necesitas Node 18 o más reciente):

  ```bash
  node scripts/generar-secretos.mjs https://kudlab-docente.pages.dev https://kudlab-play.pages.dev
  ```

  Copia cada bloque al panel correspondiente. **No lo pegues en chats ni lo subas al repositorio.**

## 1. Base de datos y API en Northflank

1. Crea un proyecto `kudlab` (región más cercana disponible).
2. **Add new → Addon → PostgreSQL** (versión 16, plan gratuito). En *Connection details* copia la
   cadena `POSTGRES_URI` (empieza por `postgresql://`).
3. **Add new → Service → Combined service**:
   - Repositorio: el tuyo de GitHub, rama `main`.
   - Build: **Dockerfile**, *Build context* `/backend`, *Dockerfile location* `/backend/Dockerfile`.
   - Puerto: `3000`, HTTP, **Public**.
   - Recursos: el plan más pequeño basta.
4. *Environment variables* del servicio:
   - El bloque «Northflank» que imprimió `generar-secretos.mjs`.
   - `DATABASE_URL` = la `POSTGRES_URI` del paso 2. Si Northflank exige SSL, agrega `?sslmode=require` al final.
   - `MAIL_USER` = la cuenta Gmail; `MAIL_PASSWORD` = la contraseña de aplicación (16 letras, sin espacios);
     `MAIL_FROM` = la misma cuenta Gmail.
   - `ALLOWED_EMAIL_DOMAINS` (por ejemplo `.edu.co,gmail.com`): dominios aceptados para cuentas; sin ella solo se aceptan correos `.edu.co`.
     Pon el mismo valor en `VITE_ALLOWED_EMAIL_DOMAINS` del proyecto Pages docente.
   - `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` (de un dominio permitido) y
     `BOOTSTRAP_ADMIN_PASSWORD` (8+ caracteres con mayúscula, minúscula y número). Solo se usan la primera vez.
5. Despliega. Al arrancar, el contenedor ejecuta las migraciones y crea el administrador.
   Copia la URL pública del servicio (por ejemplo `https://p01--api--xxxx.code.run`): es el **origen de la API**.
6. Publica los juegos. En el servicio, **Shell** (o *Jobs → run command*):

   ```bash
   npm run game:publish-all
   npm run game:approve -- --task=TG-02 --reference=KUDLAB-TG02-APPROVAL-20261113-01
   npm run game:approve -- --task=TG-03 --reference=KUDLAB-TG03-APPROVAL-20261113-01
   npm run game:approve -- --task=TG-04 --reference=KUDLAB-TG04-APPROVAL-20261113-01
   npm run game:publish && npm run game:approve-tg01 -- --confirm=KUDLAB-TG01-APPROVAL-20261111-01
   ```

   Después, el administrador habilita cada actividad desde *Tareas* en la plataforma docente.

## 2. Plataforma docente en Cloudflare Pages

**Workers & Pages → Create → Pages → Connect to Git**, elige el repositorio:

- Project name: `kudlab-docente`
- Production branch: `main`
- Framework preset: *None*; Build command: `npm run build`; Build output: `dist`
- Root directory: `frontend`
- Variables (Production): el bloque «kudlab-docente» de `generar-secretos.mjs`, con
  `API_UPSTREAM_ORIGIN` = origen de la API del paso 1.5, y `NODE_VERSION` = `24`.

La carpeta `frontend/functions/` hace de proxy: el navegador solo habla con `kudlab-docente.pages.dev`,
así la cookie de sesión es de primera parte. El proxy reenvía la IP real del docente a la API firmada con
`PROXY_SHARED_SECRET` (el mismo valor en Pages y en Northflank).

## 3. Kudlab Play en Cloudflare Pages

Otro proyecto Pages con el mismo repositorio:

- Project name: `kudlab-play`; Root directory: `play`; Build command: `npm run build`; Output: `dist`
- Variables: `VITE_API_ORIGIN` = origen de la API, `VITE_TEACHER_ORIGIN` = `https://kudlab-docente.pages.dev`,
  `NODE_VERSION` = `24`.

El build descarga los tres juegos desde GitHub; en el log debe aparecer `tg-02`, `tg-03` y `tg-04` con su commit.

## 4. Verificación de punta a punta

1. `https://<api>/docs` abre la documentación de la API y `https://<api>/api/auth/get-session` responde 401.
2. Iniciar sesión en `kudlab-docente` con el administrador.
3. Invitar un docente (`.edu.co`): debe llegar el correo con el enlace a `/acceso/invitacion`.
4. Como docente: crear curso y estudiante; subir el consentimiento (requiere R2); asignar *Palabra intrusa*.
5. Generar el código, abrir `kudlab-play.pages.dev` en otro dispositivo, ingresar el código y jugar.
6. Volver al docente: la sesión aparece *Completada* y los indicadores se ven en *Indicadores → Actividad*.
7. Repetir con Mentalista, Kud Dice y Lluvia de estrellas.

## 5. Opcional: R2 para consentimientos

1. Cloudflare → R2 → activar (pide tarjeta, plan gratuito de 10 GB) → crear bucket `kudlab-consentimientos`.
2. *Manage R2 API tokens* → token con permiso *Object Read & Write* solo para ese bucket.
3. En Northflank agrega `CONSENT_STORAGE_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`),
   `CONSENT_STORAGE_BUCKET`, `CONSENT_STORAGE_ACCESS_KEY_ID` y `CONSENT_STORAGE_SECRET_ACCESS_KEY`, y reinicia.

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| El contenedor no arranca: «Configuración inválida: X» | Falta o está mal la variable X (orígenes sin barra final y en https) |
| Login responde «Operación no confirmada» | `API_UPSTREAM_ORIGIN` o `VITE_API_ORIGIN` mal escritos en Pages |
| Play dice que no puede conectar | `VITE_API_ORIGIN` de Play distinto de la API o `GAME_RUNTIME_ORIGIN` distinto de Play |
| No llegan correos | Contraseña de aplicación incorrecta o verificación en dos pasos desactivada |
| «Demasiados intentos fallidos» | Bloqueo de 15 minutos tras 5 intentos (DF-25001) |
| La actividad no aparece para asignar | No se ejecutó `game:publish-all` + `game:approve`, o no se habilitó en *Tareas* |
