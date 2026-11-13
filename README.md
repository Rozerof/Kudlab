# Kudlab

Plataforma de apoyo pedagógico para la observación de la atención y la memoria de trabajo en niños de primaria.
Este repositorio reúne en un solo lugar las tres partes del sistema y lo conecta con los juegos.

| Carpeta | Qué es | Tecnología | Dónde se publica |
|---|---|---|---|
| `backend/` | API, base de datos, cálculo de indicadores | Node 24, Hono, Better Auth, Drizzle, PostgreSQL | Northflank (Docker) |
| `frontend/` | Plataforma docente (administración, cursos, estudiantes, asignaciones, indicadores) | React + Vite | Cloudflare Pages (`kudlab-docente`) |
| `play/` | Kudlab Play: donde el estudiante ingresa su código y juega | TypeScript + Vite | Cloudflare Pages (`kudlab-play`) |

La historia de cada repositorio original (Kudlab-Backend, Kudlab-frontend, Kudlab-play) se conservó con `git subtree`.

## Juegos

| Código | Juego | Repositorio | Contrato |
|---|---|---|---|
| TG-01 | Lluvia de estrellas | integrado en `play/` | 1.1 |
| TG-02 | Palabra intrusa | [AlexanderNino97/TD-PALABRA-INTRUSA](https://github.com/AlexanderNino97/TD-PALABRA-INTRUSA) | ext-1 |
| TG-03 | Mentalista | [AlexanderNino97/TD-MENTALISTA](https://github.com/AlexanderNino97/TD-MENTALISTA) | ext-1 |
| TG-04 | Kud Dice | [AlexanderNino97/TD-KUD-DICE](https://github.com/AlexanderNino97/TD-KUD-DICE) | ext-1 |

Los juegos TG-02 a TG-04 **no se copian** a este repositorio: al compilar Play, `play/scripts/fetch-games.mjs`
descarga la rama indicada en `play/games.json` y copia su carpeta `frontend/` a `play/public/juegos/<tg-0X>/`.
Un cambio en el repositorio de un juego llega a producción al volver a desplegar Play.

### Contrato ext-1 (cómo se conectan)

1. El docente asigna la actividad y entrega un código al estudiante.
2. Play canjea el código (`/game-runtime/access/claim`), inicia la sesión y abre el juego en un iframe del mismo origen.
3. El juego termina y envía `GAME_OVER` por `postMessage` con sus eventos crudos.
4. Play arma el sobre `ext-1`, lo guarda localmente y lo envía (`/sessions/{id}/results`) con reintentos.
5. La API guarda los eventos en `external_game_results` y **recalcula los indicadores en el servidor**
   (`backend/src/modules/evolucion/external.ts`); nunca confía en el resumen del cliente.

## Desarrollo local

```bash
cd backend && npm ci && cp .env.example .env   # completar .env
npm run db:migrate && npm run game:prepare-local && npm run dev
cd ../frontend && npm ci && npm run dev
cd ../play && npm ci && npm run dev
```

Pruebas de la API: requieren PostgreSQL y una base desechable cuyo nombre termine en `_test`:

```bash
cd backend
DATABASE_URL=postgres://postgres:clave@127.0.0.1:5432/kudlab_local_test npm run db:migrate
DATABASE_URL=postgres://postgres:clave@127.0.0.1:5432/kudlab_local_test npm test
```

La integración continua (`.github/workflows/ci.yml`) ejecuta lo mismo en cada push.

## Despliegue

Guía paso a paso: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).
