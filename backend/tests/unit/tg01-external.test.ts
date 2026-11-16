// Lluvia de estrellas del repositorio TD (contrato ext-1): el servidor recalcula con los eventos crudos del juego.
import { describe, expect, it } from 'vitest';
import { calculateExternal, EXTERNAL_RULES, knownRule } from '../../src/modules/evolucion/external.js';
import { RULE } from '../../src/modules/evolucion/tg01.js';

const ev = (trial: number, stimulus: 'star' | 'moon', result: string | null, segment: number, rtMs: number | null = null, extra: Record<string, unknown> = {}) =>
  ({ trial, stimulus, result, segment, rtMs, anticipatory: false, valid: true, lane: 1, presentedAtMs: trial * 1000, ...extra });
const value = (r: ReturnType<typeof calculateExternal>, metric: string, scope = 'SESSION') => r.indicators.find(i => i.metricCode === metric && i.scope === scope)!;

describe('TG-01 con el juego TD (regla TG01-EXT-1)', () => {
  const events = [
    ev(1, 'star', 'hit', 1, 500), ev(2, 'star', 'hit', 1, 600), ev(3, 'star', 'miss', 1), ev(4, 'moon', 'false_alarm', 1, 400), ev(5, 'moon', 'correct_rejection', 1),
    ev(6, 'star', 'hit', 2, 700), ev(7, 'star', 'hit', 2, 100, { anticipatory: true }), ev(8, 'star', 'hit', 2, 800), ev(9, 'moon', 'correct_rejection', 2),
    ev(10, 'star', 'hit', 3, 900, { valid: false, invalidReason: 'tab_hidden' }), ev(11, 'star', 'hit', 3, 650),
  ];
  it('calcula precisión, omisión, comisión y tiempos igual que el juego, por sesión y segmento', () => {
    const r = calculateExternal('TG-01', events, true, true);
    expect(value(r, 'accuracy_pct').value).toBeCloseTo(6 / 7 * 100);
    expect(value(r, 'omission_rate_pct').value).toBeCloseTo(1 / 7 * 100);
    expect(value(r, 'commission_rate_pct').value).toBeCloseTo(1 / 3 * 100);
    // TR: aciertos válidos y no anticipatorios (500, 600, 700, 800, 650).
    expect(value(r, 'median_reaction_time_ms').value).toBe(650);
    expect(value(r, 'rt_sd_ms').status).toBe('CALCULATED');
    expect(value(r, 'commission_rate_pct', 'SEGMENT_3')).toMatchObject({ status: 'NOT_AVAILABLE', unavailabilityReason: 'NO_VALID_DISTRACTORS' });
    expect(value(r, 'rt_sd_ms', 'SEGMENT_1')).toMatchObject({ unavailabilityReason: 'INSUFFICIENT_RT_FOR_VARIABILITY' });
    expect(r.decisions.find(d => d.trial === 10)).toMatchObject({ included: false, reason: 'TECHNICAL_EXCLUSION' });
  });
  it('sesión interrumpida: los segmentos no alcanzados no se calculan; sin aprobación, nada se calcula', () => {
    const r = calculateExternal('TG-01', events.filter(e => e.segment === 1), true, false);
    expect(value(r, 'accuracy_pct', 'SEGMENT_2')).toMatchObject({ unavailabilityReason: 'SEGMENT_NOT_REACHED' });
    expect(calculateExternal('TG-01', events, false).indicators.every(i => i.unavailabilityReason === 'METHOD_NOT_APPROVED')).toBe(true);
  });
  it('reconoce la regla nueva y conserva la anterior para la historia', () => {
    expect(knownRule('TG01-EXT-1')).toBe(EXTERNAL_RULES['TG-01']);
    expect(knownRule(RULE.code)).toBe(RULE);
    expect(knownRule('OTRA')).toBeNull();
  });
});
