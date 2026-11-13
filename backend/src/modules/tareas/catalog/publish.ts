import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { tasks, taskPublishedVersions } from '../../../db/schema/tasks.js';
import { gameConfigurations, indicatorRules } from '../../../db/schema/game.js';
import { hash, PROFILE } from '../runtime/contract.js';
import { RULE } from '../../evolucion/tg01.js';
import { EXTERNAL_BUILDS, EXTERNAL_CONTRACT, EXTERNAL_PROFILES, EXTERNAL_RULES, type ExternalTaskId } from '../../evolucion/external.js';
import type { AcademicTransaction } from '../../academico/shared/academic-auth.js';

// Publication never enables the task or approves methodology/participation.
export async function publishTg01(transaction?: AcademicTransaction) {
  const publish = async (tx: AcademicTransaction) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('publish-tg01', 0))`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, 'TG-01')).for('update');
    if (!task) throw new Error('TG01_CATALOG_REQUIRED');
    const [existing] = await tx.select().from(gameConfigurations).where(eq(gameConfigurations.gameBuildId, 'tg01-viewport-rebuild-2'));
    if (existing) {
      const [version] = await tx.select().from(taskPublishedVersions).where(eq(taskPublishedVersions.id, existing.publishedVersionId));
      const [rule] = await tx.select().from(indicatorRules).where(eq(indicatorRules.id, existing.ruleVersionId));
      if (existing.configurationHash !== hash(PROFILE) || hash(existing.configuration) !== existing.configurationHash || existing.contractVersion !== '1.1' || version?.taskId !== 'TG-01') throw new Error('PUBLISHED_CONFIGURATION_CONFLICT');
      if (!rule || rule.taskId !== 'TG-01' || rule.code !== RULE.code || rule.version !== RULE.version || rule.definitionHash !== hash(RULE) || hash(rule.definition) !== rule.definitionHash) throw new Error('RULE_VERSION_CONFLICT');
      return existing.publishedVersionId;
    }
    const [rule] = await tx.insert(indicatorRules).values({ taskId: 'TG-01', code: RULE.code, version: RULE.version,
      definition: RULE, definitionHash: hash(RULE), approvalStatus: 'PROPOSED' }).onConflictDoNothing().returning();
    const [storedRule] = rule ? [rule] : await tx.select().from(indicatorRules).where(and(eq(indicatorRules.taskId, 'TG-01'), eq(indicatorRules.code, RULE.code), eq(indicatorRules.version, RULE.version)));
    if (!storedRule || storedRule.definitionHash !== hash(RULE) || hash(storedRule.definition) !== storedRule.definitionHash) throw new Error('RULE_VERSION_CONFLICT');
    const [max] = await tx.select({ n: sql<number>`coalesce(max(${taskPublishedVersions.version}), 0)::int` }).from(taskPublishedVersions).where(eq(taskPublishedVersions.taskId, 'TG-01'));
    const [version] = await tx.insert(taskPublishedVersions).values({ taskId: 'TG-01', version: max!.n + 1 }).returning();
    await tx.insert(gameConfigurations).values({ publishedVersionId: version!.id, contractVersion: '1.1', gameBuildId: 'tg01-viewport-rebuild-2',
      configuration: PROFILE, configurationHash: hash(PROFILE), ruleVersionId: storedRule.id });
    return version!.id;
  };
  return transaction ? publish(transaction) : db.transaction(publish);
}

// Publica la configuración de un juego externo (TG-02 a TG-04). Igual que TG-01: no habilita la tarea ni aprueba la regla.
export async function publishExternal(taskId: ExternalTaskId, transaction?: AcademicTransaction) {
  const RULE_X = EXTERNAL_RULES[taskId], PROFILE_X = EXTERNAL_PROFILES[taskId], BUILD = EXTERNAL_BUILDS[taskId];
  const publish = async (tx: AcademicTransaction) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'publish-' + taskId}, 0))`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for('update');
    if (!task) throw new Error('CATALOG_REQUIRED');
    const [existing] = await tx.select().from(gameConfigurations).where(eq(gameConfigurations.gameBuildId, BUILD));
    if (existing) {
      if (existing.configurationHash !== hash(PROFILE_X) || existing.contractVersion !== EXTERNAL_CONTRACT) throw new Error('PUBLISHED_CONFIGURATION_CONFLICT');
      return existing.publishedVersionId;
    }
    const [rule] = await tx.insert(indicatorRules).values({ taskId, code: RULE_X.code, version: RULE_X.version,
      definition: RULE_X, definitionHash: hash(RULE_X), approvalStatus: 'PROPOSED' }).onConflictDoNothing().returning();
    const [storedRule] = rule ? [rule] : await tx.select().from(indicatorRules).where(and(eq(indicatorRules.taskId, taskId), eq(indicatorRules.code, RULE_X.code), eq(indicatorRules.version, RULE_X.version)));
    if (!storedRule || storedRule.definitionHash !== hash(RULE_X)) throw new Error('RULE_VERSION_CONFLICT');
    const [max] = await tx.select({ n: sql<number>`coalesce(max(${taskPublishedVersions.version}), 0)::int` }).from(taskPublishedVersions).where(eq(taskPublishedVersions.taskId, taskId));
    const [version] = await tx.insert(taskPublishedVersions).values({ taskId, version: max!.n + 1 }).returning();
    await tx.insert(gameConfigurations).values({ publishedVersionId: version!.id, contractVersion: EXTERNAL_CONTRACT, gameBuildId: BUILD,
      configuration: PROFILE_X as never, configurationHash: hash(PROFILE_X), ruleVersionId: storedRule.id });
    return version!.id;
  };
  return transaction ? publish(transaction) : db.transaction(publish);
}
