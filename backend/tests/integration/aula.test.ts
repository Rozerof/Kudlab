// Modo aula: apodo + figura secreta, clase abierta y activación de juegos por curso o por estudiante.
import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { reset } from '../helpers.js';
import { gameFixture, testGameApp } from '../game-fixture.js';
import { normalizeAlias } from '../../src/modules/tareas/runtime/aula-security.js';
import { publishExternal } from '../../src/modules/tareas/catalog/publish.js';
import { assertResponse, operations, readContract } from '../openapi.helpers.js';

process.env.GAME_RUNTIME_ORIGIN = 'http://127.0.0.1:4178';
process.env.GAME_GRANT_KEYS = JSON.stringify({ test1: 'ab'.repeat(32) }); process.env.GAME_ACTIVE_KEY_ID = 'test1'; process.env.GAME_CURSOR_KEY = 'cd'.repeat(32);
process.env.GAME_ACCESS_ENABLED = 'true'; process.env.GAME_ACCESS_KEYS = JSON.stringify({ test1: 'ef'.repeat(32) }); process.env.GAME_ACCESS_ACTIVE_KEY_ID = 'test1';
process.env.GAME_ACCESS_LOOKUP_KEY = '12'.repeat(32); process.env.GAME_ACCESS_IP_KEY = '34'.repeat(32);
const app = testGameApp();
const contract = readContract(), covered = new Set<string>();
async function call(path: string, body?: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const r = await app.request('/api/v1' + path, { method, headers: { origin: path.startsWith('/game-runtime') ? process.env.GAME_RUNTIME_ORIGIN! : 'http://localhost:5173', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const operation = operations(contract).find(([route, m]) => m === method.toLowerCase() && new RegExp('^' + route.replace(/\{[^}]+\}/g, '[^/]+') + '$').test('/api/v1' + path));
  if (operation) { await assertResponse(contract, operation[0], method, r.clone()); if (r.ok) covered.add(operation[2].operationId); }
  return { status: r.status, body: await r.json().catch(() => null) };
}

describe('Modo aula', () => {
  beforeEach(reset);
  it('normaliza el apodo sin tildes ni espacios y conserva la Ñ', () => {
    expect(normalizeAlias(' Sofí  la-Niña ')).toBe('SOFILANIÑA');
  });
  it('apodo único por curso, clase abierta, juego para todo el curso y para un solo niño', async () => {
    const f = await gameFixture(), t = f.a.teacher, group = f.student.groupId;
    expect((await call(`/students/${f.student.id}/play-profile`, { alias: 'Tigre', figure: 3 }, t, 'PUT')).status).toBe(200);
    const taken = await call(`/students/${f.secondStudent.id}/play-profile`, { alias: 'tigre', figure: 1 }, t, 'PUT');
    expect(taken).toMatchObject({ status: 409, body: { reason: 'ALIAS_TAKEN' } });
    // El mismo apodo sí puede repetirse en otro curso del docente B.
    expect((await call(`/students/${f.student.id}/play-profile`, { alias: 'Tigre', figure: 3 }, f.b.teacher, 'PUT')).status).toBe(404);
    // Apodos automáticos: solo a quien no tiene; a partir del seudónimo y sin repetir en el curso.
    const auto = await call(`/groups/${group}/aula/auto-profiles`, {}, t);
    expect(auto.body).toMatchObject({ created: 1 });
    expect(auto.body.students.find((x: { id: string }) => x.id === f.secondStudent.id).alias).toBe('PARTICIPANTE');
    expect(auto.body.students.find((x: { id: string }) => x.id === f.student.id).alias).toBe('TIGRE');
    expect((await call(`/students/${f.secondStudent.id}/play-profile`, { alias: 'Luna', figure: 5 }, t, 'PUT')).status).toBe(200);

    // Clase cerrada: no hay cursos visibles y el apodo no entra.
    expect((await call('/game-runtime/access/aula/groups', undefined, {}, 'GET')).body.items).toEqual([]);
    expect((await call('/game-runtime/access/aula/identify', { groupId: group, alias: 'TIGRE', figure: 3 })).body).toMatchObject({ reason: 'CLASS_CLOSED' });
    const opened = await call(`/groups/${group}/aula/open`, { minutes: 60 }, t);
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.body.window).not.toBeNull();
    expect((await call('/game-runtime/access/aula/groups', undefined, {}, 'GET')).body.items).toEqual([{ id: group, name: 'A1', grade: '3' }]);

    // Figura incorrecta → acceso no disponible, sin pistas.
    expect((await call('/game-runtime/access/aula/identify', { groupId: group, alias: 'tigre', figure: 2 })).status).toBe(403);
    const who = await call('/game-runtime/access/aula/identify', { groupId: group, alias: 'tígre', figure: 3 });
    expect(who.status, JSON.stringify(who.body)).toBe(200);
    expect(who.body).toMatchObject({ alias: 'TIGRE', games: [] });

    // Activación para todo el curso.
    expect((await call(`/groups/${group}/aula/activations`, { taskId: 'TG-01', audience: 'GROUP', until: '2020-01-01' }, t)).body).toMatchObject({ reason: 'INVALID_LIMITS' });
    const act = await call(`/groups/${group}/aula/activations`, { taskId: 'TG-01', audience: 'GROUP', maxAttempts: 2 }, t);
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    expect(act.body.games.find((g: { taskId: string }) => g.taskId === 'TG-01').activation).toMatchObject({ audience: 'GROUP', maxAttempts: 2, expired: false });
    const games = await call('/game-runtime/access/aula/games', { ticket: who.body.ticket });
    expect(games.body.games).toEqual([expect.objectContaining({ taskId: 'TG-01', attemptsLeft: 2, canPlay: true })]);

    // Código del juego → flujo normal de Play (claim + start). Reintentar sin iniciar no bloquea.
    const first = await call('/game-runtime/access/aula/code', { ticket: who.body.ticket, taskId: 'TG-01' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    await call('/game-runtime/access/claim', { code: first.body.code, claimId: randomUUID(), runtimeSecret: randomBytes(32).toString('base64url') });
    const code = (await call('/game-runtime/access/aula/code', { ticket: who.body.ticket, taskId: 'TG-01' })).body.code;
    const secret = randomBytes(32).toString('base64url');
    const ctx = await call('/game-runtime/access/claim', { code, claimId: randomUUID(), runtimeSecret: secret });
    expect(ctx.status, JSON.stringify(ctx.body)).toBe(200);
    expect((await call(`/game-runtime/sessions/${ctx.body.sessionId}/start`, { startId: randomUUID() }, { authorization: `Bearer ${secret}` })).status).toBe(200);
    expect((await call('/game-runtime/access/aula/games', { ticket: who.body.ticket })).body.games[0]).toMatchObject({ attemptsLeft: 1 });

    // Solo para un estudiante: el otro deja de verlo.
    await call(`/groups/${group}/aula/activations`, { taskId: 'TG-01', audience: 'STUDENTS', studentIds: [f.secondStudent.id] }, t);
    expect((await call('/game-runtime/access/aula/games', { ticket: who.body.ticket })).body.games).toEqual([]);
    expect((await call('/game-runtime/access/aula/code', { ticket: who.body.ticket, taskId: 'TG-01' })).body).toMatchObject({ reason: 'GAME_INACTIVE' });
    const luna = await call('/game-runtime/access/aula/identify', { groupId: group, alias: 'LUNA', figure: 5 });
    expect(luna.body.games).toHaveLength(1);
    // Canje directo del modo aula (sin pasar por /access/claim); repetir el mismo claimId es idempotente.
    const direct = { ticket: luna.body.ticket, taskId: 'TG-01', claimId: randomUUID(), runtimeSecret: randomBytes(32).toString('base64url') };
    const once = await call('/game-runtime/access/aula/claim', direct);
    expect(once.status, JSON.stringify(once.body)).toBe(200);
    expect((await call('/game-runtime/access/aula/claim', direct)).body.sessionId).toBe(once.body.sessionId);

    // Cambiar la figura invalida el ticket; cerrar la clase corta el acceso.
    await call(`/students/${f.secondStudent.id}/play-profile`, { alias: 'Luna', figure: 6 }, t, 'PUT');
    expect((await call('/game-runtime/access/aula/games', { ticket: luna.body.ticket })).status).toBe(403);
    await call(`/groups/${group}/aula/activations/TG-01/end`, {}, t);
    expect((await call(`/groups/${group}/aula`, undefined, t, 'GET')).body.games.find((g: { taskId: string }) => g.taskId === 'TG-01').activation).toBeNull();
    await call(`/groups/${group}/aula/close`, {}, t);
    expect((await call('/game-runtime/access/aula/games', { ticket: who.body.ticket })).body).toMatchObject({ reason: 'CLASS_CLOSED' });
    const documented = operations(contract).filter(([route]) => route.includes('/aula') || route.endsWith('/play-profile')).map(([, , op]) => op.operationId);
    expect(documented).toHaveLength(12);
    expect([...covered].filter(id => documented.includes(id)).sort()).toEqual(documented.sort());
  });
  it('TG-01 publicada con el juego TD de Lluvia de estrellas: el modo aula entrega el contexto ext-1', async () => {
    const f = await gameFixture(), t = f.a.teacher, group = f.student.groupId;
    await publishExternal('TG-01');
    await call(`/students/${f.student.id}/play-profile`, { alias: 'Cometa', figure: 2 }, t, 'PUT');
    await call(`/groups/${group}/aula/open`, { minutes: 30 }, t);
    expect((await call(`/groups/${group}/aula/activations`, { taskId: 'TG-01', audience: 'GROUP' }, t)).status).toBe(200);
    const who = await call('/game-runtime/access/aula/identify', { groupId: group, alias: 'COMETA', figure: 2 });
    const ctx = await call('/game-runtime/access/aula/claim', { ticket: who.body.ticket, taskId: 'TG-01', claimId: randomUUID(), runtimeSecret: randomBytes(32).toString('base64url') });
    expect(ctx.status, JSON.stringify(ctx.body)).toBe(200);
    expect(ctx.body).toMatchObject({ taskId: 'TG-01', contractVersion: 'ext-1', gameBuildId: 'td-lluvia-estrellas-1' });
  });
});
