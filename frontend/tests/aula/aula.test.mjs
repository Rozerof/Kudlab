import test from 'node:test';
import assert from 'node:assert/strict';
import { createAulaApi, normalizeAlias, reasonOf } from '../../src/features/aula/api.ts';
import { consentValidity, bogotaToday } from '../../src/features/academico/consents/types.ts';
import { consentAccess } from '../../src/features/academico/consents/api.ts';
import { createHttpClient } from '../../src/lib/http.ts';

const group = '10000000-0000-4000-8000-000000000001', student = '10000000-0000-4000-8000-000000000002';
const signal = () => new AbortController().signal;
const room = { groupId: group, window: null, students: [], games: [] };
function setup(respond) {
  const calls = [];
  const controller = { getGeneration: () => 1, notify: () => {} };
  const http = createHttpClient('http://localhost:4300', consentAccess(controller), async (url, init) => { calls.push({ url, init }); return respond(url, init); });
  return { api: createAulaApi(http), calls };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('el apodo se normaliza como en el servidor: sin tildes ni espacios, conserva la Ñ', () => {
  assert.equal(normalizeAlias(' Sofí  la-Niña '), 'SOFILANIÑA');
  assert.equal(normalizeAlias('tígre 7'), 'TIGRE7');
});
test('activar un juego envía audiencia y límites (intentos y fecha) solo si se eligen', async () => {
  const { api, calls } = setup(() => json(200, room));
  await api.activate(group, 'TG-02', 'GROUP', [], signal(), { maxAttempts: 2, until: '2026-12-15' });
  await api.activate(group, 'TG-03', 'STUDENTS', [student], signal());
  assert.deepEqual(JSON.parse(calls[0].init.body), { taskId: 'TG-02', audience: 'GROUP', studentIds: [], maxAttempts: 2, until: '2026-12-15' });
  assert.deepEqual(JSON.parse(calls[1].init.body), { taskId: 'TG-03', audience: 'STUDENTS', studentIds: [student] });
  assert.match(calls[0].url, /\/api\/v1\/groups\/.+\/aula\/activations$/);
});
test('el motivo del conflicto llega a la interfaz (apodo en uso, límites inválidos)', async () => {
  const { api } = setup(() => json(409, { code: 'CONFLICT', message: 'x', reason: 'ALIAS_TAKEN' }));
  const r = await api.setProfile(student, 'TIGRE', 1, signal());
  assert.equal(reasonOf(r), 'ALIAS_TAKEN');
});
test('IDs inválidos no salen a la red', async () => {
  const { api, calls } = setup(() => json(200, room));
  const r = await api.classroom('no-es-uuid', signal());
  assert.equal(r.kind, 'error'); assert.equal(calls.length, 0);
});
test('vigencia del consentimiento: vencido solo si la fecha ya pasó en Colombia', () => {
  const snap = validUntil => ({ consent: { state: 'CURRENT', version: 1, currentRecord: { validUntil } } });
  assert.deepEqual(consentValidity(snap('2000-01-01')), { until: '2000-01-01', expired: true });
  assert.deepEqual(consentValidity(snap(bogotaToday())), { until: bogotaToday(), expired: false });
  assert.deepEqual(consentValidity(snap(null)), { until: null, expired: false });
  assert.equal(consentValidity({ consent: { state: 'REVOKED', version: 2, currentRecord: null } }), undefined);
});
