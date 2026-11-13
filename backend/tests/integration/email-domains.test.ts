// ALLOWED_EMAIL_DOMAINS permite invitar, activar e iniciar sesión con dominios no institucionales (p. ej. gmail.com).
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.ALLOWED_EMAIL_DOMAINS = '.edu.co,gmail.com'; });
import { capturedMail } from '../../src/modules/usuarios/invitations/invitations.mailer.js';
import { login, request, reset } from '../helpers.js';

describe('dominios de correo configurables', () => {
  beforeEach(reset);
  it('invita, envía el correo, activa e inicia sesión con un Gmail; rechaza otros dominios', async () => {
    const admin = await login();
    const created = await request('/api/v1/accounts', 'POST', { name: 'Docente Gmail', email: 'Docente.Kudlab@Gmail.com', role: 'TEACHER' }, admin);
    expect(created.status, await created.clone().text()).toBe(201);
    expect(capturedMail.at(-1)?.to).toBe('docente.kudlab@gmail.com');
    const token = new URL(capturedMail.at(-1)!.url).searchParams.get('token');
    expect((await request('/api/v1/account-invitations/accept', 'POST', { token, password: 'TeacherPass1' })).status).toBe(200);
    expect(await login('docente.kudlab@gmail.com', 'TeacherPass1')).toBeTruthy();
    expect((await request('/api/v1/accounts', 'POST', { name: 'Otro', email: 'otro@hotmail.com', role: 'TEACHER' }, admin)).status).toBe(400);
  });
});
