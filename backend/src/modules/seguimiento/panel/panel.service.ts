// Panel de observación docente (escala 0–5, 13 preguntas OD-01..OD-13 en bloques A–E) y estrella de prioridad de revisión.
// No diagnóstico: el resumen es por bloque (nunca global) y la prioridad compara al estudiante consigo mismo, nunca con compañeros.
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { students, groups } from '../../../db/schema/academic.js';
import { tasks } from '../../../db/schema/tasks.js';
import { observationPanels } from '../../../db/schema/aula.js';
import { gameSessions, calculationRuns, calculatedIndicators } from '../../../db/schema/game.js';
import { withAcademicAccess, type AcademicActor, type AcademicTransaction as Tx } from '../../academico/shared/academic-auth.js';
import { AcademicError, notFound } from '../../academico/shared/academic.errors.js';

export const BLOCKS = { A: ['OD-01', 'OD-02', 'OD-03'], B: ['OD-04', 'OD-05', 'OD-06'], C: ['OD-07', 'OD-08', 'OD-09'], D: ['OD-10', 'OD-11', 'OD-12'], E: ['OD-13'] } as const;
type Block = keyof typeof BLOCKS;
const QUESTIONS = Object.values(BLOCKS).flat();
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const value = z.number().int().min(0).max(5).nullable();
export const panelInput = z.strictObject({
  requestId: uuid,
  period: z.string().regex(/^[0-9]{4}-P[1-4]$/),
  observedOn: z.iso.date(),
  area: z.enum(['LECTURA', 'MATEMATICAS', 'AMBAS']),
  responses: z.strictObject(Object.fromEntries(QUESTIONS.map(q => [q, value])) as Record<(typeof QUESTIONS)[number], typeof value>),
  notes: z.strictObject({ A: z.string().max(140), B: z.string().max(140), C: z.string().max(140), D: z.string().max(140), E: z.string().max(140) }).partial().default({}),
});

const invalid = () => new AcademicError(400, 'INVALID_INPUT', 'Datos inválidos');
async function ownStudent(tx: Tx, actor: AcademicActor, id: string) {
  if (!uuid.safeParse(id).success) throw notFound();
  const [row] = await tx.select({ s: students }).from(students).innerJoin(groups, eq(groups.id, students.groupId))
    .where(and(eq(students.id, id), eq(groups.teacherId, actor.accountId)));
  if (!row) throw notFound();
  return row.s;
}
export function blockSummary(responses: Record<string, number | null>) {
  return Object.fromEntries((Object.keys(BLOCKS) as Block[]).map(b => {
    const answered = BLOCKS[b].map(q => responses[q]).filter((v): v is number => typeof v === 'number');
    const needed = BLOCKS[b].length === 1 ? 1 : 2;
    return [b, answered.length >= needed ? { status: 'OK', average: Math.round(answered.reduce((s, v) => s + v, 0) / answered.length * 10) / 10, answered: answered.length }
      : { status: 'INSUFFICIENT', average: null, answered: answered.length }];
  })) as Record<Block, { status: 'OK' | 'INSUFFICIENT'; average: number | null; answered: number }>;
}
const dto = (p: typeof observationPanels.$inferSelect) => ({ id: p.id, period: p.period, observedOn: p.observedOn, area: p.area, responses: p.responses, notes: p.notes,
  createdAt: p.createdAt.toISOString(), blocks: blockSummary(p.responses) });
// Por periodo cuenta el registro más reciente (lectura longitudinal).
function byPeriod(rows: (typeof observationPanels.$inferSelect)[]) {
  const latest = new Map<string, typeof observationPanels.$inferSelect>();
  for (const p of rows) { const old = latest.get(p.period); if (!old || p.observedOn > old.observedOn || p.observedOn === old.observedOn && p.createdAt > old.createdAt) latest.set(p.period, p); }
  return [...latest.values()].sort((a, b) => a.period.localeCompare(b.period)).map(p => ({ period: p.period, observedOn: p.observedOn, blocks: blockSummary(p.responses) }));
}

export async function createPanel(actor: AcademicActor, studentId: string, payload: unknown) {
  const parsed = panelInput.safeParse(payload); if (!parsed.success) throw invalid();
  const input = parsed.data;
  if (Date.parse(input.observedOn) > Date.now() + 86400000) throw invalid();
  return withAcademicAccess(actor, async tx => {
    await ownStudent(tx, actor, studentId);
    const [old] = await tx.select().from(observationPanels).where(and(eq(observationPanels.teacherId, actor.accountId), eq(observationPanels.requestId, input.requestId)));
    if (old) { if (old.studentId !== studentId) throw new AcademicError(409, 'CONFLICT', 'Solicitud en conflicto'); return { repeated: true, detail: dto(old) }; }
    const notes = Object.fromEntries(Object.entries(input.notes).map(([k, v]) => [k, v!.trim()]).filter(([, v]) => v));
    const [row] = await tx.insert(observationPanels).values({ studentId, teacherId: actor.accountId, period: input.period, observedOn: input.observedOn, area: input.area,
      responses: input.responses, notes, requestId: input.requestId }).returning();
    return { repeated: false, detail: dto(row!) };
  });
}
export async function listPanels(actor: AcademicActor, studentId: string) {
  return withAcademicAccess(actor, async tx => {
    await ownStudent(tx, actor, studentId);
    const rows = await tx.select().from(observationPanels).where(eq(observationPanels.studentId, studentId)).orderBy(desc(observationPanels.observedOn), desc(observationPanels.createdAt)).limit(200);
    return { items: rows.map(dto), periods: byPeriod(rows) };
  });
}

// ---- Estrella de prioridad: azul (al día), morado (revisar), rosado (prioridad), gris (datos insuficientes) ----
const METRICS: Record<string, { label: string; better: 'up' | 'down'; unit: 'pts' | 'items' }> = {
  accuracy_pct: { label: 'la precisión', better: 'up', unit: 'pts' }, precision_pct: { label: 'la precisión', better: 'up', unit: 'pts' },
  position_accuracy_pct: { label: 'la precisión de posiciones', better: 'up', unit: 'pts' }, longest_correct_length: { label: 'la serie más larga recordada', better: 'up', unit: 'items' },
  omission_rate_pct: { label: 'las omisiones', better: 'down', unit: 'pts' }, commission_rate_pct: { label: 'las respuestas impulsivas', better: 'down', unit: 'pts' },
  error_rate_pct: { label: 'los errores', better: 'down', unit: 'pts' }, order_error_rate_pct: { label: 'los errores de orden', better: 'down', unit: 'pts' },
};
const LIMITS = { pts: { mild: 10, strong: 20 }, items: { mild: 1, strong: 2 }, panel: { mild: 0.75, strong: 1.5 } };
const BLOCK_NAMES: Record<Block, string> = { A: 'atención sostenida', B: 'atención selectiva', C: 'memoria de trabajo', D: 'memoria de secuencias', E: 'persistencia' };
type Change = { strength: 'mild' | 'strong'; size: number; message: string };
export type Priority = { studentId: string; level: 'AL_DIA' | 'REVISAR' | 'PRIORIDAD' | 'INSUFICIENTE'; message: string; changes: string[] };

export function priorityFor(sessions: { taskId: string; title: string; values: Record<string, number> }[], periods: ReturnType<typeof byPeriod>): Omit<Priority, 'studentId'> {
  const changes: Change[] = []; let comparable = false;
  const byTask = new Map<string, typeof sessions>();
  for (const s of sessions) byTask.set(s.taskId, [...(byTask.get(s.taskId) ?? []), s]);
  for (const list of byTask.values()) {
    if (list.length < 2) continue;
    const [latest, ...before] = list, previous = before.slice(0, 3);
    for (const [code, m] of Object.entries(METRICS)) {
      const now = latest!.values[code], old = previous.map(p => p.values[code]).filter((v): v is number => typeof v === 'number');
      if (typeof now !== 'number' || !old.length) continue;
      comparable = true;
      const base = old.reduce((s, v) => s + v, 0) / old.length, worse = m.better === 'up' ? base - now : now - base, limit = LIMITS[m.unit];
      if (worse >= limit.mild) changes.push({ strength: worse >= limit.strong ? 'strong' : 'mild', size: worse / limit.strong,
        message: `${m.better === 'up' ? 'bajó' : 'subieron'} ${m.label} en ${latest!.title}` });
    }
  }
  if (periods.length >= 2) {
    const [prev, last] = periods.slice(-2) as [ (typeof periods)[number], (typeof periods)[number] ];
    for (const b of Object.keys(BLOCKS) as Block[]) {
      const x = prev.blocks[b].average, y = last.blocks[b].average;
      if (x === null || y === null) continue;
      comparable = true;
      const worse = x - y;
      if (worse >= LIMITS.panel.mild) changes.push({ strength: worse >= LIMITS.panel.strong ? 'strong' : 'mild', size: worse / LIMITS.panel.strong,
        message: `bajó lo observado en ${BLOCK_NAMES[b]} (${prev.period} → ${last.period})` });
    }
  }
  if (!comparable) return { level: 'INSUFICIENTE', message: 'Datos insuficientes', changes: [] };
  changes.sort((a, b) => b.size - a.size);
  const strong = changes.find(c => c.strength === 'strong');
  if (strong) return { level: 'PRIORIDAD', message: `Revisar pronto: ${strong.message}`, changes: changes.map(c => c.message) };
  if (changes.length) return { level: 'REVISAR', message: 'Algunos indicadores cambiaron', changes: changes.map(c => c.message) };
  return { level: 'AL_DIA', message: 'Sin cambios que revisar', changes: [] };
}

export async function groupPriority(actor: AcademicActor, groupId: string) {
  if (!uuid.safeParse(groupId).success) throw notFound();
  return withAcademicAccess(actor, async tx => {
    const [g] = await tx.select().from(groups).where(and(eq(groups.id, groupId), eq(groups.teacherId, actor.accountId)));
    if (!g) throw notFound();
    const list = await tx.select({ id: students.id }).from(students).where(and(eq(students.groupId, groupId), eq(students.isActive, true))).orderBy(asc(students.lastName));
    const ids = list.map(s => s.id), items: Priority[] = [];
    const titles = new Map((await tx.select({ id: tasks.id, title: tasks.title }).from(tasks)).map(t => [t.id, t.title]));
    const rows = ids.length ? await tx.select({ sessionId: gameSessions.id, studentId: gameSessions.studentId, taskId: gameSessions.taskId, at: gameSessions.startedAtServer, run: calculationRuns.runNumber,
      code: calculatedIndicators.metricCode, value: calculatedIndicators.value }).from(gameSessions)
      .innerJoin(calculationRuns, and(eq(calculationRuns.sessionId, gameSessions.id), eq(calculationRuns.status, 'SUCCEEDED')))
      .innerJoin(calculatedIndicators, and(eq(calculatedIndicators.runId, calculationRuns.id), eq(calculatedIndicators.scope, 'SESSION'), eq(calculatedIndicators.status, 'CALCULATED')))
      .where(and(inArray(gameSessions.studentId, ids), isNotNull(gameSessions.startedAtServer), inArray(calculatedIndicators.metricCode, Object.keys(METRICS))))
      .orderBy(desc(gameSessions.startedAtServer), desc(calculationRuns.runNumber)) : [];
    const panels = ids.length ? await tx.select().from(observationPanels).where(inArray(observationPanels.studentId, ids)) : [];
    for (const id of ids) {
      const sessions = new Map<string, { taskId: string; title: string; values: Record<string, number>; run: number }>();
      for (const r of rows.filter(x => x.studentId === id)) {
        const s = sessions.get(r.sessionId) ?? { taskId: r.taskId, title: titles.get(r.taskId) ?? r.taskId, values: {}, run: r.run };
        if (r.run === s.run && !(r.code in s.values)) s.values[r.code] = Number(r.value);
        sessions.set(r.sessionId, s);
      }
      items.push({ studentId: id, ...priorityFor([...sessions.values()], byPeriod(panels.filter(p => p.studentId === id))) });
    }
    return { groupId, notice: 'Prioridad de revisión, no diagnóstico. Compara a cada estudiante consigo mismo.', items };
  });
}
