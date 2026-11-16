// Modo aula (apodo + figura secreta, clase abierta, juegos por curso o por estudiante), panel de observación 0–5
// y estrella de prioridad de revisión. Los decodificadores validan la forma mínima que la interfaz usa.
import type { HttpClient } from '../../lib/http.ts';
import type { HttpResult } from '../usuarios/types.ts';

export const FIGURES = [['🐱', 'Gato'], ['🐶', 'Perro'], ['⭐', 'Estrella'], ['🌙', 'Luna'], ['🚀', 'Cohete'], ['🌈', 'Arcoíris'], ['🍎', 'Manzana'], ['⚽', 'Balón']] as const;
export type TaskId = 'TG-01' | 'TG-02' | 'TG-03' | 'TG-04';
export type AulaStudent = { id: string; displayName: string; studentCode: string; alias: string | null; figure: number | null; participationAllowed: boolean };
export type AulaGame = { taskId: TaskId; title: string; available: boolean; activation: { id: string; audience: 'GROUP' | 'STUDENTS'; studentIds: string[]; createdAt: string } | null };
export type Classroom = { groupId: string; window: { openedAt: string; closesAt: string } | null; students: AulaStudent[]; games: AulaGame[] };
export type PlayProfile = { studentId: string; alias: string; figure: number; updatedAt: string };
export type PriorityLevel = 'AL_DIA' | 'REVISAR' | 'PRIORIDAD' | 'INSUFICIENTE';
export type Priority = { studentId: string; level: PriorityLevel; message: string; changes: string[] };
export type BlockKey = 'A' | 'B' | 'C' | 'D' | 'E';
export type BlockSummary = { status: 'OK' | 'INSUFFICIENT'; average: number | null; answered: number };
export type Panel = { id: string; period: string; observedOn: string; area: 'LECTURA' | 'MATEMATICAS' | 'AMBAS'; responses: Record<string, number | null>; notes: Partial<Record<BlockKey, string>>; createdAt: string; blocks: Record<BlockKey, BlockSummary> };
export type PanelList = { items: Panel[]; periods: { period: string; observedOn: string; blocks: Record<BlockKey, BlockSummary> }[] };
export type PanelInput = { requestId: string; period: string; observedOn: string; area: Panel['area']; responses: Record<string, number | null>; notes: Partial<Record<BlockKey, string>> };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reason = (data: unknown) => isObject(data) && typeof data.reason === 'string' ? [{ field: 'reason' as const, reason: data.reason }] : [];
const classroom = (d: unknown) => isObject(d) && Array.isArray(d.students) && Array.isArray(d.games) ? d as Classroom : undefined;
const missing = () => Promise.resolve({ kind: 'error' as const, status: 404, code: 'NOT_FOUND' as const, uncertain: false });
export type AulaResult<T> = HttpResult<T, 'reason'>;
export const reasonOf = (r: AulaResult<unknown>) => r.kind === 'error' ? r.fields?.[0]?.reason : undefined;

export function createAulaApi(http: HttpClient) {
  const get = <T>(path: string, signal: AbortSignal, decode: (d: unknown) => T | undefined) =>
    http.request<T, 'reason'>(path, { signal, decodeFields: reason, decode: (d, s) => s === 200 ? decode(d) : undefined });
  const send = <T>(path: string, method: 'POST' | 'PUT', body: unknown, signal: AbortSignal, decode: (d: unknown) => T | undefined) =>
    http.request<T, 'reason'>(path, { method, body, signal, decodeFields: reason, decode: (d, s) => s === 200 || s === 201 ? decode(d) : undefined });
  return {
    classroom(groupId: string, signal: AbortSignal): Promise<AulaResult<Classroom>> { return uuid.test(groupId) ? get(`/api/v1/groups/${groupId}/aula`, signal, classroom) : missing(); },
    open(groupId: string, minutes: number, signal: AbortSignal) { return send(`/api/v1/groups/${groupId}/aula/open`, 'POST', { minutes }, signal, classroom); },
    close(groupId: string, signal: AbortSignal) { return send(`/api/v1/groups/${groupId}/aula/close`, 'POST', {}, signal, classroom); },
    activate(groupId: string, taskId: TaskId, audience: 'GROUP' | 'STUDENTS', studentIds: string[], signal: AbortSignal) {
      return send(`/api/v1/groups/${groupId}/aula/activations`, 'POST', { taskId, audience, studentIds }, signal, classroom);
    },
    deactivate(groupId: string, taskId: TaskId, signal: AbortSignal) { return send(`/api/v1/groups/${groupId}/aula/activations/${taskId}/end`, 'POST', {}, signal, classroom); },
    setProfile(studentId: string, alias: string, figure: number, signal: AbortSignal): Promise<AulaResult<PlayProfile>> {
      if (!uuid.test(studentId)) return missing();
      return send(`/api/v1/students/${studentId}/play-profile`, 'PUT', { alias, figure }, signal, d => isObject(d) && typeof d.alias === 'string' ? d as PlayProfile : undefined);
    },
    priority(groupId: string, signal: AbortSignal): Promise<AulaResult<{ items: Priority[]; notice: string }>> {
      if (!uuid.test(groupId)) return missing();
      return get(`/api/v1/groups/${groupId}/review-priority`, signal, d => isObject(d) && Array.isArray(d.items) ? d as { items: Priority[]; notice: string } : undefined);
    },
    panels(studentId: string, signal: AbortSignal): Promise<AulaResult<PanelList>> {
      if (!uuid.test(studentId)) return missing();
      return get(`/api/v1/students/${studentId}/observation-panels`, signal, d => isObject(d) && Array.isArray(d.items) && Array.isArray(d.periods) ? d as PanelList : undefined);
    },
    savePanel(studentId: string, input: PanelInput, signal: AbortSignal): Promise<AulaResult<Panel>> {
      if (!uuid.test(studentId)) return missing();
      return send(`/api/v1/students/${studentId}/observation-panels`, 'POST', input, signal, d => isObject(d) && typeof d.id === 'string' ? d as Panel : undefined);
    },
  };
}
export type AulaApi = ReturnType<typeof createAulaApi>;
export const normalizeAlias = (value: string) => [...value.trim().toUpperCase()]
  .map(ch => ch === 'Ñ' ? ch : ch.normalize('NFD').replace(/[̀-ͯ]/g, '')).join('').replace(/[^A-Z0-9Ñ]/g, '');
