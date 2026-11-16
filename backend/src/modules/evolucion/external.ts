// Reglas de cálculo de las tareas TG-01 a TG-04 cuando se juegan con los juegos de los repositorios TD-* (contrato ext-1).
// TG-01 también conserva su implementación anterior dentro de Kudlab Play (contrato 1.1, regla de tg01.ts) para leer la historia.
// El servidor recalcula los indicadores a partir de los eventos crudos que envía el juego, con las mismas
// fórmulas que el juego documenta en computeIndicators (Fundamento teórico 5.6, 5.7 y 5.8). Nunca confía
// en el resumen calculado por el cliente.
import { z } from 'zod';
import { RULE as TG01_LEGACY_RULE, type Indicator } from './tg01.js';

export const EXTERNAL_TASK_IDS = ['TG-01', 'TG-02', 'TG-03', 'TG-04'] as const;
export type ExternalTaskId = (typeof EXTERNAL_TASK_IDS)[number];
export const EXTERNAL_CONTRACT = 'ext-1';
export const EXTERNAL_BUILDS: Record<ExternalTaskId, string> = {
  'TG-01': 'td-lluvia-estrellas-1', 'TG-02': 'td-palabra-intrusa-1', 'TG-03': 'td-mentalista-1', 'TG-04': 'td-kud-dice-1',
};
export const isExternalTask = (id: string): id is ExternalTaskId => (EXTERNAL_TASK_IDS as readonly string[]).includes(id);

export const EXTERNAL_RULES = {
  'TG-01': { code: 'TG01-EXT-1', version: 1, source: 'Fundamento teórico 5.5 (Go/No-Go)', segmentMs: 40000, minRtForVariability: 5, rtPopulation: 'VALID_HITS_NOT_ANTICIPATORY', varianceDivisor: 'n' },
  'TG-02': { code: 'TG02-DESCRIPTIVE-1', version: 1, source: 'Fundamento teórico 5.6.1–5.6.4', minRt: 5, rtPopulation: 'CORRECT_NOT_ANTICIPATORY', varianceDivisor: 'n' },
  'TG-03': { code: 'TG03-DESCRIPTIVE-1', version: 1, source: 'Fundamento teórico 5.7', minRt: 5, minValidForDelta: 3, rtPopulation: 'CORRECT_NOT_ANTICIPATORY', varianceDivisor: 'n' },
  'TG-04': { code: 'TG04-DESCRIPTIVE-1', version: 1, source: 'Fundamento teórico 5.7 y 5.8', minRt: 5, varianceDivisor: 'n' },
} as const;

// Configuración publicada: describe la versión del juego que el catálogo autoriza. El juego trae su propia
// configuración en el código; aquí se fija qué juego, qué contrato y qué regla se aceptan.
export const EXTERNAL_PROFILES: Record<ExternalTaskId, Record<string, unknown>> = {
  'TG-01': { taskId: 'TG-01', title: 'Lluvia de estrellas', repository: 'AlexanderNino97/TD-LLUVIA-DE-ESTRELLAS', gameConfigVersion: 2, measuredItems: 78 },
  'TG-02': { taskId: 'TG-02', title: 'Palabra intrusa', repository: 'AlexanderNino97/TD-PALABRA-INTRUSA', gameConfigVersion: 1, measuredItems: 18 },
  'TG-03': { taskId: 'TG-03', title: 'Mentalista', repository: 'AlexanderNino97/TD-MENTALISTA', gameConfigVersion: 1, measuredItems: 12 },
  'TG-04': { taskId: 'TG-04', title: 'Kud Dice', repository: 'AlexanderNino97/TD-KUD-DICE', gameConfigVersion: 2, measuredItems: 10 },
};

const num = z.number().finite();
const nnum = num.nullable().optional();
// Eventos tal como los producen los juegos. Se valida lo que el cálculo necesita; el resto se conserva.
const choiceEvent = z.looseObject({ valid: z.boolean(), result: z.enum(['correct', 'incorrect', 'omission']).nullable().optional(),
  anticipatory: z.boolean().optional(), rtMs: nnum, level: z.number().int().optional(), load: z.number().int().optional(), segment: z.number().int().optional() });
const sequenceEvent = z.looseObject({ valid: z.boolean(), outcome: z.string(), length: z.number().int().positive(),
  positionsCorrect: z.number().int().nonnegative(), orderErrors: z.number().int().nonnegative(), firstTapLatencyMs: nnum });
const goNoGoEvent = z.looseObject({ valid: z.boolean(), stimulus: z.enum(['star', 'moon']), result: z.enum(['hit', 'miss', 'false_alarm', 'correct_rejection']).nullable().optional(),
  anticipatory: z.boolean().optional(), rtMs: nnum, segment: z.number().int().min(1).max(3).nullable().optional() });
export const EXTERNAL_EVENT_SCHEMAS = { 'TG-01': goNoGoEvent, 'TG-02': choiceEvent, 'TG-03': choiceEvent, 'TG-04': sequenceEvent } as const;

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

type Unit = '%' | 'ms' | 'items' | 'pts';
type ExtIndicator = Omit<Indicator, 'unit'> & { unit: Unit };
function put(list: ExtIndicator[], allowed: boolean, metricCode: string, value: number | null, unit: Unit, numerator: number | null, denominator: number | null, sampleSize: number, missing: string | null) {
  const reason = !allowed ? 'METHOD_NOT_APPROVED' : value === null || !Number.isFinite(value) ? (missing ?? 'NO_VALID_TRIALS') : missing;
  list.push({ metricCode, scope: 'SESSION', status: reason ? 'NOT_AVAILABLE' : 'CALCULATED', value: reason ? null : value, unit, numerator, denominator, sampleSize, unavailabilityReason: reason });
}

function choice(events: z.infer<typeof choiceEvent>[], allowed: boolean, minRt: number, out: ExtIndicator[]) {
  const valid = events.filter(e => e.valid && e.result);
  const n = (r: string) => valid.filter(e => e.result === r).length;
  const rts = valid.filter(e => e.result === 'correct' && !e.anticipatory && typeof e.rtMs === 'number').map(e => e.rtMs as number);
  const none = valid.length ? null : 'NO_VALID_TRIALS';
  put(out, allowed, 'precision_pct', valid.length ? n('correct') / valid.length * 100 : null, '%', n('correct'), valid.length, valid.length, none);
  put(out, allowed, 'error_rate_pct', valid.length ? n('incorrect') / valid.length * 100 : null, '%', n('incorrect'), valid.length, valid.length, none);
  put(out, allowed, 'omission_rate_pct', valid.length ? n('omission') / valid.length * 100 : null, '%', n('omission'), valid.length, valid.length, none);
  const rtMissing = rts.length === 0 ? 'NO_VALID_RT' : rts.length < minRt ? 'INSUFFICIENT_RT' : null;
  put(out, allowed, 'median_reaction_time_ms', rts.length ? median(rts) : null, 'ms', null, null, rts.length, rtMissing);
  const m = rts.length ? mean(rts) : 0;
  put(out, allowed, 'rt_cv_pct', rts.length && m > 0 ? sd(rts) / m * 100 : null, '%', null, null, rts.length, rtMissing ?? (m === 0 ? 'ZERO_MEAN_RT' : null));
  return valid;
}

// Definición de regla conocida por código (incluye la regla anterior de TG-01) para verificar la huella guardada.
export function knownRule(code: string): unknown {
  if (code === TG01_LEGACY_RULE.code) return TG01_LEGACY_RULE;
  return Object.values(EXTERNAL_RULES).find(r => r.code === code) ?? null;
}

// Lluvia de estrellas (Go/No-Go): mismos indicadores que la versión anterior, por sesión y por segmento de 40 s.
function goNoGo(events: z.infer<typeof goNoGoEvent>[], allowed: boolean, completed: boolean, out: ExtIndicator[]) {
  const minRt = EXTERNAL_RULES['TG-01'].minRtForVariability;
  for (const [index, scope] of ['SESSION', 'SEGMENT_1', 'SEGMENT_2', 'SEGMENT_3'].entries()) {
    const observed = events.filter(e => e.result && (index === 0 || e.segment === index));
    const reached = index === 0 || completed || events.some(e => (e.segment ?? 0) >= index);
    const valid = observed.filter(e => e.valid);
    const n = (r: string) => valid.filter(e => e.result === r).length;
    const targets = n('hit') + n('miss'), distractors = n('false_alarm') + n('correct_rejection');
    const technical = (stimulus: 'star' | 'moon') => observed.some(e => e.stimulus === stimulus) && observed.filter(e => e.stimulus === stimulus).every(e => !e.valid);
    const rts = valid.filter(e => e.result === 'hit' && !e.anticipatory && typeof e.rtMs === 'number').map(e => e.rtMs as number);
    const why = (missing: string | null, stimulus: 'star' | 'moon') => !reached ? 'SEGMENT_NOT_REACHED' : technical(stimulus) ? 'TECHNICAL_EXCLUSION' : missing;
    const add = (code: string, value: number | null, unit: Unit, num: number | null, den: number | null, size: number, missing: string | null) => {
      put(out, allowed, code, value, unit, num, den, size, missing);
      out[out.length - 1]!.scope = scope;
    };
    add('accuracy_pct', targets ? n('hit') / targets * 100 : null, '%', n('hit'), targets, targets, why(targets ? null : 'NO_VALID_TARGETS', 'star'));
    add('omission_rate_pct', targets ? n('miss') / targets * 100 : null, '%', n('miss'), targets, targets, why(targets ? null : 'NO_VALID_TARGETS', 'star'));
    add('commission_rate_pct', distractors ? n('false_alarm') / distractors * 100 : null, '%', n('false_alarm'), distractors, distractors, why(distractors ? null : 'NO_VALID_DISTRACTORS', 'moon'));
    const rtMissing = why(rts.length ? null : 'NO_VALID_RT', 'star');
    add('median_reaction_time_ms', rts.length ? median(rts) : null, 'ms', null, null, rts.length, rtMissing);
    const variability = rtMissing ?? (rts.length < minRt ? 'INSUFFICIENT_RT_FOR_VARIABILITY' : null);
    const m = rts.length ? mean(rts) : 0;
    add('rt_sd_ms', rts.length ? sd(rts) : null, 'ms', null, null, rts.length, variability);
    add('rt_cv_pct', rts.length && m > 0 ? sd(rts) / m * 100 : null, '%', null, null, rts.length, variability ?? (m === 0 ? 'ZERO_MEAN_RT' : null));
  }
}

export function calculateExternal(taskId: ExternalTaskId, rawEvents: unknown[], allowed: boolean, completed = true) {
  const rule = EXTERNAL_RULES[taskId];
  const out: ExtIndicator[] = [];
  const decisions: { trial: number; included: boolean; reason: string | null }[] = [];
  if (taskId === 'TG-01') {
    const events = rawEvents.map(e => goNoGoEvent.parse(e));
    events.forEach((e, i) => decisions.push({ trial: i + 1, included: e.valid && !!e.result, reason: !e.result ? 'NOT_EVALUATED' : e.valid ? null : 'TECHNICAL_EXCLUSION' }));
    goNoGo(events, allowed, completed, out);
  } else if (taskId === 'TG-04') {
    const events = rawEvents.map(e => sequenceEvent.parse(e));
    events.forEach((e, i) => decisions.push({ trial: i + 1, included: e.valid, reason: e.valid ? null : 'INVALID_TRIAL' }));
    const valid = events.filter(e => e.valid), correct = valid.filter(e => e.outcome === 'correct');
    const positions = valid.reduce((s, e) => s + e.length, 0);
    const none = valid.length ? null : 'NO_VALID_TRIALS';
    put(out, allowed, 'precision_pct', valid.length ? correct.length / valid.length * 100 : null, '%', correct.length, valid.length, valid.length, none);
    put(out, allowed, 'position_accuracy_pct', positions ? valid.reduce((s, e) => s + e.positionsCorrect, 0) / positions * 100 : null, '%', valid.reduce((s, e) => s + e.positionsCorrect, 0), positions, valid.length, none);
    put(out, allowed, 'longest_correct_length', correct.length ? Math.max(...correct.map(e => e.length)) : null, 'items', null, null, valid.length, correct.length ? null : 'NO_CORRECT_TRIALS');
    put(out, allowed, 'order_error_rate_pct', positions ? valid.reduce((s, e) => s + e.orderErrors, 0) / positions * 100 : null, '%', valid.reduce((s, e) => s + e.orderErrors, 0), positions, valid.length, none);
    const lat = valid.map(e => e.firstTapLatencyMs).filter((x): x is number => typeof x === 'number');
    put(out, allowed, 'median_reaction_time_ms', lat.length ? median(lat) : null, 'ms', null, null, lat.length, lat.length === 0 ? 'NO_VALID_RT' : lat.length < EXTERNAL_RULES['TG-04'].minRt ? 'INSUFFICIENT_RT' : null);
  } else {
    const events = rawEvents.map(e => choiceEvent.parse(e));
    events.forEach((e, i) => decisions.push({ trial: i + 1, included: e.valid && !!e.result, reason: e.valid && e.result ? null : 'INVALID_TRIAL' }));
    choice(events, allowed, EXTERNAL_RULES[taskId].minRt, out);
    if (taskId === 'TG-03') {
      const loads = [...new Set(events.map(e => e.load).filter((l): l is number => typeof l === 'number'))].sort((a, b) => a - b);
      const block = (l: number) => events.filter(e => e.load === l && e.valid && e.result);
      const lo = loads.length ? block(loads[0]!) : [], hi = loads.length ? block(loads[loads.length - 1]!) : [];
      const minDelta = EXTERNAL_RULES['TG-03'].minValidForDelta;
      const ok = loads.length > 1 && lo.length >= minDelta && hi.length >= minDelta;
      const prec = (b: typeof lo) => b.filter(e => e.result === 'correct').length / b.length * 100;
      put(out, allowed, 'load_precision_change_pts', ok ? prec(hi) - prec(lo) : null, 'pts', null, null, lo.length + hi.length, ok ? null : 'INSUFFICIENT_LOAD_DATA');
    }
  }
  return { indicators: out, decisions, summary: { observed: rawEvents.length, included: decisions.filter(d => d.included).length, excluded: decisions.filter(d => !d.included).length } };
}
