// Apodo fijo por estudiante (único dentro del curso) + figura secreta; el ticket de aula es corto y firmado.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { accessSettings } from './access-security.js';
import { GameError } from './errors.js';

export const FIGURES = ['gato', 'perro', 'estrella', 'luna', 'cohete', 'arcoiris', 'manzana', 'balon'] as const;
export const normalizeAlias = (value: string) => [...value.trim().toUpperCase()]
  .map(ch => ch === 'Ñ' ? ch : ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).join('').replace(/[^A-Z0-9Ñ]/g, '');
export const aliasInput = z.string().max(40).transform(normalizeAlias).pipe(z.string().regex(/^[A-Z0-9Ñ]{3,15}$/));
export const figureInput = z.number().int().min(0).max(FIGURES.length - 1);
export const ticketInput = z.string().max(400).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
const TTL = 20 * 60000;
const mac = (body: string) => createHmac('sha256', Buffer.from(accessSettings().lookupKey, 'hex')).update('aula-ticket:' + body).digest('base64url');

export function signTicket(studentId: string, groupId: string, profileVersion: number, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ s: studentId, g: groupId, v: profileVersion, e: now + TTL })).toString('base64url');
  return `${body}.${mac(body)}`;
}
export function readTicket(ticket: string, now = Date.now()) {
  const [body, signature] = ticket.split('.') as [string, string];
  const expected = Buffer.from(mac(body)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
  const t = z.object({ s: z.uuid(), g: z.uuid(), v: z.number(), e: z.number() }).safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
  if (!t.success || t.data.e <= now) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED', 'TICKET_EXPIRED');
  return { studentId: t.data.s, groupId: t.data.g, profileVersion: t.data.v };
}
