#!/usr/bin/env node
// Prueba de carga del modo aula: simula a todo un curso entrando a la vez (elegir curso → apodo + figura → ver juegos).
// Solo LEE: no inicia partidas ni gasta intentos. Requiere la clase ABIERTA y apodos asignados.
//
// Uso (desde la carpeta del proyecto, con Node 20 o superior):
//   node scripts/prueba-carga-aula.mjs --api=https://TU-API --play=https://TU-PLAY --curso=ID_DEL_CURSO \
//        --alumnos="TIGRE:4,SOFI:1,LUNITA:3" [--rondas=2]
// Figuras: 0 gato, 1 perro, 2 estrella, 3 luna, 4 cohete, 5 arcoíris, 6 manzana, 7 balón.
// Cada apodo admite 10 entradas cada 15 minutos: no uses más de 3 rondas seguidas.
const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const api = arg('api'), play = arg('play'), group = arg('curso'), rounds = Math.min(3, Number(arg('rondas') ?? 2));
const kids = (arg('alumnos') ?? '').split(',').map(x => x.trim()).filter(Boolean).map(x => { const [alias, figure] = x.split(':'); return { alias, figure: Number(figure) }; });
if (!api || !play || !group || !kids.length || kids.some(k => !(k.figure >= 0 && k.figure <= 7))) {
  console.error('Faltan datos. Ejemplo:\n  node scripts/prueba-carga-aula.mjs --api=https://... --play=https://... --curso=UUID --alumnos="TIGRE:4,SOFI:1"');
  process.exit(1);
}
const base = `${api.replace(/\/$/, '')}/api/v1/game-runtime/access/aula`;
async function call(path, body) {
  const t = performance.now();
  try {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { origin: play, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, ms: performance.now() - t, data };
  } catch (e) { return { ok: false, status: 0, ms: performance.now() - t, data: String(e) }; }
}
const results = [];
async function child(k) {
  const g = await call('/groups'); results.push({ step: 'cursos', ...g });
  const who = await call('/identify', { groupId: group, alias: k.alias, figure: k.figure }); results.push({ step: 'apodo', ...who });
  if (!who.ok) return console.log(`  ✗ ${k.alias}: ${who.status} ${JSON.stringify(who.data)}`);
  const games = await call('/games', { ticket: who.data.ticket }); results.push({ step: 'juegos', ...games });
}
const pct = (a, p) => a.length ? Math.round(a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]) : 0;
for (let r = 1; r <= rounds; r++) {
  const t = performance.now();
  await Promise.all(kids.map(child));
  console.log(`Ronda ${r}: ${kids.length} estudiantes en ${Math.round(performance.now() - t)} ms`);
}
for (const step of ['cursos', 'apodo', 'juegos']) {
  const rows = results.filter(x => x.step === step), ms = rows.map(x => x.ms), bad = rows.filter(x => !x.ok);
  console.log(`${step.padEnd(7)} ${rows.length} peticiones · mediana ${pct(ms, .5)} ms · p95 ${pct(ms, .95)} ms · errores ${bad.length}${bad.length ? ` (${[...new Set(bad.map(b => b.status))].join(', ')})` : ''}`);
}
const errors = results.filter(x => !x.ok).length;
console.log(errors ? `\nHubo ${errors} errores: 429 = demasiados intentos; 403 = clase cerrada o apodo/figura incorrectos; 0/5xx = el servidor no respondió.` : '\nTodo respondió bien.');
