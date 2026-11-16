// SOLO LOCAL (modo sintético): siembra una docente, un curso y estudiantes ficticios que juegan por modo aula,
// para revisar la interfaz. No se usa en producción ni se ejecuta en el despliegue.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tasks } from '../db/schema/tasks.js';
import { publishTg01, publishExternal } from '../modules/tareas/catalog/publish.js';
import { loadEnv } from '../config/env.js';
const env = loadEnv();
if (!env.KUDLAB_LOCAL_SYNTHETIC_ENABLED) throw new Error('Solo en modo local sintético');
const base = 'http://127.0.0.1:3000', mailFile = process.argv[2]!;
let cookie = '';
async function call(path: string, method = 'GET', body?: unknown, runtime = false) {
  const r = await fetch(base + path, { method, headers: { origin: runtime ? env.GAME_RUNTIME_ORIGIN! : env.SPA_ORIGIN, ...(runtime ? {} : { cookie }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j as any;
}
async function login(email: string, password: string) {
  const r = await fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers: { origin: env.SPA_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error('login ' + r.status); cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
for (const t of ['TG-01', 'TG-02', 'TG-03', 'TG-04'] as const) { try { t === 'TG-01' ? await publishTg01() : await publishExternal(t); } catch (e) { console.log('publicado antes', t); } }
await db.update(tasks).set({ isEnabled: true });
await login('admin@pilot.edu.co', 'AdminDemo123');
const teacher = await call('/api/v1/accounts', 'POST', { name: 'Mónica Rojas', email: 'docente@pilot.edu.co', role: 'TEACHER' }).catch(() => null);
if (teacher) {
  const token = [...readFileSync(mailFile, 'utf8').replace(/=\r?\n/g, '').replace(/=3D/g, '=').matchAll(/token=([A-Za-z0-9_-]+)/g)].at(-1)![1];
  await call('/api/v1/account-invitations/accept', 'POST', { token, password: 'Docente123' });
}
const listed = await call('/api/v1/groups/teachers'), pool = Array.isArray(listed) ? listed : listed.items;
const tId = teacher?.id ?? pool[0].id;
const group = await call('/api/v1/groups', 'POST', { teacherId: tId, name: 'Tercero A', grade: '3', schoolYear: 2026 });
await call('/api/v1/groups', 'POST', { teacherId: tId, name: 'Tercero B', grade: '3', schoolYear: 2026 });
await login('docente@pilot.edu.co', 'Docente123');
const names = [['Estrella', 'E. M.', 'ESTRELLA', 2], ['Cometa', 'C. R.', 'COMETA', 4], ['Luna', 'L. P.', 'LUNITA', 3], ['Sol', 'S. G.', 'SOLECITO', 7], ['Nube', 'N. T.', 'NUBE', 5], ['Trueno', 'T. A.', 'TRUENO', 4], ['Brisa', 'B. C.', 'BRISA', 0], ['Rayo', 'R. V.', 'RAYO', 1], ['Aurora', 'A. D.', 'AURORA', 6], ['Galaxia', 'G. H.', 'GALAXIA', 2]] as const;
const studs: { id: string; alias: string; figure: number }[] = [];
for (const [i, [first, last, alias, figure]] of names.entries()) {
  const s = await call('/api/v1/students', 'POST', { groupId: group.id, studentCode: `DEMO-${String(i + 1).padStart(2, '0')}`, firstName: first, lastName: last });
  if (i < 9) await call(`/api/v1/students/${s.id}/play-profile`, 'PUT', { alias, figure });
  studs.push({ id: s.id, alias, figure });
}
await call(`/api/v1/groups/${group.id}/aula/open`, 'POST', { minutes: 240 });
for (const t of ['TG-02', 'TG-03', 'TG-04']) await call(`/api/v1/groups/${group.id}/aula/activations`, 'POST', { taskId: t, audience: 'GROUP', studentIds: [] });
await call(`/api/v1/groups/${group.id}/aula/activations`, 'POST', { taskId: 'TG-01', audience: 'STUDENTS', studentIds: studs.slice(0, 3).map(s => s.id) });
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const choice = (n: number, skill: number, r: () => number) => Array.from({ length: n }, (_, i) => { const x = r(); const result = x < skill ? 'correct' : x < skill + (1 - skill) * .8 ? 'incorrect' : 'omission';
  return { trial: i + 1, valid: true, result, anticipatory: false, rtMs: result === 'omission' ? null : Math.round(1400 + r() * 1500 - skill * 500), level: 1 + Math.floor(i / (n / 3)), load: 2 + (i % 3), segment: 1 + Math.floor(i / (n / 3)) }; });
const seq = (skill: number, r: () => number) => Array.from({ length: 10 }, (_, i) => { const length = 2 + Math.floor(i / 2); const ok = r() < skill - i * .04; const pc = ok ? length : Math.max(0, Math.floor(length * (.4 + r() * .4)));
  return { valid: true, outcome: ok ? 'correct' : 'incorrect', length, positionsCorrect: pc, orderErrors: ok ? 0 : Math.min(length - pc, 1 + Math.floor(r() * 2)), firstTapLatencyMs: Math.round(700 + r() * 900) }; });
async function play(s: { id: string; alias: string; figure: number }, taskId: string, events: unknown[]) {
  const who = await call('/api/v1/game-runtime/access/aula/identify', 'POST', { groupId: group.id, alias: s.alias, figure: s.figure }, true);
  const secret = randomBytes(32).toString('base64url');
  const ctx = await call('/api/v1/game-runtime/access/aula/claim', 'POST', { ticket: who.ticket, taskId, claimId: randomUUID(), runtimeSecret: secret }, true);
  const h = { origin: env.GAME_RUNTIME_ORIGIN!, 'content-type': 'application/json', authorization: `Bearer ${secret}` };
  let r = await fetch(`${base}/api/v1/game-runtime/sessions/${ctx.sessionId}/start`, { method: 'POST', headers: h, body: JSON.stringify({ startId: randomUUID() }) }); if (!r.ok) throw new Error('start ' + r.status);
  const envelope = { contractVersion: 'ext-1', sessionId: ctx.sessionId, submissionId: randomUUID(), taskId, publishedVersionId: ctx.publishedVersionId, configVersion: ctx.configVersion, configurationHash: ctx.configurationHash, gameBuildId: ctx.gameBuildId,
    state: 'completed', terminationReason: 'time_limit', clock: { id: randomUUID(), timeOriginUnixMs: Date.now() }, timing: { startedAtMs: 10, finishedAtMs: 150000, lastCheckpointAtMs: 150000 },
    device: { viewportWidth: 1280, viewportHeight: 800, stageScale: 1, touchCapable: true }, payload: { taskId, state: 'completed', events } };
  r = await fetch(`${base}/api/v1/game-runtime/sessions/${ctx.sessionId}/results`, { method: 'POST', headers: h, body: JSON.stringify(envelope) }); if (!r.ok) throw new Error('results ' + r.status + await r.text());
}
// Tres partidas por juego; algunos niños bajan en la última (para que la estrella tenga algo que mostrar).
for (const [i, s] of studs.slice(0, 9).entries()) {
  const r = rng(i * 97 + 3), base0 = .55 + (i % 4) * .1;
  for (const round of [0, 1, 2]) {
    const drop = round === 2 ? (i % 3 === 0 ? .35 : i % 3 === 1 ? .12 : -.03) : 0;
    await play(s, 'TG-02', choice(18, Math.max(.1, base0 - drop), r));
    await play(s, 'TG-03', choice(12, Math.max(.1, base0 - .05 - drop / 2), r));
    await play(s, 'TG-04', seq(Math.min(.98, base0 + .2 - drop), r));
  }
  process.stdout.write('.');
}
const all = (f: (k: number) => number | null) => Object.fromEntries(Array.from({ length: 13 }, (_, k) => [`OD-${String(k + 1).padStart(2, '0')}`, f(k)]));
for (const [i, s] of studs.slice(0, 6).entries()) {
  await call(`/api/v1/students/${s.id}/observation-panels`, 'POST', { requestId: randomUUID(), period: '2026-P3', observedOn: '2026-08-20', area: 'AMBAS', responses: all(k => (k + i) % 5 === 0 ? null : 3 + ((k + i) % 3)), notes: { A: 'Trabaja bien en grupos pequeños.' } });
  await call(`/api/v1/students/${s.id}/observation-panels`, 'POST', { requestId: randomUUID(), period: '2026-P4', observedOn: '2026-11-10', area: 'AMBAS', responses: all(k => k === 7 ? null : Math.max(0, 3 + ((k + i) % 3) - (i % 2 ? 2 : 0))), notes: {} });
}
console.log('\nlisto', group.id, studs[0]!.id);
process.exit(0);
