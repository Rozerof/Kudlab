import { eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { accessLimits } from '../../../db/schema/access.js';
import { accessDigest } from './access-security.js';
// 'aula': toda una clase entra desde la misma IP del colegio; el apodo tiene además su propio límite ('code').
const LIMITS = { ip: { windowMs: 300000, maximum: 120, burst: 60, refill: .0004 }, aula: { windowMs: 300000, maximum: 1500, burst: 400, refill: .004 }, code: { windowMs: 900000, maximum: 10, burst: 0, refill: 0 } };
export async function accessLimit(value: string, kind: 'ip' | 'code' | 'aula', now = Date.now(), operation?: string): Promise<number> {
  const { windowMs, maximum, burst, refill } = LIMITS[kind], perIp = kind !== 'code';
  const key = `${kind}:${accessDigest(value, perIp)}`;
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [old] = await tx.select().from(accessLimits).where(eq(accessLimits.key, key));
    const events = old && old.expiresAt.getTime() > now ? old.events.filter(event => event.at > now - windowMs) : [];
    if (operation && events.some(event => event.operation === operation)) return 0;
    const tokens = old ? Math.min(burst, old.tokens + Math.max(0, now - old.touchedAt.getTime()) * refill) : burst;
    const wait = Math.max(events.length >= maximum ? events[0]!.at + windowMs - now : 0, perIp && tokens < 1 ? (1 - tokens) / refill : 0);
    if (wait <= 0) events.push({ at: now, ...(operation ? { operation } : {}) });
    const row = { key, events, tokens: perIp ? Math.max(0, tokens - (wait <= 0 ? 1 : 0)) : 0, touchedAt: new Date(now), expiresAt: new Date(now + 900000) };
    await tx.insert(accessLimits).values(row).onConflictDoUpdate({ target: accessLimits.key, set: row });
    return Math.max(0, Math.ceil(wait / 1000));
  });
}
export async function cleanAccessLimits() { await db.delete(accessLimits).where(sql`${accessLimits.expiresAt} <= now()`); }
export function startAccessCleanup() {
  const tick = () => void cleanAccessLimits().catch(() => console.warn('{"event":"access_cleanup_unavailable","code":"UNAVAILABLE"}'));
  tick(); const timer = setInterval(tick, 300000); timer.unref(); return () => clearInterval(timer);
}
