// Datos de DEMOSTRACIÓN para presentar Kudlab: estudiantes ficticios (seudónimos), consentimiento de prueba
// y partidas simuladas de TG-02, TG-03 y TG-04. Usa la API real (HTTP local), así que pasa por las mismas
// validaciones, el mismo almacenamiento de consentimientos y el mismo cálculo de indicadores.
// Uso (dentro del contenedor de la API):
//   npm run demo:seed -- --email=docente@correo --password=Clave --group="Tercero A" [--count=22]
// Los estudiantes se crean con código DEMO-01.. y seudónimos; nunca usar con datos reales.
import { randomBytes, randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskPublishedVersions } from '../db/schema/tasks.js';
import { loadEnv } from '../config/env.js';

const env = loadEnv();
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const email = arg('email'), password = arg('password'), groupName = arg('group') ?? 'Tercero A', count = Math.min(40, Number(arg('count') ?? 22));
if (!email || !password) { console.error('Uso: npm run demo:seed -- --email=... --password=... --group="Tercero A"'); process.exit(1); }
const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
const spa = env.SPA_ORIGIN, runtimeOrigin = env.GAME_RUNTIME_ORIGIN!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let auth: Record<string, string> = {};

async function call(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}, runtime = false): Promise<{ status: number; body: any }> {
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { origin: runtime ? runtimeOrigin : spa, ...(runtime ? {} : auth), ...extra };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + path, { method, headers, body: payload });
    if (r.status === 429 && attempt < 30) { const wait = Number(r.headers.get('retry-after') ?? 3); process.stdout.write(`  (límite de peticiones, esperando ${wait}s)\n`); await sleep(wait * 1000 + 200); continue; }
    return { status: r.status, body: await r.json().catch(() => null) };
  }
}
const must = async (label: string, p: Promise<{ status: number; body: any }>, ok = [200, 201]) => { const r = await p; if (!ok.includes(r.status)) throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

const names = ['Estrella', 'Cometa', 'Luna', 'Sol', 'Nube', 'Trueno', 'Brisa', 'Rayo', 'Aurora', 'Galaxia', 'Planeta', 'Arcoíris', 'Volcán', 'Océano', 'Bosque', 'Montaña', 'Río', 'Lucero', 'Nova', 'Eclipse', 'Polar', 'Ámbar', 'Coral', 'Jade', 'Topacio', 'Zafiro', 'Rubí', 'Perla', 'Cristal', 'Ónix', 'Nácar', 'Ópalo', 'Cuarzo', 'Granate', 'Esmeralda', 'Turquesa', 'Marfil', 'Índigo', 'Cobalto', 'Lima'];
// PDF mínimo válido, marcado como prueba.
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 72 700 Td (CONSENTIMIENTO DE PRUEBA - SIN VALIDEZ) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function choiceEvents(n: number, skill: number, r: () => number) {
  return Array.from({ length: n }, (_, i) => { const x = r(); const result = x < skill ? 'correct' : x < skill + (1 - skill) * .8 ? 'incorrect' : 'omission';
    return { trial: i + 1, valid: true, result, anticipatory: false, rtMs: result === 'omission' ? null : Math.round(1400 + r() * 1800 - skill * 600), level: 1 + Math.floor(i / (n / 3)), load: 2 + Math.floor(i / (n / 3)), segment: 1 + Math.floor(i / (n / 3)) }; });
}
function sequenceEvents(skill: number, r: () => number) {
  return Array.from({ length: 10 }, (_, i) => { const length = 2 + Math.floor(i / 2); const ok = r() < skill - i * .04; const positionsCorrect = ok ? length : Math.max(0, Math.floor(length * (.4 + r() * .4)));
    return { valid: true, outcome: ok ? 'correct' : 'incorrect', length, positionsCorrect, orderErrors: ok ? 0 : Math.min(length - positionsCorrect, 1 + Math.floor(r() * 2)), firstTapLatencyMs: Math.round(600 + r() * 900) }; });
}

async function play(assignmentId: string, recipientId: string, taskId: string, events: unknown[]) {
  const batch = await must('código', call(`/api/v1/task-assignments/${assignmentId}/access-codes`, 'POST', { requestId: randomUUID(), recipientIds: [recipientId] }));
  const codeId = batch.items[0].id;
  const code = (await must('revelar', call(`/api/v1/task-access-codes/${codeId}/reveal`, 'POST', {}))).code;
  const secret = randomBytes(32).toString('base64url');
  const ctx = await must('canje', call('/api/v1/game-runtime/access/claim', 'POST', { code, claimId: randomUUID(), runtimeSecret: secret }, {}, true));
  const bearer = { authorization: `Bearer ${secret}` };
  await must('inicio', call(`/api/v1/game-runtime/sessions/${ctx.sessionId}/start`, 'POST', { startId: randomUUID() }, bearer, true));
  const envelope = { contractVersion: 'ext-1', sessionId: ctx.sessionId, submissionId: randomUUID(), taskId, publishedVersionId: ctx.publishedVersionId,
    configVersion: ctx.configVersion, configurationHash: ctx.configurationHash, gameBuildId: ctx.gameBuildId, state: 'completed', terminationReason: 'time_limit',
    clock: { id: randomUUID(), timeOriginUnixMs: Date.now() }, timing: { startedAtMs: 10, finishedAtMs: 150000, lastCheckpointAtMs: 150000 },
    device: { viewportWidth: 1280, viewportHeight: 800, stageScale: 1, touchCapable: true }, payload: { taskId, state: 'completed', events } };
  await must('resultados', call(`/api/v1/game-runtime/sessions/${ctx.sessionId}/results`, 'POST', envelope, bearer, true));
}

const signIn = await fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers: { origin: spa, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const token = signIn.headers.get('set-auth-token');
if (!signIn.ok || !token) { console.error('No se pudo iniciar sesión como docente:', signIn.status, await signIn.text()); process.exit(1); }
auth = { authorization: `Bearer ${token}` };
const groups = await must('cursos', call('/api/v1/groups'));
const group = (groups.items ?? groups).find((g: { name: string }) => g.name.trim().toLowerCase() === groupName.trim().toLowerCase());
if (!group) { console.error(`No encontré el curso «${groupName}». Cursos: ${(groups.items ?? groups).map((g: { name: string }) => g.name).join(', ')}`); process.exit(1); }
console.log(`Curso: ${group.name}`);

const created: { id: string; name: string; skill: number }[] = [];
for (let i = 0; i < count; i++) {
  const code = `DEMO-${String(i + 1).padStart(2, '0')}`, name = names[i % names.length]!;
  const r = await call('/api/v1/students', 'POST', { groupId: group.id, studentCode: code, firstName: name, lastName: `Demo ${i + 1}` });
  if (r.status !== 201) { console.log(`  ${code}: ya existe o no se pudo crear (${r.status}), se omite`); continue; }
  const form = new FormData();
  form.append('file', new File([pdf], `consentimiento-prueba-${code}.pdf`, { type: 'application/pdf' }));
  form.append('metadata', JSON.stringify({ requestId: randomUUID(), expectedVersion: 0, signedOn: today, receivedOn: today }));
  await must(`consentimiento ${code}`, call(`/api/v1/students/${r.body.id}/consents`, 'POST', form));
  created.push({ id: r.body.id, name, skill: .55 + rng(i + 7)() * .4 });
  console.log(`  ${code} ${name}: creado y con consentimiento`);
}
if (!created.length) { console.log('No se crearon estudiantes nuevos.'); process.exit(0); }

const plan: [string, number][] = [['TG-02', 2], ['TG-03', 1], ['TG-04', 1]];
for (const [taskId, sessions] of plan) {
  const [version] = await db.select().from(taskPublishedVersions).where(eq(taskPublishedVersions.taskId, taskId)).orderBy(desc(taskPublishedVersions.version)).limit(1);
  if (!version) { console.log(`${taskId}: no está publicado, se omite`); continue; }
  const a = await call('/api/v1/task-assignments', 'POST', { requestId: randomUUID(), taskId, publishedVersionId: version.id, groupId: group.id, studentIds: created.map(s => s.id),
    startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 7 * 86400000).toISOString(), maxAttempts: 3 });
  if (a.status !== 201) { console.log(`${taskId}: no se pudo asignar (${a.status} ${JSON.stringify(a.body)}). ¿Está habilitado en Tareas digitales?`); continue; }
  let done = 0;
  for (const rcp of a.body.recipients as { id: string; studentId: string }[]) {
    const s = created.find(c => c.id === rcp.studentId)!; const r = rng(s.skill * 1e6 + taskId.charCodeAt(3));
    for (let k = 0; k < sessions; k++) {
      const skill = Math.min(.97, s.skill + k * .08);
      const events = taskId === 'TG-04' ? sequenceEvents(skill, r) : choiceEvents(taskId === 'TG-02' ? 18 : 12, skill, r);
      try { await play(a.body.id, rcp.id, taskId, events); done++; } catch (e) { console.log(`  ${taskId} ${s.name}: ${(e as Error).message}`); }
    }
  }
  console.log(`${taskId}: ${done} partidas registradas`);
}
console.log('Listo. Los indicadores se calculan en segundo plano en menos de un minuto.');
process.exit(0);
