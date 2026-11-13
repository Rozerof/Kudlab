// TG-02 a TG-04 (contrato ext-1): asignación, código, inicio, entrega idempotente y cálculo en el servidor.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { db } from '../../src/db/client.js';
import { tasks } from '../../src/db/schema/tasks.js';
import { calculatedIndicators, externalResults } from '../../src/db/schema/game.js';
import { reset } from '../helpers.js';
import { gameFixture, testGameApp, gameDependencies } from '../game-fixture.js';
import { publishExternal } from '../../src/modules/tareas/catalog/publish.js';
import { processOne } from '../../src/modules/evolucion/processor.js';
import { calculateExternal } from '../../src/modules/evolucion/external.js';

process.env.GAME_RUNTIME_ORIGIN = 'http://127.0.0.1:4178';
process.env.GAME_GRANT_KEYS = JSON.stringify({ test1: 'ab'.repeat(32) }); process.env.GAME_ACTIVE_KEY_ID = 'test1'; process.env.GAME_CURSOR_KEY = 'cd'.repeat(32);
process.env.GAME_ACCESS_ENABLED = 'true'; process.env.GAME_ACCESS_KEYS = JSON.stringify({ test1: 'ef'.repeat(32) }); process.env.GAME_ACCESS_ACTIVE_KEY_ID = 'test1';
process.env.GAME_ACCESS_LOOKUP_KEY = '12'.repeat(32); process.env.GAME_ACCESS_IP_KEY = '34'.repeat(32);
const app = testGameApp();
async function call(path: string, body?: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const r = await app.request('/api/v1' + path, { method, headers: { origin: path.startsWith('/game-runtime') ? process.env.GAME_RUNTIME_ORIGIN! : 'http://localhost:5173', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const choice = (n: number, correct: number) => Array.from({ length: n }, (_, i) => ({ trial: i + 1, valid: true, result: i < correct ? 'correct' : 'incorrect', anticipatory: false, rtMs: 900 + i * 10, level: 1 + (i % 3), load: 2 + (i % 3), segment: 1 + (i % 3) }));

describe('Juegos externos TG-02 a TG-04', () => {
  beforeEach(async () => {
    await reset();
    // Otras pruebas vacían el catálogo y solo resiembran TG-01: se vuelven a sembrar TG-02 a TG-04 (migración 0017).
    const seed = readFileSync(new URL('../../src/db/migrations/0017_external_games.sql', import.meta.url), 'utf8').split('--> statement-breakpoint').at(-1)!;
    await db.execute(sql.raw(seed));
  });
  // Deja el catálogo como lo crean las migraciones (sin publicaciones ni reglas de TG-02 a TG-04) para no afectar otras pruebas.
  afterAll(async () => {
    await reset(); await db.execute(sql`truncate tasks restart identity cascade`);
    for (const m of ['0009_task_catalog', '0017_external_games'])
      await db.execute(sql.raw(readFileSync(new URL(`../../src/db/migrations/${m}.sql`, import.meta.url), 'utf8').split('--> statement-breakpoint').at(-1)!));
  });
  it('recalcula en el servidor con las fórmulas del juego', () => {
    const r = calculateExternal('TG-02', choice(18, 12), true);
    expect(r.indicators.find(i => i.metricCode === 'precision_pct')?.value).toBeCloseTo(66.666, 2);
    expect(r.indicators.find(i => i.metricCode === 'median_reaction_time_ms')?.sampleSize).toBe(12);
    const d = calculateExternal('TG-04', [{ valid: true, outcome: 'correct', length: 3, positionsCorrect: 3, orderErrors: 0, firstTapLatencyMs: 700 }, { valid: true, outcome: 'incorrect', length: 4, positionsCorrect: 2, orderErrors: 2, firstTapLatencyMs: 800 }], true);
    expect(d.indicators.find(i => i.metricCode === 'longest_correct_length')?.value).toBe(3);
    expect(d.indicators.find(i => i.metricCode === 'position_accuracy_pct')?.value).toBeCloseTo(5 / 7 * 100, 4);
    expect(calculateExternal('TG-03', choice(12, 6), false).indicators.every(i => i.status === 'NOT_AVAILABLE' && i.unavailabilityReason === 'METHOD_NOT_APPROVED')).toBe(true);
  });
  for (const taskId of ['TG-02', 'TG-03', 'TG-04'] as const) {
    it(`${taskId}: código → inicio → entrega ext-1 → indicadores`, async () => {
      const f = await gameFixture();
      const versionId = await publishExternal(taskId);
      await db.update(tasks).set({ isEnabled: true }).where(eq(tasks.id, taskId));
      const catalog = await call('/tasks', undefined, f.a.teacher, 'GET');
      expect(catalog.body.items.find((t: { id: string }) => t.id === taskId)).toMatchObject({ integrationReady: true });
      const a = await call('/task-assignments', { requestId: randomUUID(), taskId, publishedVersionId: versionId, groupId: f.student.groupId, studentIds: [f.student.id], startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), maxAttempts: 1 }, f.a.teacher);
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      const batch = await call(`/task-assignments/${a.body.id}/access-codes`, { requestId: randomUUID(), recipientIds: [a.body.recipients[0].id] }, f.a.teacher);
      const code = (await call(`/task-access-codes/${batch.body.items[0].id}/reveal`, {}, f.a.teacher)).body.code;
      const secret = randomBytes(32).toString('base64url');
      const ctx = await call('/game-runtime/access/claim', { code, claimId: randomUUID(), runtimeSecret: secret });
      expect(ctx.status, JSON.stringify(ctx.body)).toBe(200);
      expect(ctx.body).toMatchObject({ taskId, contractVersion: 'ext-1' });
      const auth = { authorization: `Bearer ${secret}` };
      expect((await call(`/game-runtime/sessions/${ctx.body.sessionId}/start`, { startId: randomUUID() }, auth)).status).toBe(200);
      const events = taskId === 'TG-04' ? [{ valid: true, outcome: 'correct', length: 2, positionsCorrect: 2, orderErrors: 0, firstTapLatencyMs: 600 }] : choice(12, 9);
      const envelope = { contractVersion: 'ext-1', sessionId: ctx.body.sessionId, submissionId: randomUUID(), taskId, publishedVersionId: ctx.body.publishedVersionId,
        configVersion: ctx.body.configVersion, configurationHash: ctx.body.configurationHash, gameBuildId: ctx.body.gameBuildId, state: 'completed', terminationReason: 'time_limit',
        clock: { id: randomUUID(), timeOriginUnixMs: Date.now() }, timing: { startedAtMs: 10, finishedAtMs: 80000, lastCheckpointAtMs: 80000 },
        device: { viewportWidth: 1280, viewportHeight: 800, stageScale: 1, touchCapable: false }, payload: { taskId, state: 'completed', events } };
      const sent = await call(`/game-runtime/sessions/${ctx.body.sessionId}/results`, envelope, auth);
      expect(sent.status, JSON.stringify(sent.body)).toBe(201);
      expect((await call(`/game-runtime/sessions/${ctx.body.sessionId}/results`, envelope, auth)).status).toBe(200);
      const conflict = await call(`/game-runtime/sessions/${ctx.body.sessionId}/results`, { ...envelope, submissionId: randomUUID() }, auth);
      expect(conflict.status).toBe(409);
      await processOne(gameDependencies);
      const [stored] = await db.select().from(externalResults).where(eq(externalResults.sessionId, ctx.body.sessionId));
      expect(stored?.eventCount).toBe(events.length);
      const values = await db.select().from(calculatedIndicators);
      expect(values.length).toBeGreaterThan(0);
      const detail = await call(`/task-sessions/${ctx.body.sessionId}`, undefined, f.a.teacher, 'GET');
      expect(detail.body).toMatchObject({ processingStatus: 'COMPLETED', recordedTrialCount: events.length });
    });
  }
});
