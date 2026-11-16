import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { indicatorRules } from '../../../db/schema/game.js';
import { hash } from '../../tareas/runtime/contract.js';
import { RULE } from '../tg01.js';
import { INDICATOR_DEFINITIONS, EXTERNAL_INDICATOR_DEFINITIONS } from './definitions.js';
import { EXTERNAL_RULES, EXTERNAL_TASK_IDS } from '../external.js';
import type { IndicatorDefinitionDto, RuleRef } from './dto.js';

type RuleRow = { approvalStatus: 'PROPOSED' | 'APPROVED'; approvedAt: Date | null } | undefined;

// Une las definiciones con el estado metodológico vigente. Sin fila de regla publicada: `rule: null` («regla aún no publicada»).
// `approvalReference` no se expone.
export function buildIndicatorCatalog(row: RuleRow, external: Partial<Record<string, RuleRow>> = {}): IndicatorDefinitionDto[] {
  const ref = (r: RuleRow, code: string, version: number): RuleRef | null => r ? { code, version, approval: { current: r.approvalStatus, approvedAt: r.approvedAt?.toISOString() ?? null } } : null;
  // Si TG-01 ya está publicada con el juego TD (regla TG01-EXT-1), sus indicadores muestran esa regla.
  const rule = external['TG-01'] !== undefined ? ref(external['TG-01'], EXTERNAL_RULES['TG-01'].code, EXTERNAL_RULES['TG-01'].version) : ref(row, RULE.code, RULE.version);
  return [...INDICATOR_DEFINITIONS.map(d => ({ ...d, scopes: [...d.scopes], unavailabilityReasons: [...d.unavailabilityReasons], rule })),
    ...EXTERNAL_INDICATOR_DEFINITIONS.filter(d => external[d.taskId] !== undefined).map(d => {
      const r = EXTERNAL_RULES[d.taskId as keyof typeof EXTERNAL_RULES];
      return { ...d, scopes: [...d.scopes], unavailabilityReasons: [...d.unavailabilityReasons], rule: ref(external[d.taskId], r.code, r.version) };
    })];
}

export async function readIndicatorCatalog(executor: Pick<typeof db, 'select'> = db) {
  // Solo la fila cuya definición coincide con la regla que el código calcula (código, versión y hash).
  const [row] = await executor.select({ approvalStatus: indicatorRules.approvalStatus, approvedAt: indicatorRules.approvedAt }).from(indicatorRules)
    .where(and(eq(indicatorRules.taskId, 'TG-01'), eq(indicatorRules.code, RULE.code), eq(indicatorRules.version, RULE.version), eq(indicatorRules.definitionHash, hash(RULE))));
  const external: Partial<Record<string, RuleRow>> = {};
  for (const id of EXTERNAL_TASK_IDS) {
    const r = EXTERNAL_RULES[id];
    const [x] = await executor.select({ approvalStatus: indicatorRules.approvalStatus, approvedAt: indicatorRules.approvedAt }).from(indicatorRules)
      .where(and(eq(indicatorRules.taskId, id), eq(indicatorRules.code, r.code), eq(indicatorRules.version, r.version), eq(indicatorRules.definitionHash, hash(r))));
    external[id] = x;
  }
  return { items: buildIndicatorCatalog(row, external) };
}
