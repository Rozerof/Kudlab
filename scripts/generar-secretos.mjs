// Genera los secretos de producción de Kudlab. Uso:
//   node scripts/generar-secretos.mjs https://kudlab-docente.pages.dev https://kudlab-play.pages.dev
// Imprime los valores para pegarlos en Northflank (API) y en Cloudflare Pages (docente).
// No guarda nada en disco: copia la salida directamente a cada panel y no la subas al repositorio.
import { randomBytes } from 'node:crypto';

const [teacher, play] = process.argv.slice(2);
if (!teacher || !play) {
  console.error('Uso: node scripts/generar-secretos.mjs <origen-docente> <origen-play>');
  process.exit(1);
}
for (const value of [teacher, play]) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value) throw new Error(`Origen inválido (sin barra final, solo https): ${value}`);
}
const hex = () => randomBytes(32).toString('hex');
const proxy = randomBytes(32).toString('base64url');
const api = {
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
  BETTER_AUTH_URL: teacher,
  SPA_ORIGIN: teacher,
  INVITATION_BASE_URL: `${teacher}/acceso/invitacion`,
  // El frontend aún no tiene pantalla de cambio de correo: el enlace se fija para que la API arranque.
  EMAIL_CHANGE_BASE_URL: `${teacher}/acceso/cambio-correo`,
  RESET_BASE_URL: `${teacher}/recuperar-acceso/confirmar`,
  GAME_RUNTIME_ORIGIN: play,
  GAME_GRANT_KEYS: JSON.stringify({ k1: hex() }),
  GAME_ACTIVE_KEY_ID: 'k1',
  GAME_CURSOR_KEY: hex(),
  GAME_ACCESS_ENABLED: 'true',
  GAME_ACCESS_KEYS: JSON.stringify({ a1: hex() }),
  GAME_ACCESS_ACTIVE_KEY_ID: 'a1',
  GAME_ACCESS_LOOKUP_KEY: hex(),
  GAME_ACCESS_IP_KEY: hex(),
  PROXY_SHARED_SECRET: proxy,
  MAIL_MODE: 'smtp',
  MAIL_HOST: 'smtp.gmail.com',
  MAIL_PORT: '465',
};
console.log('# ---- Northflank: variables del servicio API (además de DATABASE_URL, MAIL_USER, MAIL_PASSWORD, MAIL_FROM y BOOTSTRAP_ADMIN_*) ----');
for (const [k, v] of Object.entries(api)) console.log(`${k}=${v}`);
console.log('\n# ---- Cloudflare Pages: proyecto kudlab-docente (Settings > Variables, Production) ----');
console.log(`VITE_API_ORIGIN=${teacher}`);
console.log(`VITE_PLAY_ORIGIN=${play}`);
console.log('API_UPSTREAM_ORIGIN=<URL pública de la API en Northflank, sin barra final>');
console.log(`PROXY_SHARED_SECRET=${proxy}`);
console.log('\n# ---- Cloudflare Pages: proyecto kudlab-play ----');
console.log('VITE_API_ORIGIN=<URL pública de la API en Northflank, sin barra final>');
console.log(`VITE_TEACHER_ORIGIN=${teacher}`);
