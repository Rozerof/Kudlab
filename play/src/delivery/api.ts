import { z } from 'zod';
import { contextSchema, externalContextSchema, receiptSchema, secretSchema, startResponseSchema, uuid, uuidV4, type AnyContext, type Receipt } from '../contract/schema';
import { hash } from '../contract/canonical';
import { normalizeCode } from '../runtime/access-code';

const aulaGroupsSchema = z.object({ items: z.array(z.object({ id: uuid, name: z.string().max(200), grade: z.string().max(40) })).max(200) });
export const aulaSessionSchema = z.object({ ticket: z.string().max(400).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/), alias: z.string().max(20), participationAllowed: z.boolean(),
  games: z.array(z.object({ taskId: z.enum(['TG-01', 'TG-02', 'TG-03', 'TG-04']), title: z.string().max(120), attemptsLeft: z.number().int().min(0), canPlay: z.boolean() })).max(10) });
export type AulaGroup = z.infer<typeof aulaGroupsSchema>['items'][number];
export type AulaSession = z.infer<typeof aulaSessionSchema>;
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfterMs = 0, readonly reason?: string) { super(code); }
}
export class Api {
  private base: string;
  constructor(origin: string, private transport: typeof fetch = (input, init) => fetch(input, init)) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('INVALID_API_ORIGIN');
    this.base = `${origin}/api/v1/game-runtime`;
  }
  private async call(path: string, secret: string | undefined, body?: string): Promise<unknown> {
    if (secret !== undefined) secretSchema.parse(secret);
    let response: Response;
    try {
      response = await this.transport(`${this.base}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...(secret === undefined ? {} : { Authorization: `Bearer ${secret}` }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(8000), ...(body === undefined ? {} : { body }) });
    } catch { throw new ApiError(0, 'NETWORK_UNCERTAIN'); }
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const wait = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
      const error = await response.json().catch(() => null);
      const code = z.object({ code: z.string().regex(/^[A-Z_]{1,64}$/), reason: z.string().regex(/^[A-Z_]{1,64}$/).optional() }).safeParse(error);
      throw new ApiError(response.status, code.success ? code.data.code : 'HTTP_ERROR', Number.isFinite(wait) ? wait : 0, code.success ? code.data.reason : undefined);
    }
    let text: string;
    try { text = await response.text(); } catch { throw new ApiError(0, 'NETWORK_UNCERTAIN'); }
    if (text.length > 1048576) throw new ApiError(0, 'INVALID_RESPONSE');
    try { return JSON.parse(text); } catch { throw new ApiError(0, 'INVALID_RESPONSE'); }
  }
  private async verifiedContext(input: unknown): Promise<AnyContext> {
    const external = !!input && typeof input === 'object' && (input as { contractVersion?: unknown }).contractVersion === 'ext-1';
    const context: AnyContext = external ? externalContextSchema.parse(input) : contextSchema.parse(input);
    if (await hash(context.config) !== context.configurationHash) throw new ApiError(409, 'CONFIGURATION_HASH_MISMATCH');
    return context;
  }
  async claim(grant: string, claimId: string, runtimeSecret: string): Promise<AnyContext> {
    uuidV4.parse(claimId); secretSchema.parse(runtimeSecret);
    return this.verifiedContext(await this.call('/launches/claim', grant, JSON.stringify({ claimId, runtimeSecret })));
  }
  async access(code: string, claimId: string, runtimeSecret: string, recovery?: { sessionId: string; submissionId: string }): Promise<AnyContext> {
    uuidV4.parse(claimId); secretSchema.parse(runtimeSecret);
    if (recovery) { uuid.parse(recovery.sessionId); uuidV4.parse(recovery.submissionId); }
    return this.verifiedContext(await this.call(recovery ? '/access/recover' : '/access/claim', undefined, JSON.stringify({ code: normalizeCode(code), claimId, runtimeSecret, ...recovery })));
  }
  // Modo aula: curso con clase abierta → apodo + figura secreta → juegos activos → código de un juego.
  async aulaGroups() {
    return aulaGroupsSchema.parse(await this.call('/access/aula/groups', undefined)).items;
  }
  async aulaIdentify(groupId: string, alias: string, figure: number) {
    uuid.parse(groupId);
    return aulaSessionSchema.parse(await this.call('/access/aula/identify', undefined, JSON.stringify({ groupId, alias, figure })));
  }
  async aulaGames(ticket: string) {
    return aulaSessionSchema.omit({ ticket: true }).parse(await this.call('/access/aula/games', undefined, JSON.stringify({ ticket })));
  }
  async aulaClaim(ticket: string, taskId: string, claimId: string, runtimeSecret: string): Promise<AnyContext> {
    uuidV4.parse(claimId); secretSchema.parse(runtimeSecret);
    return this.verifiedContext(await this.call('/access/aula/claim', undefined, JSON.stringify({ ticket, taskId, claimId, runtimeSecret })));
  }
  async aulaCode(ticket: string, taskId: string) {
    return z.object({ code: z.string().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/) }).parse(await this.call('/access/aula/code', undefined, JSON.stringify({ ticket, taskId }))).code;
  }
  async context(sessionId: string, secret: string): Promise<AnyContext> {
    uuid.parse(sessionId);
    const c = await this.verifiedContext(await this.call(`/sessions/${sessionId}`, secret));
    if (c.sessionId !== sessionId) throw new ApiError(409, 'SESSION_MISMATCH');
    return c;
  }
  async start(sessionId: string, secret: string, startId: string) {
    uuid.parse(sessionId); uuidV4.parse(startId);
    const r = startResponseSchema.parse(await this.call(`/sessions/${sessionId}/start`, secret, JSON.stringify({ startId })));
    if (r.sessionId !== sessionId) throw new ApiError(409, 'SESSION_MISMATCH');
    return r;
  }
  async submit(sessionId: string, secret: string, body: string): Promise<Receipt> {
    uuid.parse(sessionId);
    const r = receiptSchema.safeParse(await this.call(`/sessions/${sessionId}/results`, secret, body));
    if (!r.success) throw new ApiError(0, 'INVALID_RECEIPT');
    return r.data;
  }
  async receipt(sessionId: string, secret: string, submissionId: string): Promise<Receipt | null> {
    uuid.parse(sessionId); uuidV4.parse(submissionId);
    const result = z.strictObject({ receipt: receiptSchema.nullable() }).safeParse(await this.call(`/sessions/${sessionId}/receipt?submissionId=${submissionId}`, secret));
    if (!result.success) throw new ApiError(0, 'INVALID_RECEIPT');
    return result.data.receipt;
  }
}
