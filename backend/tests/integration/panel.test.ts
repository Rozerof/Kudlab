// Panel de observación 0–5 y estrella de prioridad (comparación del estudiante consigo mismo).
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { reset } from '../helpers.js';
import { gameFixture, testGameApp } from '../game-fixture.js';
import { blockSummary, priorityFor } from '../../src/modules/seguimiento/panel/panel.service.js';

const app = testGameApp();
async function call(path: string, body?: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const r = await app.request('/api/v1' + path, { method, headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const all = (v: number | null) => Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`OD-${String(i + 1).padStart(2, '0')}`, v]));

describe('Panel de observación docente', () => {
  beforeEach(reset);
  it('resume por bloque con mínimo de 2 respuestas (E: 1) y null nunca es 0', () => {
    const r = { ...all(null), 'OD-01': 4, 'OD-02': 2, 'OD-04': 5, 'OD-13': 0 };
    const s = blockSummary(r);
    expect(s.A).toEqual({ status: 'OK', average: 3, answered: 2 });
    expect(s.B).toMatchObject({ status: 'INSUFFICIENT', average: null });
    expect(s.E).toMatchObject({ status: 'OK', average: 0 });
  });
  it('prioridad: gris sin historia, azul estable, morado leve, rosado fuerte con mensaje', () => {
    expect(priorityFor([], []).level).toBe('INSUFICIENTE');
    const s = (v: number) => ({ taskId: 'TG-02', title: 'Palabra intrusa', values: { precision_pct: v } });
    expect(priorityFor([s(80), s(82)], []).level).toBe('AL_DIA');
    expect(priorityFor([s(70), s(80)], []).level).toBe('REVISAR');
    expect(priorityFor([s(50), s(80), s(78)], [])).toMatchObject({ level: 'PRIORIDAD', message: 'Revisar pronto: bajó la precisión en Palabra intrusa' });
  });
  it('guarda el registro con periodo, fecha y área; es idempotente y solo para el docente del curso', async () => {
    const f = await gameFixture(), t = f.a.teacher, id = f.student.id;
    const payload = { requestId: randomUUID(), period: '2026-P4', observedOn: '2026-11-13', area: 'AMBAS', responses: { ...all(3), 'OD-08': null }, notes: { A: '  Se distrae con ruido  ' } };
    const created = await call(`/students/${id}/observation-panels`, payload, t);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.notes).toEqual({ A: 'Se distrae con ruido' });
    expect(created.body.blocks.C).toEqual({ status: 'OK', average: 3, answered: 2 });
    expect((await call(`/students/${id}/observation-panels`, payload, t)).status).toBe(200);
    expect((await call(`/students/${id}/observation-panels`, { ...payload, requestId: randomUUID(), responses: { ...all(3), 'OD-01': 6 } }, t)).status).toBe(400);
    expect((await call(`/students/${id}/observation-panels`, { ...payload, requestId: randomUUID(), notes: { A: 'x'.repeat(141) } }, t)).status).toBe(400);
    expect((await call(`/students/${id}/observation-panels`, undefined, f.b.teacher, 'GET')).status).toBe(404);
    await call(`/students/${id}/observation-panels`, { ...payload, requestId: randomUUID(), period: '2026-P3', observedOn: '2026-08-10', responses: all(5) }, t);
    const list = await call(`/students/${id}/observation-panels`, undefined, t, 'GET');
    expect(list.body.items).toHaveLength(2);
    expect(list.body.periods.map((p: { period: string }) => p.period)).toEqual(['2026-P3', '2026-P4']);
    const star = await call(`/groups/${f.student.groupId}/review-priority`, undefined, t, 'GET');
    expect(star.status, JSON.stringify(star.body)).toBe(200);
    expect(star.body.items.find((i: { studentId: string }) => i.studentId === id)).toMatchObject({ level: 'PRIORIDAD' });
    expect(star.body.items.find((i: { studentId: string }) => i.studentId === f.secondStudent.id)).toMatchObject({ level: 'INSUFICIENTE', message: 'Datos insuficientes' });
    expect((await call(`/groups/${f.student.groupId}/review-priority`, undefined, f.b.teacher, 'GET')).status).toBe(404);
  });
});
