// Ejecuta los juegos TG-01 a TG-04 (repositorios TD-*) dentro de Kudlab Play y entrega su registro al backend
// con el contrato «ext-1». El juego corre en un marco del mismo origen, sin token: no habla con la API; Play
// recibe su registro por postMessage, lo guarda en este navegador y lo envía con la credencial de la sesión.
import { ApiError, type Api } from '../delivery/api';
import { EXTERNAL_GAMES, type ExternalContext } from '../contract/schema';

const PENDING = 'kudlab-ext-pending:';
type Pending = { sessionId: string; secret: string; body: string; savedAt: number };

export type ExternalResult = { delivered: boolean; state: 'completed' | 'interrupted' };

function save(p: Pending) { try { localStorage.setItem(PENDING + p.sessionId, JSON.stringify(p)); } catch { /* sin respaldo local */ } }
function drop(id: string) { try { localStorage.removeItem(PENDING + id); } catch { /* nada */ } }
export function pendingExternal(): Pending[] {
  const out: Pending[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PENDING)) out.push(JSON.parse(localStorage.getItem(k)!)); } } catch { /* nada */ }
  return out;
}
async function send(api: Api, p: Pending): Promise<boolean> {
  try { await api.submit(p.sessionId, p.secret, p.body); drop(p.sessionId); return true; }
  catch (e) {
    // 409 de una sesión ya entregada con el mismo envío no ocurre (el servidor responde 200); otros 4xx no se reintentan.
    if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) { drop(p.sessionId); }
    return false;
  }
}
export async function retryPendingExternal(api: Api): Promise<number> {
  let n = 0; for (const p of pendingExternal()) if (await send(api, p)) n++;
  return n;
}

export async function runExternal(api: Api, context: ExternalContext, secret: string, host: HTMLElement): Promise<ExternalResult> {
  const game = EXTERNAL_GAMES[context.taskId];
  const start = await api.start(context.sessionId, secret, crypto.randomUUID());
  if (start.sessionId !== context.sessionId) throw new Error('SESSION_MISMATCH');
  const startedAtMs = performance.now();
  const frame = document.createElement('iframe');
  frame.className = 'external-game'; frame.title = game.title; frame.allow = 'autoplay; fullscreen';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  const params = new URLSearchParams({ sessionId: context.sessionId, attempt: String(start.attemptNumber), targetOrigin: location.origin });
  frame.src = `/juegos/${game.slug}/index.html?${params}`;
  host.replaceChildren(frame);
  const payload = await new Promise<Record<string, unknown>>(resolve => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      const data = event.data as { type?: string; payload?: Record<string, unknown> } | null;
      if (!data || (data.type !== 'GAME_OVER' && data.type !== 'GAME_INTERRUPTED') || !data.payload) return;
      window.removeEventListener('message', onMessage); resolve(data.payload);
    };
    window.addEventListener('message', onMessage);
  });
  const finishedAtMs = Math.max(startedAtMs, performance.now());
  const completed = payload.state === 'completed';
  const events = Array.isArray(payload.events) ? payload.events.slice(0, 1000) : [];
  const envelope = {
    contractVersion: 'ext-1', sessionId: context.sessionId, submissionId: crypto.randomUUID(), taskId: context.taskId,
    publishedVersionId: context.publishedVersionId, configVersion: context.configVersion, configurationHash: context.configurationHash,
    gameBuildId: context.gameBuildId, state: completed ? 'completed' : 'interrupted', terminationReason: completed ? 'time_limit' : 'user_exit',
    clock: { id: crypto.randomUUID(), timeOriginUnixMs: performance.timeOrigin },
    timing: { startedAtMs, finishedAtMs, lastCheckpointAtMs: finishedAtMs },
    device: { viewportWidth: Math.max(1, Math.round(innerWidth)), viewportHeight: Math.max(1, Math.round(innerHeight)), stageScale: 1, touchCapable: navigator.maxTouchPoints > 0 },
    payload: { ...payload, taskId: context.taskId, events },
  };
  const pending: Pending = { sessionId: context.sessionId, secret, body: JSON.stringify(envelope), savedAt: Date.now() };
  save(pending);
  let delivered = false;
  for (let attempt = 0; attempt < 4 && !delivered; attempt++) {
    delivered = await send(api, pending);
    if (!delivered && pendingExternal().some(p => p.sessionId === pending.sessionId)) await new Promise(r => setTimeout(r, 1500 * 2 ** attempt));
    else break;
  }
  return { delivered, state: completed ? 'completed' : 'interrupted' };
}
