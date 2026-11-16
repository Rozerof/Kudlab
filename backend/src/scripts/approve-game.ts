// Aprueba la regla de indicadores de TG-01 (juego TD), TG-02, TG-03 o TG-04 con una referencia explícita de la decisión del responsable.
// Uso: npm run game:approve -- --task=TG-02 --reference=KUDLAB-TG02-APPROVAL-AAAAMMDD-01
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { indicatorRules } from '../db/schema/game.js';
import { EXTERNAL_RULES, isExternalTask } from '../modules/evolucion/external.js';
import { hash } from '../modules/tareas/runtime/contract.js';
import { publishExternal } from '../modules/tareas/catalog/publish.js';
try {
  const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const task = arg('task'), reference = arg('reference');
  if (!task || !isExternalTask(task)) throw new Error('Usa --task=TG-01, --task=TG-02, --task=TG-03 o --task=TG-04');
  if (!reference || !/^KUDLAB-TG0[1-4]-APPROVAL-\d{8}-\d{2}$/.test(reference) || !reference.includes(task.replace('-', ''))) throw new Error('Referencia requerida: --reference=KUDLAB-TG0X-APPROVAL-AAAAMMDD-NN');
  const rule = EXTERNAL_RULES[task];
  await db.transaction(async tx => {
    await publishExternal(task, tx);
    const [stored] = await tx.select().from(indicatorRules).where(and(eq(indicatorRules.taskId, task), eq(indicatorRules.code, rule.code), eq(indicatorRules.version, rule.version))).for('update');
    if (!stored || stored.definitionHash !== hash(rule)) throw new Error('APPROVAL_DEFINITION_CONFLICT');
    if (stored.approvalStatus !== 'APPROVED') await tx.update(indicatorRules).set({ approvalStatus: 'APPROVED', approvedAt: new Date(), approvalReference: reference }).where(eq(indicatorRules.id, stored.id));
  });
  console.log(JSON.stringify({ task, rule: rule.code, approvalReference: reference }));
} finally { await pool.end(); }
