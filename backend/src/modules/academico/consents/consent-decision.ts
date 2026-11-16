import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AcademicTransaction } from '../shared/academic-auth.js';

export type ConsentState = 'NONE' | 'CURRENT' | 'REVOKED';
export type ConsentDecision =
  | { kind: 'available'; state: 'CURRENT'; version: number; authorizationReference: string; validUntil: Date }
  | { kind: 'available'; state: 'NONE' | 'REVOKED'; version: number }
  | { kind: 'unavailable' };
export type ConsentBatch = { kind: 'complete'; evaluatedAt: Date; items: { studentId: string; state: ConsentState; version: number }[] } | { kind: 'unavailable' };
type Row = { studentId: string; version: number | null; type: string | null; recordId: string | null; evidenceId: string | null; validUntil: string | null };
// The caller authorizes scope and supplies its transaction/locks. Never query global db here.
async function read(tx: AcademicTransaction, ids: readonly string[], groupId?: string) {
  // Vigencia efectiva: la registrada o, en registros anteriores, el 31 de diciembre del año escolar del curso.
  return (await tx.execute<Row>(sql`select s.id as "studentId", e.version, e.type, e.record_id as "recordId", r.id as "evidenceId",
      to_char(coalesce(r.valid_until, make_date(g.school_year, 12, 31)), 'YYYY-MM-DD') as "validUntil"
    from students s left join groups g on g.id = s.group_id left join lateral
      (select version, type, record_id from consent_events where student_id=s.id order by version desc limit 1) e on true
    left join consent_records r on r.id=e.record_id and r.student_id=s.id
    where s.id = any(${`{${ids.join(',')}}`}::uuid[])
      ${groupId ? sql`and s.group_id=${groupId}::uuid` : sql``} order by s.id`)).rows;
}
function decision(row: Row): ConsentDecision {
  if (row.version === null && row.type === null && row.recordId === null) return { kind: 'available', state: 'NONE', version: 0 };
  if (!Number.isSafeInteger(row.version) || row.version! < 1 || !row.recordId || row.recordId !== row.evidenceId) return { kind: 'unavailable' };
  if (row.type === 'REVOKE') return { kind: 'available', state: 'REVOKED', version: row.version! };
  if (row.type !== 'REGISTER' && row.type !== 'REPLACE') return { kind: 'unavailable' };
  // Vence al terminar el día (hora de Bogotá, UTC-5) de su fecha de vigencia.
  const validUntil = row.validUntil ? new Date(`${row.validUntil}T23:59:59.999-05:00`) : null;
  if (!validUntil || !Number.isFinite(validUntil.getTime())) return { kind: 'unavailable' };
  return { kind: 'available', state: 'CURRENT', version: row.version!, authorizationReference: `CONSENT:${row.recordId}`, validUntil };
}
export async function readConsentDecision(tx: AcademicTransaction, studentId: string, at: Date): Promise<ConsentDecision> {
  if (!z.uuid().safeParse(studentId).success || !Number.isFinite(at.getTime())) return { kind: 'unavailable' };
  const rows = await read(tx, [studentId]).catch(() => null);
  // SQL failures abort the transaction: callers must reject unavailable, never continue writing.
  if (!rows) return { kind: 'unavailable' };
  return rows.length === 1 ? decision(rows[0]!) : { kind: 'unavailable' };
}
export async function readConsentDecisions(tx: AcademicTransaction, groupId: string, studentIds: readonly string[], at: Date): Promise<ConsentBatch> {
  if (!z.uuid().safeParse(groupId).success || !Number.isFinite(at.getTime()) || new Set(studentIds).size !== studentIds.length ||
    studentIds.some(id => !z.uuid().safeParse(id).success)) return { kind: 'unavailable' };
  const rows = await read(tx, studentIds, groupId).catch(() => null);
  if (!rows || rows.length !== studentIds.length) return { kind: 'unavailable' };
  const items: Extract<ConsentBatch, { kind: 'complete' }>['items'] = [];
  for (const row of rows) {
    const value = decision(row);
    if (value.kind === 'unavailable') return value;
    items.push({ studentId: row.studentId, state: value.state, version: value.version });
  }
  return { kind: 'complete', evaluatedAt: at, items };
}
