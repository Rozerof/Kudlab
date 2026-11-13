// DF-25001: bloqueo temporal por correo tras intentos fallidos e IP de cliente solo desde el proxy autenticado.
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { LOCKOUT_MAX_FAILURES } from '../../src/auth/login-lockout.js';
import { reset } from '../helpers.js';

const signIn = (email: string, password: string) => app.request('/api/auth/sign-in/email', { method: 'POST',
  headers: { origin: process.env.SPA_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });

describe('bloqueo de inicio de sesión', () => {
  beforeEach(reset);
  it(`bloquea el correo tras ${LOCKOUT_MAX_FAILURES} fallos, incluso con la contraseña correcta, y no revela si la cuenta existe`, async () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) expect((await signIn('admin@pilot.edu.co', 'Incorrecta1')).status).toBe(401);
    const locked = await signIn('admin@pilot.edu.co', 'TestingA123');
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) await signIn('nadie@pilot.edu.co', 'Incorrecta1');
    expect((await signIn('nadie@pilot.edu.co', 'Incorrecta1')).status).toBe(429);
    const [row] = (await db.execute(sql`select email_digest from login_failures limit 1`)).rows as { email_digest: string }[];
    expect(row!.email_digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('un ingreso correcto reinicia el conteo y el bloqueo vence', async () => {
    for (let i = 0; i < LOCKOUT_MAX_FAILURES - 1; i++) await signIn('admin@pilot.edu.co', 'Incorrecta1');
    expect((await signIn('admin@pilot.edu.co', 'TestingA123')).status).toBe(200);
    for (let i = 0; i < LOCKOUT_MAX_FAILURES - 1; i++) await signIn('admin@pilot.edu.co', 'Incorrecta1');
    expect((await signIn('admin@pilot.edu.co', 'TestingA123')).status).toBe(200);
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) await signIn('admin@pilot.edu.co', 'Incorrecta1');
    await db.execute(sql`update login_failures set locked_until = now() - interval '1 second', last_failure_at = now() - interval '16 minutes'`);
    expect((await signIn('admin@pilot.edu.co', 'TestingA123')).status).toBe(200);
  });
});
