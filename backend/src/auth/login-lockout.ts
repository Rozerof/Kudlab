// DF-25001: bloqueo temporal tras intentos fallidos de inicio de sesión.
// Se cuenta por correo normalizado (exista o no la cuenta, para no revelar cuáles existen).
// 5 fallos seguidos dentro de 15 minutos bloquean ese correo 15 minutos; un ingreso correcto reinicia la cuenta.
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { loginFailures } from '../db/schema/authentication.js';

export const LOCKOUT_MAX_FAILURES = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const digest = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** Milisegundos que faltan de bloqueo, o 0 si el correo puede intentar. */
export async function lockRemainingMs(email: string, now = new Date()): Promise<number> {
  const [row] = await db.select({ lockedUntil: loginFailures.lockedUntil }).from(loginFailures).where(eq(loginFailures.emailDigest, digest(email)));
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil.getTime() - now.getTime() : 0;
}

export async function recordLoginFailure(email: string, now = new Date()): Promise<void> {
  const windowStart = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const lockUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
  // Atómico: varias peticiones simultáneas no pueden saltarse el conteo.
  await db.execute(sql`
    insert into login_failures (email_digest, failures, last_failure_at, locked_until)
    values (${digest(email)}, 1, ${now.toISOString()}, null)
    on conflict (email_digest) do update set
      failures = case when login_failures.last_failure_at < ${windowStart.toISOString()} then 1 else login_failures.failures + 1 end,
      last_failure_at = excluded.last_failure_at,
      locked_until = case
        when (case when login_failures.last_failure_at < ${windowStart.toISOString()} then 1 else login_failures.failures + 1 end) >= ${LOCKOUT_MAX_FAILURES}
        then ${lockUntil.toISOString()}::timestamptz else login_failures.locked_until end`);
}

export async function clearLoginFailures(email: string): Promise<void> {
  await db.delete(loginFailures).where(eq(loginFailures.emailDigest, digest(email)));
}
