import { and, eq, sql, asc, desc, inArray, isNotNull, lt } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { students, groups } from '../../../db/schema/academic.js';
import { userAccounts } from '../../../db/schema/accounts.js';
import { user } from '../../../db/schema/auth.js';
import { tasks, taskPublishedVersions } from '../../../db/schema/tasks.js';
import { assignments, recipients, operationReceipts, gameSessions, runtimeCapabilities, launchGrants, resultReceipts, rawEvents, sessionIncidents, gameConfigurations, indicatorRules, calculationRuns, calculatedIndicators, externalResults } from '../../../db/schema/game.js';
import { withAcademicAccess, type AcademicActor, type AcademicTransaction as Tx } from '../../academico/shared/academic-auth.js';
import { participationProvider, requireParticipation, syntheticEnabled, type GameDependencies } from '../../academico/shared/participation.js';
import { hasActiveIdentity } from '../../usuarios/shared/accounts.types.js';
import { notFound } from '../../academico/shared/academic.errors.js';
import { knownRule } from '../../evolucion/external.js';
import { compatible, envelopeSchema, externalEnvelopeSchema, hash, secretDigest, uuid, uuidV4, secret, type Envelope } from './contract.js';
import { GameError, conflict } from './errors.js';
import { cursorFor, cursorPosition, decryptGrant, encryptGrant, runtimeSettings } from './security.js';
import { requestInput, createInput } from './dto.js';
import { accessCodes, accessClaims } from '../../../db/schema/access.js';
import { accessDigest, accessSettings, codeInput, newCode, openCode, sealCode } from './access-security.js';
import { accessLimit } from './access-limit.js';
import { consentRecords, consentEvents } from '../../../db/schema/consents.js';
import { studentPlayProfiles, classroomWindows, gameActivations } from '../../../db/schema/aula.js';
import { aliasInput, figureInput, normalizeAlias, signTicket, readTicket, ticketInput } from './aula-security.js';

type SessionRow = typeof gameSessions.$inferSelect;
type Capability = typeof runtimeCapabilities.$inferSelect;
function resourceId(id: string) { if (!uuid.safeParse(id).success) throw notFound(); }

export function createGameService(deps: GameDependencies = {}) {
  const participation = participationProvider(deps);
  async function requireStartedAuthorization(tx: Tx, s: SessionRow) {
    if (!s.startedAtServer || !s.attemptNumber || !s.startRequestId || !s.participationAuthorizationRef) throw new GameError(403, 'PARTICIPATION_BLOCKED');
    const reference = s.participationAuthorizationRef;
    if (reference.startsWith('SYNTHETIC-')) {
      if (syntheticEnabled(deps) && (deps.testParticipation && reference === `SYNTHETIC-J02:${s.studentId}` ||
        deps.localSynthetic && reference === `SYNTHETIC-LOCAL:${s.studentId}`)) return;
      throw new GameError(403, 'PARTICIPATION_BLOCKED');
    }
    const id = reference.slice('CONSENT:'.length);
    if (!reference.startsWith('CONSENT:') || !uuid.safeParse(id).success) throw new GameError(403, 'PARTICIPATION_BLOCKED');
    const [record] = await tx.select({ id: consentRecords.id }).from(consentRecords)
      .innerJoin(consentEvents, and(eq(consentEvents.recordId, consentRecords.id), eq(consentEvents.studentId, consentRecords.studentId), inArray(consentEvents.type, ['REGISTER', 'REPLACE'])))
      .where(and(eq(consentRecords.id, id), eq(consentRecords.studentId, s.studentId))).limit(1);
    if (!record) throw new GameError(403, 'PARTICIPATION_BLOCKED');
  }
  async function codeParticipation(tx: Tx, c: typeof accessCodes.$inferSelect, studentId: string, now: Date) {
    if (c.scope === 'PLAY_AND_SUBMIT') { await requireParticipation(participation, tx, studentId, now); return; }
    const [s] = await tx.select().from(gameSessions).where(eq(gameSessions.id, c.sessionId!));
    if (!s || s.studentId !== studentId || s.recipientId !== c.recipientId) throw new GameError(403, 'PARTICIPATION_BLOCKED');
    await requireStartedAuthorization(tx, s);
  }
  const methodAllowed = (rule: typeof indicatorRules.$inferSelect) => hash(rule.definition) === rule.definitionHash &&
    hash(rule.definition) === hash(knownRule(rule.code)) && (rule.approvalStatus === 'APPROVED' || syntheticEnabled(deps));
  async function ownGroup(tx: Tx, actor: AcademicActor, id: string) {
    resourceId(id);
    const [group] = await tx.select().from(groups).where(and(eq(groups.id, id), eq(groups.teacherId, actor.accountId))).for('share');
    if (!group) throw notFound();
    return group;
  }
  async function ownAssignment(tx: Tx, actor: AcademicActor, id: string) {
    resourceId(id);
    const [a] = await tx.select({ a: assignments }).from(assignments).innerJoin(groups, eq(groups.id, assignments.groupId))
      .where(and(eq(assignments.id, id), eq(groups.teacherId, actor.accountId)));
    if (!a) throw notFound();
    await ownGroup(tx, actor, a.a.groupId);
    return a.a;
  }
  async function ownStudent(tx: Tx, actor: AcademicActor, id: string) {
    resourceId(id);
    const [s] = await tx.select().from(students).where(eq(students.id, id));
    if (!s) throw notFound();
    await ownGroup(tx, actor, s.groupId);
    return s;
  }
  async function ownSession(tx: Tx, actor: AcademicActor, id: string) {
    resourceId(id);
    const [s] = await tx.select().from(gameSessions).where(eq(gameSessions.id, id));
    if (!s) throw notFound();
    const a = await ownAssignment(tx, actor, (await recipient(tx, s.recipientId)).assignmentId);
    await ownStudent(tx, actor, s.studentId);
    return { s, a };
  }
  async function recipient(tx: Tx, id: string) {
    resourceId(id);
    const [r] = await tx.select().from(recipients).where(eq(recipients.id, id));
    if (!r) throw notFound();
    return r;
  }
  async function lockStudent(tx: Tx, id: string) { await tx.select().from(students).where(eq(students.id, id)).for('update'); }
  async function expire(tx: Tx, studentId: string, now = new Date()) {
    await tx.update(gameSessions).set({ executionStatus: 'EXPIRED' }).where(and(eq(gameSessions.studentId, studentId), eq(gameSessions.executionStatus, 'READY'), lt(gameSessions.startAllowedUntil, now)));
    await tx.update(gameSessions).set({ executionStatus: 'UNCONFIRMED' }).where(and(eq(gameSessions.studentId, studentId), eq(gameSessions.executionStatus, 'RUNNING'), sql`${gameSessions.startedAtServer} + interval '32 minutes' <= ${now}`));
  }
  async function configuration(tx: Tx, id: string) {
    const [c] = await tx.select({ config: gameConfigurations, version: taskPublishedVersions, task: tasks, rule: indicatorRules }).from(gameConfigurations)
      .innerJoin(taskPublishedVersions, eq(taskPublishedVersions.id, gameConfigurations.publishedVersionId))
      .innerJoin(tasks, eq(tasks.id, taskPublishedVersions.taskId)).innerJoin(indicatorRules, eq(indicatorRules.id, gameConfigurations.ruleVersionId))
      .where(eq(gameConfigurations.publishedVersionId, id)).for('share');
    if (!c || c.rule.taskId !== c.task.id || !compatible(c.config.contractVersion, c.config.gameBuildId, c.config.configuration) || hash(c.config.configuration) !== c.config.configurationHash)
      throw conflict('CONFIGURATION_UNSUPPORTED');
    return c;
  }
  async function ready(tx: Tx, a: typeof assignments.$inferSelect, now: Date, future = false) {
    const [current] = await tx.select().from(assignments).where(eq(assignments.id, a.id)).for('share');
    if (!current) throw notFound();
    a = current;
    if (a.status !== 'OPEN') throw conflict('ASSIGNMENT_CANCELLED');
    if ((!future && now < a.startsAt) || now >= a.endsAt) throw conflict('OUTSIDE_WINDOW');
    const c = await configuration(tx, a.publishedVersionId);
    // Administrative availability gates creation, not previously assigned work.
    if (!methodAllowed(c.rule)) throw conflict('TASK_UNAVAILABLE');
    return c;
  }
  async function operation(tx: Tx, actor: AcademicActor, input: { requestId: string }, name: string, target: string, payload: unknown, run: () => Promise<string | { id: string; ids: string[]; createdCount: number }>) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actor.accountId + ':' + input.requestId}, 0))`);
    const fingerprint = hash({ operation: name, target, payload });
    const [old] = await tx.select().from(operationReceipts).where(and(eq(operationReceipts.actorId, actor.accountId), eq(operationReceipts.requestId, input.requestId)));
    if (old) { if (old.requestHash !== fingerprint) throw conflict('REQUEST_CONFLICT'); return { ...old.references, repeated: true }; }
    const result = await run();
    const references: { id: string; ids?: string[]; createdCount?: number } = typeof result === 'string' ? { id: result } : result;
    await tx.insert(operationReceipts).values({ actorId: actor.accountId, requestId: input.requestId, operation: name, requestHash: fingerprint, references });
    return { ...references, repeated: false };
  }
  async function assignmentSummary(tx: Tx, a: typeof assignments.$inferSelect, recipientCount: number, now = new Date()) {
    const [version] = await tx.select().from(taskPublishedVersions).where(eq(taskPublishedVersions.id, a.publishedVersionId));
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, a.taskId));
    return { id: a.id, taskId: a.taskId, title: task!.title, publishedVersionId: a.publishedVersionId, configVersion: version!.version, groupId: a.groupId,
      startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), maxAttempts: a.maxAttempts, status: a.status,
      availability: a.status === 'CANCELLED' ? 'CANCELLED' : now < a.startsAt ? 'FUTURE' : now >= a.endsAt ? 'EXPIRED' : 'CURRENT', recipientCount, createdAt: a.createdAt.toISOString() };
  }
  async function assignmentDetail(tx: Tx, a: typeof assignments.$inferSelect) {
    const rows = await tx.select({ r: recipients, s: students }).from(recipients).innerJoin(students, eq(students.id, recipients.studentId)).where(eq(recipients.assignmentId, a.id)).orderBy(asc(recipients.id));
    const now = new Date();
    const detail = [];
    for (const { r, s } of rows) {
      const sessions = await tx.select().from(gameSessions).where(eq(gameSessions.studentId, s.id));
      const active = sessions.find(v => v.taskId === a.taskId && (v.executionStatus === 'READY' && v.startAllowedUntil > now || v.executionStatus === 'RUNNING' && v.startedAtServer!.getTime() + 1920000 > now.getTime()));
      const attemptsStarted = sessions.filter(v => v.recipientId === r.id && v.attemptNumber !== null).length;
      const reasons: string[] = [];
      try { await ready(tx, a, now); } catch (error) { reasons.push(error instanceof GameError ? error.reason ?? 'TASK_UNAVAILABLE' : 'TASK_UNAVAILABLE'); }
      if (s.groupId !== a.groupId) reasons.push('PARTICIPATION_BLOCKED');
      try { await requireParticipation(participation, tx, s.id, now); } catch (error) {
        if (!(error instanceof GameError) || error.status === 503) throw error;
        reasons.push('PARTICIPATION_BLOCKED');
      }
      if (attemptsStarted >= a.maxAttempts) reasons.push('ATTEMPT_LIMIT');
      if (active?.executionStatus === 'RUNNING' || active?.executionStatus === 'READY' && active.launchMode === 'CODE') reasons.push('ACTIVE_SESSION');
      detail.push({ id: r.id, studentId: s.id, studentDisplayName: `${s.firstName} ${s.lastName}`, studentCode: s.studentCode,
        attemptsStarted, activeSessionId: active?.id ?? null, canLaunch: reasons.length === 0, unavailableReasons: [...new Set(reasons)] });
    }
    return { ...await assignmentSummary(tx, a, rows.length, now), recipients: detail };
  }
  // Entrega de los juegos externos (TG-02 a TG-04): mismas reglas de sesión, capacidad, versión e idempotencia que TG-01.
  async function submitExternal(id: string, token: string, payload: unknown) {
    const e = externalEnvelopeSchema.parse(payload);
    return authenticated(id, token, async (tx, s, cap) => {
      const fingerprint = hash(e);
      if (e.sessionId !== id) throw new GameError(409, 'VERSION_UNSUPPORTED');
      if (cap.submissionId && cap.submissionId !== e.submissionId) throw new GameError(409, 'RESULT_CONFLICT');
      const [old] = await tx.select().from(resultReceipts).where(eq(resultReceipts.sessionId, id));
      if (old) {
        if (old.submissionId !== e.submissionId) throw new GameError(409, 'SESSION_ALREADY_SUBMITTED');
        if (old.evidenceHash !== fingerprint) throw new GameError(409, 'RESULT_CONFLICT');
        return { repeated: true, receipt: receiptDto(old) };
      }
      if (!s.startedAtServer || !s.attemptNumber) throw new GameError(409, 'SESSION_NOT_STARTED');
      if (!cap.canSubmit) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
      await requireStartedAuthorization(tx, s);
      const { c } = await sessionConfig(tx, s);
      if (e.publishedVersionId !== c.version.id || e.configVersion !== c.version.version || e.contractVersion !== c.config.contractVersion || e.gameBuildId !== c.config.gameBuildId || e.configurationHash !== c.config.configurationHash || e.taskId !== s.taskId) throw new GameError(409, 'VERSION_UNSUPPORTED');
      const [global] = await tx.select().from(resultReceipts).where(eq(resultReceipts.submissionId, e.submissionId));
      if (global) throw new GameError(409, 'RESULT_CONFLICT');
      const [receipt] = await tx.insert(resultReceipts).values({ sessionId: id, submissionId: e.submissionId, contractVersion: e.contractVersion, evidenceHash: fingerprint,
        producerState: e.state, terminationReason: e.terminationReason, clockId: e.clock.id, timeOriginUnixMs: e.clock.timeOriginUnixMs, ...e.timing, device: e.device }).returning();
      await tx.insert(externalResults).values({ sessionId: id, taskId: e.taskId, payload: e.payload, eventCount: e.payload.events.length });
      await tx.insert(calculationRuns).values({ sessionId: id, ruleVersionId: c.rule.id, runNumber: 1, evidenceHash: fingerprint });
      await tx.update(gameSessions).set({ executionStatus: e.state === 'completed' ? 'COMPLETED' : 'INTERRUPTED', processingStatus: 'PENDING', closedReceivedAt: receipt!.receivedAt }).where(eq(gameSessions.id, id));
      return { repeated: false, receipt: receiptDto(receipt!) };
    });
  }
  const receiptDto = (r: typeof resultReceipts.$inferSelect) => ({ receiptId: r.id, sessionId: r.sessionId, submissionId: r.submissionId, receivedAt: r.receivedAt.toISOString(), evidenceHash: r.evidenceHash, processingStatusAtReceipt: 'PENDING' as const });
  async function sessionConfig(tx: Tx, s: SessionRow) {
    const r = await recipient(tx, s.recipientId);
    const [a] = await tx.select().from(assignments).where(eq(assignments.id, r.assignmentId));
    return { a: a!, r, c: await configuration(tx, a!.publishedVersionId) };
  }
  async function sessionSummary(tx: Tx, s: SessionRow) {
    const { a, c } = await sessionConfig(tx, s);
    const [raw] = await tx.select({ n: sql<number>`count(*)::int` }).from(rawEvents).where(eq(rawEvents.sessionId, s.id));
    const [ext] = await tx.select({ n: externalResults.eventCount }).from(externalResults).where(eq(externalResults.sessionId, s.id));
    const counts = { n: raw!.n + (ext?.n ?? 0) };
    const [incidents] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessionIncidents).where(eq(sessionIncidents.sessionId, s.id));
    const now = Date.now();
    const executionStatus = s.executionStatus === 'READY' && s.startAllowedUntil.getTime() <= now ? 'EXPIRED' : s.executionStatus === 'RUNNING' && s.startedAtServer!.getTime() + 1920000 <= now ? 'UNCONFIRMED' : s.executionStatus;
    return { id: s.id, studentId: s.studentId, taskId: s.taskId, assignmentId: a.id, attemptNumber: s.attemptNumber, launchMode: s.launchMode,
      configVersion: c.version.version, gameBuildId: c.config.gameBuildId, executionStatus, processingStatus: s.processingStatus,
      preparedAt: s.preparedAt.toISOString(), startedAtServer: s.startedAtServer?.toISOString() ?? null, receivedAt: s.closedReceivedAt?.toISOString() ?? null,
      incidentCount: incidents!.n, recordedTrialCount: counts!.n };
  }
  async function currentIssuer(tx: Tx, accountId: string, groupId: string) {
    const [g] = await tx.select().from(groups).where(eq(groups.id, groupId)).for('share');
    const [account] = await tx.select().from(userAccounts).where(eq(userAccounts.id, accountId)).for('share');
    const [identity] = account?.authUserId ? await tx.select().from(user).where(eq(user.id, account.authUserId)).for('share', { noWait: true }) : [];
    if (!g || g.teacherId !== accountId || !account || account.role !== 'TEACHER' || !hasActiveIdentity(account, identity) || identity?.email.toLowerCase() !== account.emailNormalized)
      throw new GameError(403, 'PARTICIPATION_BLOCKED');
  }
  async function context(tx: Tx, s: SessionRow, cap: Capability) {
    const { c } = await sessionConfig(tx, s), now = new Date();
    return { sessionId: s.id, taskId: s.taskId, publishedVersionId: c.version.id, configVersion: c.version.version,
      configurationHash: c.config.configurationHash, gameBuildId: c.config.gameBuildId, contractVersion: c.config.contractVersion, config: c.config.configuration,
      executionStatus: s.executionStatus, attemptNumber: s.attemptNumber, startAllowedUntil: cap.startAllowedUntil.toISOString(),
      uploadAllowedUntil: s.startedAtServer ? cap.expiresAt.toISOString() : null, serverTime: now.toISOString(),
      capabilities: { canStart: cap.canStart && s.executionStatus === 'READY' && cap.startAllowedUntil > now,
        canSubmit: cap.canSubmit && s.attemptNumber !== null, canReadReceipt: cap.canReadReceipt } };
  }
  async function authenticated<T>(sessionId: string, token: string, work: (tx: Tx, s: SessionRow, cap: Capability) => Promise<T>, receiptOnly = false) {
    resourceId(sessionId); const digest = secretDigest(token);
    return db.transaction(async tx => {
      const [initial] = await tx.select().from(runtimeCapabilities).where(eq(runtimeCapabilities.secretDigest, digest));
      if (!initial || initial.revokedAt || !receiptOnly && initial.expiresAt <= new Date()) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
      if (initial.sessionId !== sessionId) throw notFound();
      const [before] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId));
      const { a } = await sessionConfig(tx, before!);
      await tx.select().from(groups).where(eq(groups.id, a.groupId)).for('share');
      await lockStudent(tx, before!.studentId); if (!receiptOnly) await expire(tx, before!.studentId);
      const [s] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).for('update');
      const [cap] = await tx.select().from(runtimeCapabilities).where(eq(runtimeCapabilities.id, initial.id)).for('update');
      if (!cap || cap.revokedAt || !receiptOnly && cap.expiresAt <= new Date()) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
      return work(tx, s!, cap);
    });
  }
  type Code = typeof accessCodes.$inferSelect;
  const accessUnavailable = () => new GameError(403, 'ACCESS_UNAVAILABLE');
  const aad = (c: Pick<Code, 'id' | 'recipientId' | 'scope'>) => `${c.id}:${c.scope}:${c.recipientId}`;
  const usableCode = (c: Code, now = new Date()) => c.status === 'ACTIVE' && c.expiresAt > now;
  async function sourceAllowed(tx: Tx, s: SessionRow, cap: Capability) {
    const { a } = await sessionConfig(tx, s);
    if (s.launchMode === 'CODE') {
      const [c] = await tx.select().from(accessCodes).where(eq(accessCodes.id, cap.sourceAccessCodeId ?? s.sourceAccessCodeId!)).for('share');
      if (!c || !usableCode(c) || c.recipientId !== s.recipientId || c.scope !== 'PLAY_AND_SUBMIT') throw accessUnavailable();
      await currentIssuer(tx, c.issuedBy, a.groupId);
    } else {
      const [g] = await tx.select().from(launchGrants).where(eq(launchGrants.boundCapabilityId, cap.id));
      if (!g) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
      await currentIssuer(tx, g.issuedBy, a.groupId);
    }
  }
  async function prepare(tx: Tx, r: typeof recipients.$inferSelect, a: typeof assignments.$inferSelect, now: Date, validUntil: Date | null, code?: Code) {
    const configured = await ready(tx, a, now);
    const existing = await tx.select().from(gameSessions).where(and(eq(gameSessions.studentId, r.studentId), eq(gameSessions.taskId, a.taskId), inArray(gameSessions.executionStatus, ['READY', 'RUNNING'])));
    if (existing[0]?.executionStatus === 'RUNNING' || existing[0] && (code || existing[0].launchMode === 'CODE' || existing[0].recipientId !== r.id)) throw conflict('ACTIVE_SESSION');
    if (!existing[0] && !['1.1', 'ext-1'].includes(configured.config.contractVersion)) throw conflict('CONFIGURATION_UNSUPPORTED');
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(gameSessions).where(and(eq(gameSessions.recipientId, r.id), sql`${gameSessions.attemptNumber} is not null`));
    if (count!.n >= a.maxAttempts) throw conflict('ATTEMPT_LIMIT');
    const until = new Date(Math.min((existing[0]?.preparedAt ?? now).getTime() + 900000, a.endsAt.getTime(), validUntil?.getTime() ?? Infinity, code?.expiresAt.getTime() ?? Infinity));
    if (existing[0]) {
      const s = existing[0];
      await tx.update(runtimeCapabilities).set({ revokedAt: now }).where(eq(runtimeCapabilities.sessionId, s.id));
      await tx.update(launchGrants).set({ invalidatedAt: now }).where(eq(launchGrants.sessionId, s.id));
      return (await tx.update(gameSessions).set({ startAllowedUntil: until }).where(eq(gameSessions.id, s.id)).returning())[0]!;
    }
    return (await tx.insert(gameSessions).values({ recipientId: r.id, studentId: r.studentId, taskId: a.taskId, startAllowedUntil: until,
      launchMode: code ? 'CODE' : 'SUPERVISED', sourceAccessCodeId: code?.id ?? null }).returning())[0]!;
  }
  async function ownCode(tx: Tx, actor: AcademicActor, id: string) {
    resourceId(id); const [c] = await tx.select().from(accessCodes).where(eq(accessCodes.id, id)); if (!c) throw notFound();
    const r = await recipient(tx, c.recipientId), a = await ownAssignment(tx, actor, r.assignmentId);
    const s = await ownStudent(tx, actor, r.studentId); if (s.groupId !== a.groupId) throw notFound();
    return { c, r, a };
  }
  async function codeMetadata(tx: Tx, c: Code) {
    const now = new Date(), status = c.status === 'ACTIVE' && c.expiresAt <= now ? 'EXPIRED' : c.status;
    const r = await recipient(tx, c.recipientId), [a] = await tx.select().from(assignments).where(eq(assignments.id, r.assignmentId));
    const reasons: string[] = [];
    if (status !== 'ACTIVE') reasons.push('CODE_UNAVAILABLE');
    const [student] = await tx.select().from(students).where(eq(students.id, r.studentId));
    if (!student || student.groupId !== a!.groupId) reasons.push('PARTICIPATION_BLOCKED');
    try { await codeParticipation(tx, c, r.studentId, now); } catch (error) {
      if (!(error instanceof GameError) || error.status === 503) throw error;
      reasons.push('PARTICIPATION_BLOCKED');
    }
    if (c.scope === 'PLAY_AND_SUBMIT') try { await ready(tx, a!, now, true); } catch { reasons.push('TASK_UNAVAILABLE'); }
    return { id: c.id, recipientId: c.recipientId, scope: c.scope, sessionId: c.sessionId, status, createdAt: c.createdAt.toISOString(), expiresAt: c.expiresAt.toISOString(), lastClaimedAt: c.lastClaimedAt?.toISOString() ?? null, canReveal: !reasons.length, unavailableReasons: reasons };
  }
  async function issueCode(tx: Tx, actor: AcademicActor, r: typeof recipients.$inferSelect, a: typeof assignments.$inferSelect, sessionId: string | null, reuse = true) {
    const now = new Date(), scope = sessionId ? 'SUBMIT_ONLY' as const : 'PLAY_AND_SUBMIT' as const;
    const [student] = await tx.select().from(students).where(eq(students.id, r.studentId));
    if (!student || student.groupId !== a.groupId) throw conflict('PARTICIPATION_BLOCKED');
    if (sessionId) {
      const [s] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId));
      if (!s || s.studentId !== r.studentId || s.recipientId !== r.id) throw notFound();
      await requireStartedAuthorization(tx, s);
    } else await requireParticipation(participation, tx, r.studentId, now);
    if (!sessionId) {
      await ready(tx, a, now, true);
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(gameSessions).where(and(eq(gameSessions.recipientId, r.id), sql`${gameSessions.attemptNumber} is not null`));
      if (count!.n >= a.maxAttempts) throw conflict('ATTEMPT_LIMIT');
    }
    await tx.update(accessCodes).set({ status: 'EXPIRED' }).where(and(eq(accessCodes.recipientId, r.id), eq(accessCodes.status, 'ACTIVE'), sql`${accessCodes.expiresAt} <= ${now}`));
    const [active] = await tx.select().from(accessCodes).where(and(eq(accessCodes.recipientId, r.id), eq(accessCodes.scope, scope), eq(accessCodes.status, 'ACTIVE'), sessionId ? eq(accessCodes.sessionId, sessionId) : undefined));
    if (active && reuse) return { ...active, newlyIssued: false };
    const id = randomUUID(), expiresAt = new Date(Math.min(now.getTime() + (sessionId ? 86400000 : 604800000), sessionId ? Infinity : a.endsAt.getTime()));
    for (let n = 0; n < 32; n++) {
      const code = newCode(), lookupDigest = accessDigest(code), sealed = sealCode(code, aad({ id, recipientId: r.id, scope }));
      const [inserted] = await tx.insert(accessCodes).values({ id, recipientId: r.id, scope, sessionId, lookupDigest, secretCiphertext: sealed.ciphertext, encryptionKeyId: sealed.keyId, issuedBy: actor.accountId, createdAt: now, expiresAt }).onConflictDoNothing().returning();
      if (inserted) return { ...inserted, newlyIssued: true };
    }
    throw new GameError(503, 'UNAVAILABLE');
  }
  async function invalidateCode(tx: Tx, id: string, status: 'REVOKED' | 'REPLACED') {
    const now = new Date();
    await tx.update(accessCodes).set({ status, revokedAt: now }).where(and(eq(accessCodes.id, id), eq(accessCodes.status, 'ACTIVE')));
    const prepared = await tx.select({ id: gameSessions.id }).from(gameSessions).where(and(eq(gameSessions.sourceAccessCodeId, id), eq(gameSessions.executionStatus, 'READY')));
    for (const s of prepared) {
      await tx.update(runtimeCapabilities).set({ revokedAt: now }).where(eq(runtimeCapabilities.sessionId, s.id));
      await tx.update(gameSessions).set({ executionStatus: 'EXPIRED' }).where(eq(gameSessions.id, s.id));
    }
  }
  // ---- Modo aula: apodo + figura secreta, clase abierta y juegos activos por curso o por estudiante ----
  const AULA_TASKS = ['TG-01', 'TG-02', 'TG-03', 'TG-04'] as const;
  type Activation = typeof gameActivations.$inferSelect;
  async function openWindow(tx: Tx, groupId: string, now = new Date()) {
    const [w] = await tx.select().from(classroomWindows).where(eq(classroomWindows.groupId, groupId));
    return w && w.openedAt <= now && w.closesAt > now ? w : null;
  }
  // Versión publicada más reciente que tenga una configuración utilizable (las versiones sin configuración se saltan).
  async function latestConfiguration(tx: Tx, taskId: string) {
    const versions = await tx.select().from(taskPublishedVersions).where(eq(taskPublishedVersions.taskId, taskId)).orderBy(desc(taskPublishedVersions.version)).limit(20);
    for (const v of versions) {
      try {
        const c = await configuration(tx, v.id);
        if (c.task.isEnabled && methodAllowed(c.rule) && ['1.1', 'ext-1'].includes(c.config.contractVersion)) return c;
      } catch (error) { if (!(error instanceof GameError)) throw error; }
    }
    return null;
  }
  async function activeActivations(tx: Tx, groupId: string) {
    return tx.select({ v: gameActivations, a: assignments, title: tasks.title }).from(gameActivations)
      .innerJoin(assignments, eq(assignments.id, gameActivations.assignmentId)).innerJoin(tasks, eq(tasks.id, gameActivations.taskId))
      .where(and(eq(gameActivations.groupId, groupId), sql`${gameActivations.endedAt} is null`)).orderBy(asc(gameActivations.taskId));
  }
  const visibleTo = (v: Activation, studentId: string) => v.audience === 'GROUP' || v.studentIds.includes(studentId);
  async function endActivation(tx: Tx, v: Activation, by: string, now = new Date()) {
    await tx.update(gameActivations).set({ endedAt: now }).where(and(eq(gameActivations.id, v.id), sql`${gameActivations.endedAt} is null`));
    await tx.update(assignments).set({ status: 'CANCELLED', cancelledAt: now, cancelledBy: by }).where(and(eq(assignments.id, v.assignmentId), eq(assignments.status, 'OPEN')));
  }
  async function studentGames(tx: Tx, studentId: string, groupId: string) {
    const now = new Date(), games = [];
    let allowed = true;
    try { await requireParticipation(participation, tx, studentId, now); } catch (error) { if (!(error instanceof GameError) || error.status === 503) throw error; allowed = false; }
    for (const { v, a, title } of await activeActivations(tx, groupId)) {
      if (!visibleTo(v, studentId) || a.status !== 'OPEN' || now >= a.endsAt) continue;
      const [r] = await tx.select().from(recipients).where(and(eq(recipients.assignmentId, a.id), eq(recipients.studentId, studentId)));
      const [used] = r ? await tx.select({ n: sql<number>`count(*)::int` }).from(gameSessions).where(and(eq(gameSessions.recipientId, r.id), isNotNull(gameSessions.attemptNumber))) : [{ n: 0 }];
      games.push({ taskId: v.taskId, title, attemptsLeft: Math.max(0, a.maxAttempts - used!.n), canPlay: allowed && used!.n < a.maxAttempts });
    }
    return { participationAllowed: allowed, games };
  }
  async function aulaStudent(tx: Tx, ticket: string) {
    const t = readTicket(ticket);
    const [s] = await tx.select().from(students).where(eq(students.id, t.studentId));
    if (!s || !s.isActive || s.groupId !== t.groupId) throw accessUnavailable();
    const [g] = await tx.select().from(groups).where(eq(groups.id, s.groupId)).for('share');
    if (!g) throw accessUnavailable();
    if (!await openWindow(tx, g.id)) throw new GameError(403, 'ACCESS_UNAVAILABLE', 'CLASS_CLOSED');
    const [p] = await tx.select().from(studentPlayProfiles).where(eq(studentPlayProfiles.studentId, s.id));
    if (!p || p.groupId !== g.id || p.updatedAt.getTime() !== t.profileVersion) throw accessUnavailable();
    return { s, g, p };
  }
  async function aulaOverview(tx: Tx, groupId: string) {
    const window = await openWindow(tx, groupId);
    const rows = await tx.select({ s: students, p: studentPlayProfiles }).from(students).leftJoin(studentPlayProfiles, eq(studentPlayProfiles.studentId, students.id))
      .where(and(eq(students.groupId, groupId), eq(students.isActive, true))).orderBy(asc(students.lastName), asc(students.firstName));
    const now = new Date(), list = [];
    for (const { s, p } of rows) {
      let canPlay = true;
      try { await requireParticipation(participation, tx, s.id, now); } catch (error) { if (!(error instanceof GameError) || error.status === 503) throw error; canPlay = false; }
      list.push({ id: s.id, displayName: `${s.firstName} ${s.lastName}`, studentCode: s.studentCode, alias: p?.groupId === groupId ? p.alias : null, figure: p?.groupId === groupId ? p.figure : null, participationAllowed: canPlay });
    }
    const active = await activeActivations(tx, groupId), games = [];
    for (const taskId of AULA_TASKS) {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      if (!task) continue;
      const current = active.find(x => x.v.taskId === taskId);
      games.push({ taskId, title: task.title, available: !!await latestConfiguration(tx, taskId),
        activation: current ? { id: current.v.id, audience: current.v.audience, studentIds: current.v.studentIds, createdAt: current.v.createdAt.toISOString(),
          maxAttempts: current.a.maxAttempts, endsAt: current.a.endsAt.toISOString(), expired: current.a.endsAt <= new Date() } : null });
    }
    return { groupId, window: window ? { openedAt: window.openedAt.toISOString(), closesAt: window.closesAt.toISOString() } : null, students: list, games };
  }
  return {
    async generateCodes(actor: AcademicActor, id: string, payload: unknown) {
      accessSettings();
      const input = requestInput.extend({ recipientIds: z.array(uuid).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }).parse(payload);
      return withAcademicAccess(actor, async tx => {
        const a = await ownAssignment(tx, actor, id);
        const op = await operation(tx, actor, input, 'ACCESS_BATCH', id, { recipientIds: [...input.recipientIds].sort() }, async () => {
          const rows = [];
          for (const rid of input.recipientIds) { const r = await recipient(tx, rid); if (r.assignmentId !== a.id) throw notFound(); await ownStudent(tx, actor, r.studentId); rows.push(r); }
          const ids = []; let createdCount = 0;
          for (const r of rows.sort((x, y) => x.studentId.localeCompare(y.studentId))) { await lockStudent(tx, r.studentId); const c = await issueCode(tx, actor, r, a, null); ids.push(c.id); if (c.newlyIssued) createdCount++; }
          return { id: ids[0]!, ids, createdCount };
        });
        const codes = await tx.select().from(accessCodes).where(inArray(accessCodes.id, op.ids ?? [op.id])).orderBy(asc(accessCodes.id));
        const items = []; for (const c of codes) { await ownCode(tx, actor, c.id); items.push(await codeMetadata(tx, c)); }
        const createdCount = op.createdCount!;
        return { repeated: op.repeated, detail: { items, createdCount, reusedCount: items.length - createdCount } };
      });
    },
    async listCodes(actor: AcademicActor, id: string, paging: Paging) {
      accessSettings(); return withAcademicAccess(actor, async tx => {
        await ownAssignment(tx, actor, id); const filter = `codes:${id}`, position = datePosition(paging.cursor, filter);
        const rows = await tx.select({ c: accessCodes }).from(accessCodes).innerJoin(recipients, eq(recipients.id, accessCodes.recipientId)).where(and(eq(recipients.assignmentId, id), position ? sql`(${accessCodes.createdAt}, ${accessCodes.id}) < (${position.at}::timestamptz, ${position.id}::uuid)` : undefined)).orderBy(desc(accessCodes.createdAt), desc(accessCodes.id)).limit(paging.limit + 1);
        const page = rows.slice(0, paging.limit), items = []; for (const { c } of page) items.push(await codeMetadata(tx, c));
        const last = page.at(-1)?.c;
        return { items, nextCursor: rows.length > paging.limit ? cursorFor(filter, { at: last!.createdAt.toISOString(), id: last!.id }) : null };
      });
    },
    async revealCode(actor: AcademicActor, id: string, payload: unknown) {
      accessSettings(); z.strictObject({}).parse(payload);
      return withAcademicAccess(actor, async tx => {
        const { c: before } = await ownCode(tx, actor, id);
        const [c] = await tx.select().from(accessCodes).where(eq(accessCodes.id, before.id)).for('share');
        if (!(await codeMetadata(tx, c!)).canReveal) throw conflict('CODE_UNAVAILABLE');
        return { codeId: c!.id, code: openCode(c!.secretCiphertext, c!.encryptionKeyId, aad(c!)), expiresAt: c!.expiresAt.toISOString(), scope: c!.scope };
      });
    },
    async mutateCode(actor: AcademicActor, id: string, payload: unknown, replace: boolean) {
      accessSettings(); const input = requestInput.parse(payload);
      return withAcademicAccess(actor, async tx => {
        const { r, a } = await ownCode(tx, actor, id);
        const op = await operation(tx, actor, input, replace ? 'ACCESS_REPLACE' : 'ACCESS_REVOKE', id, {}, async () => {
          await lockStudent(tx, r.studentId);
          const [c] = await tx.select().from(accessCodes).where(eq(accessCodes.id, id)).for('update');
          if (replace && !usableCode(c!)) throw conflict('CODE_UNAVAILABLE');
          await invalidateCode(tx, id, replace ? 'REPLACED' : 'REVOKED');
          if (!replace) return id;
          const next = await issueCode(tx, actor, r, a, c!.sessionId, false);
          await tx.update(accessCodes).set({ replacedById: next.id }).where(eq(accessCodes.id, id)); return next.id;
        });
        const { c } = await ownCode(tx, actor, op.id); return { repeated: op.repeated, detail: await codeMetadata(tx, c) };
      });
    },
    async recoveryCode(actor: AcademicActor, id: string, payload: unknown) {
      accessSettings(); const input = requestInput.extend({ reconcileReceipt: z.boolean().optional() }).parse(payload);
      return withAcademicAccess(actor, async tx => {
        const { s, a } = await ownSession(tx, actor, id), r = await recipient(tx, s.recipientId);
        const op = await operation(tx, actor, input, 'ACCESS_RECOVERY', id, { reconcileReceipt: input.reconcileReceipt ?? false }, async () => {
          await lockStudent(tx, s.studentId);
          if (s.attemptNumber === null) throw conflict('SESSION_NOT_STARTED');
          const [receipt] = await tx.select().from(resultReceipts).where(eq(resultReceipts.sessionId, id));
          if (receipt && !input.reconcileReceipt) throw conflict('RESULTS_RECEIVED');
          return (await issueCode(tx, actor, r, a, id)).id;
        });
        const { c } = await ownCode(tx, actor, op.id); return { repeated: op.repeated, detail: await codeMetadata(tx, c) };
      });
    },
    async accessClaim(payload: unknown, recovery = false) {
      accessSettings();
      const base = z.strictObject({ code: codeInput, claimId: uuidV4, runtimeSecret: secret });
      const input: z.infer<typeof base> & { sessionId?: string; submissionId?: string } = recovery ? base.extend({ sessionId: uuid, submissionId: uuidV4 }).parse(payload) : base.parse(payload);
      const digest = accessDigest(input.code), fingerprint = secretDigest(input.runtimeSecret);
      const [previous] = await db.select({ claim: accessClaims, cap: runtimeCapabilities, code: accessCodes }).from(accessClaims).innerJoin(runtimeCapabilities, eq(runtimeCapabilities.id, accessClaims.capabilityId)).innerJoin(accessCodes, eq(accessCodes.id, accessClaims.codeId)).where(eq(accessClaims.claimId, input.claimId));
      if (!previous || previous.cap.secretDigest !== fingerprint || previous.code.lookupDigest !== digest) {
        const wait = await accessLimit(input.code, 'code', Date.now(), hash({ claimId: input.claimId, fingerprint, recovery, sessionId: input.sessionId ?? null, submissionId: input.submissionId ?? null }));
        if (wait) throw new GameError(429, 'RATE_LIMITED', undefined, wait);
      }
      try { return await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.claimId}, 0))`);
        const [initial] = await tx.select().from(accessCodes).where(eq(accessCodes.lookupDigest, digest)); if (!initial) throw accessUnavailable();
        const r = await recipient(tx, initial.recipientId), [a] = await tx.select().from(assignments).where(eq(assignments.id, r.assignmentId));
        await tx.select().from(groups).where(eq(groups.id, a!.groupId)).for('share');
        await lockStudent(tx, r.studentId); await expire(tx, r.studentId);
        const [c] = await tx.select().from(accessCodes).where(eq(accessCodes.id, initial.id)).for('update');
        const now = new Date(); if (!usableCode(c!)) throw accessUnavailable();
        await currentIssuer(tx, c!.issuedBy, a!.groupId);
        const [student] = await tx.select().from(students).where(eq(students.id, r.studentId)); if (student!.groupId !== a!.groupId) throw accessUnavailable();
        const [old] = await tx.select().from(accessClaims).where(eq(accessClaims.claimId, input.claimId));
        if (old) {
          const [cap] = await tx.select().from(runtimeCapabilities).where(eq(runtimeCapabilities.id, old.capabilityId));
          if (old.codeId !== c!.id || cap!.secretDigest !== fingerprint || old.submissionId !== (input.submissionId ?? null) || recovery && old.sessionId !== input.sessionId || cap!.revokedAt || cap!.expiresAt <= now) throw accessUnavailable();
          const [s] = await tx.select().from(gameSessions).where(eq(gameSessions.id, old.sessionId));
          if (recovery || s!.executionStatus !== 'READY') {
            await requireStartedAuthorization(tx, s!);
            if (c!.scope === 'SUBMIT_ONLY' && c!.sessionId !== s!.id) throw accessUnavailable();
            if (recovery && c!.scope === 'PLAY_AND_SUBMIT') await ready(tx, a!, now);
          } else { await requireParticipation(participation, tx, r.studentId, now); await ready(tx, a!, now); if (s!.startAllowedUntil <= now) throw accessUnavailable(); }
          return context(tx, s!, cap!);
        }
        let s: SessionRow;
        if (recovery) {
          const [row] = await tx.select().from(gameSessions).where(eq(gameSessions.id, input.sessionId!)).for('update');
          if (!row || row.recipientId !== r.id || row.attemptNumber === null || c!.scope === 'SUBMIT_ONLY' && c!.sessionId !== row.id) throw accessUnavailable();
          await requireStartedAuthorization(tx, row);
          if (c!.scope === 'PLAY_AND_SUBMIT') await ready(tx, a!, now);
          const [receipt] = await tx.select().from(resultReceipts).where(eq(resultReceipts.sessionId, row.id));
          if (receipt && receipt.submissionId !== input.submissionId) throw accessUnavailable();
          s = row;
        } else {
          if (c!.scope !== 'PLAY_AND_SUBMIT') throw accessUnavailable();
          const eligibility = await requireParticipation(participation, tx, r.studentId, now);
          s = await prepare(tx, r, a!, now, eligibility.validUntil, c!);
        }
        const [cap] = await tx.insert(runtimeCapabilities).values({ sessionId: s.id, claimId: input.claimId, secretDigest: fingerprint, sourceAccessCodeId: c!.id,
          canStart: !recovery, canSubmit: recovery, canReadReceipt: true, startAllowedUntil: s.startAllowedUntil,
          expiresAt: recovery ? new Date(Math.min(now.getTime() + 86400000, c!.expiresAt.getTime())) : s.startAllowedUntil, submissionId: input.submissionId ?? null }).returning();
        await tx.insert(accessClaims).values({ claimId: input.claimId, codeId: c!.id, capabilityId: cap!.id, sessionId: s.id, submissionId: input.submissionId ?? null });
        await tx.update(accessCodes).set({ lastClaimedAt: now }).where(eq(accessCodes.id, c!.id));
        return context(tx, s, cap!);
      }); } catch (error) {
        if (error instanceof GameError && (error.status === 503 || error.status === 429)) throw error;
        if (error instanceof GameError || error && typeof error === 'object' && 'status' in error || (error as { cause?: { code?: string } })?.cause?.code === '23505') throw accessUnavailable();
        throw error;
      }
    },
    // Docente: apodo (único por curso) y figura secreta del estudiante.
    async setPlayProfile(actor: AcademicActor, studentId: string, payload: unknown) {
      const input = z.strictObject({ alias: aliasInput, figure: figureInput }).parse(payload);
      return withAcademicAccess(actor, async tx => {
        const s = await ownStudent(tx, actor, studentId);
        const [taken] = await tx.select().from(studentPlayProfiles).where(and(eq(studentPlayProfiles.groupId, s.groupId), eq(studentPlayProfiles.alias, input.alias)));
        if (taken && taken.studentId !== s.id) throw conflict('ALIAS_TAKEN');
        const row = { studentId: s.id, groupId: s.groupId, alias: input.alias, figure: input.figure, updatedBy: actor.accountId, updatedAt: new Date() };
        await tx.insert(studentPlayProfiles).values(row).onConflictDoUpdate({ target: studentPlayProfiles.studentId, set: row });
        return { studentId: s.id, alias: input.alias, figure: input.figure, updatedAt: row.updatedAt.toISOString() };
      });
    },
    // Propone apodo (a partir del seudónimo, sin repetir en el curso) y figura a quienes aún no tienen; la docente puede editarlos.
    async autoProfiles(actor: AcademicActor, groupId: string, payload: unknown) {
      z.strictObject({}).parse(payload);
      return withAcademicAccess(actor, async tx => {
        await ownGroup(tx, actor, groupId);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'aula-profiles:' + groupId}, 0))`);
        const rows = await tx.select({ s: students, p: studentPlayProfiles }).from(students).leftJoin(studentPlayProfiles, eq(studentPlayProfiles.studentId, students.id))
          .where(and(eq(students.groupId, groupId), eq(students.isActive, true))).orderBy(asc(students.lastName), asc(students.firstName));
        const taken = new Set((await tx.select({ alias: studentPlayProfiles.alias }).from(studentPlayProfiles).where(eq(studentPlayProfiles.groupId, groupId))).map(r => r.alias));
        let created = 0;
        for (const { s, p } of rows) {
          if (p && p.groupId === groupId) continue;
          let base = normalizeAlias(s.firstName).slice(0, 12);
          if (base.length < 3) base = (base + 'KUD').slice(0, 3);
          let alias = base;
          for (let n = 2; taken.has(alias); n++) alias = `${base.slice(0, 15 - String(n).length)}${n}`;
          taken.add(alias);
          const row = { studentId: s.id, groupId, alias, figure: randomBytes(1)[0]! % 8, updatedBy: actor.accountId, updatedAt: new Date() };
          await tx.insert(studentPlayProfiles).values(row).onConflictDoUpdate({ target: studentPlayProfiles.studentId, set: row });
          created++;
        }
        return { ...await aulaOverview(tx, groupId), created };
      });
    },
    async aula(actor: AcademicActor, groupId: string) { return withAcademicAccess(actor, async tx => { await ownGroup(tx, actor, groupId); return aulaOverview(tx, groupId); }); },
    async openClass(actor: AcademicActor, groupId: string, payload: unknown) {
      const input = z.strictObject({ minutes: z.number().int().min(15).max(240) }).parse(payload);
      return withAcademicAccess(actor, async tx => {
        await ownGroup(tx, actor, groupId); const now = new Date();
        const row = { groupId, openedBy: actor.accountId, openedAt: now, closesAt: new Date(now.getTime() + input.minutes * 60000) };
        await tx.insert(classroomWindows).values(row).onConflictDoUpdate({ target: classroomWindows.groupId, set: row });
        return aulaOverview(tx, groupId);
      });
    },
    async closeClass(actor: AcademicActor, groupId: string, payload: unknown) {
      z.strictObject({}).parse(payload);
      return withAcademicAccess(actor, async tx => {
        await ownGroup(tx, actor, groupId);
        await tx.delete(classroomWindows).where(eq(classroomWindows.groupId, groupId));
        return aulaOverview(tx, groupId);
      });
    },
    // Activa un juego para todo el curso o para estudiantes elegidos; reemplaza la audiencia si ya estaba activo.
    async activateGame(actor: AcademicActor, groupId: string, payload: unknown) {
      // Límites que fija la docente: intentos por estudiante (1–10) y último día en que el juego queda activo.
      const input = z.strictObject({ taskId: z.enum(AULA_TASKS), audience: z.enum(['GROUP', 'STUDENTS']), studentIds: z.array(uuid).max(1000).default([]),
        maxAttempts: z.number().int().min(1).max(10).optional(), until: z.iso.date().optional() })
        .refine(v => v.audience === 'GROUP' || v.studentIds.length > 0).refine(v => new Set(v.studentIds).size === v.studentIds.length).parse(payload);
      return withAcademicAccess(actor, async tx => {
        const group = await ownGroup(tx, actor, groupId);
        const until = input.until ?? `${group.schoolYear}-12-31`;
        const endsAt = new Date(`${until}T23:59:59.999-05:00`);
        if (!Number.isFinite(endsAt.getTime()) || endsAt <= new Date() || endsAt.getTime() > Date.now() + 366 * 86400000) throw conflict('INVALID_LIMITS');
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'aula:' + groupId + ':' + input.taskId}, 0))`);
        for (const id of input.studentIds) { const s = await ownStudent(tx, actor, id); if (s.groupId !== groupId || !s.isActive) throw notFound(); }
        const studentIds = input.audience === 'GROUP' ? [] : [...input.studentIds].sort();
        const [current] = await tx.select().from(gameActivations).where(and(eq(gameActivations.groupId, groupId), eq(gameActivations.taskId, input.taskId), sql`${gameActivations.endedAt} is null`));
        const [currentAssignment] = current ? await tx.select().from(assignments).where(eq(assignments.id, current.assignmentId)) : [];
        // Mismos límites: solo cambia quién juega (se conservan los intentos). Límites nuevos: nueva asignación (las condiciones son inmutables).
        const sameLimits = currentAssignment && (input.maxAttempts === undefined || input.maxAttempts === currentAssignment.maxAttempts) && (input.until === undefined || currentAssignment.endsAt.getTime() === endsAt.getTime());
        if (current && currentAssignment?.status === 'OPEN' && new Date() < currentAssignment.endsAt && sameLimits) {
          await tx.update(gameActivations).set({ audience: input.audience, studentIds }).where(eq(gameActivations.id, current.id));
          return aulaOverview(tx, groupId);
        }
        if (current) await endActivation(tx, current, actor.accountId);
        const c = await latestConfiguration(tx, input.taskId);
        if (!c) throw conflict('TASK_UNAVAILABLE');
        const now = new Date(), content = { taskId: input.taskId, publishedVersionId: c.version.id, groupId, aula: true, at: now.toISOString() };
        const [a] = await tx.insert(assignments).values({ taskId: input.taskId, publishedVersionId: c.version.id, groupId, createdBy: actor.accountId,
          startsAt: new Date(now.getTime() - 60000), endsAt, maxAttempts: input.maxAttempts ?? 3, requestId: randomUUID(), requestHash: hash(content) }).returning();
        await tx.insert(gameActivations).values({ groupId, taskId: input.taskId, assignmentId: a!.id, audience: input.audience, studentIds, createdBy: actor.accountId });
        return aulaOverview(tx, groupId);
      });
    },
    async deactivateGame(actor: AcademicActor, groupId: string, taskId: string, payload: unknown) {
      z.strictObject({}).parse(payload); const id = z.enum(AULA_TASKS).parse(taskId);
      return withAcademicAccess(actor, async tx => {
        await ownGroup(tx, actor, groupId);
        const [current] = await tx.select().from(gameActivations).where(and(eq(gameActivations.groupId, groupId), eq(gameActivations.taskId, id), sql`${gameActivations.endedAt} is null`));
        if (current) await endActivation(tx, current, actor.accountId);
        return aulaOverview(tx, groupId);
      });
    },
    // Estudiante (público, con límite por IP y por apodo): cursos con clase abierta.
    async aulaGroups() {
      accessSettings(); const now = new Date();
      const rows = await db.select({ id: groups.id, name: groups.name, grade: groups.grade }).from(classroomWindows).innerJoin(groups, eq(groups.id, classroomWindows.groupId))
        .where(and(sql`${classroomWindows.openedAt} <= ${now}`, sql`${classroomWindows.closesAt} > ${now}`)).orderBy(asc(groups.grade), asc(groups.name));
      return { items: rows };
    },
    async aulaIdentify(payload: unknown) {
      accessSettings();
      const input = z.strictObject({ groupId: uuid, alias: aliasInput, figure: figureInput }).parse(payload);
      const wait = await accessLimit(`aula:${input.groupId}:${input.alias}`, 'code');
      if (wait) throw new GameError(429, 'RATE_LIMITED', undefined, wait);
      return db.transaction(async tx => {
        if (!await openWindow(tx, input.groupId)) throw new GameError(403, 'ACCESS_UNAVAILABLE', 'CLASS_CLOSED');
        const [row] = await tx.select({ p: studentPlayProfiles, s: students }).from(studentPlayProfiles).innerJoin(students, eq(students.id, studentPlayProfiles.studentId))
          .where(and(eq(studentPlayProfiles.groupId, input.groupId), eq(studentPlayProfiles.alias, input.alias)));
        if (!row || row.p.figure !== input.figure || !row.s.isActive || row.s.groupId !== input.groupId) throw accessUnavailable();
        const list = await studentGames(tx, row.s.id, input.groupId);
        return { ticket: signTicket(row.s.id, input.groupId, row.p.updatedAt.getTime()), alias: row.p.alias, ...list };
      });
    },
    async aulaGames(payload: unknown) {
      accessSettings(); const input = z.strictObject({ ticket: ticketInput }).parse(payload);
      return db.transaction(async tx => { const { s, g, p } = await aulaStudent(tx, input.ticket); return { alias: p.alias, ...await studentGames(tx, s.id, g.id) }; });
    },
    // Entrega el código de un solo juego para el flujo normal de Play (claim → start → results).
    async aulaCode(payload: unknown) {
      accessSettings(); const input = z.strictObject({ ticket: ticketInput, taskId: z.enum(AULA_TASKS) }).parse(payload);
      try { return await db.transaction(async tx => {
        const { s, g } = await aulaStudent(tx, input.ticket);
        const [found] = (await activeActivations(tx, g.id)).filter(x => x.v.taskId === input.taskId && visibleTo(x.v, s.id));
        if (!found) throw new GameError(403, 'ACCESS_UNAVAILABLE', 'GAME_INACTIVE');
        await lockStudent(tx, s.id); await expire(tx, s.id);
        await tx.insert(recipients).values({ assignmentId: found.a.id, studentId: s.id }).onConflictDoNothing();
        const [r] = await tx.select().from(recipients).where(and(eq(recipients.assignmentId, found.a.id), eq(recipients.studentId, s.id)));
        // Un juego preparado y nunca iniciado (pestaña cerrada) no debe bloquear al niño: se descarta.
        const stale = await tx.select({ id: gameSessions.id }).from(gameSessions).where(and(eq(gameSessions.studentId, s.id), eq(gameSessions.taskId, input.taskId), eq(gameSessions.executionStatus, 'READY')));
        const now = new Date();
        for (const x of stale) { await tx.update(runtimeCapabilities).set({ revokedAt: now }).where(eq(runtimeCapabilities.sessionId, x.id)); await tx.update(launchGrants).set({ invalidatedAt: now }).where(eq(launchGrants.sessionId, x.id)); await tx.update(gameSessions).set({ executionStatus: 'EXPIRED' }).where(eq(gameSessions.id, x.id)); }
        const c = await issueCode(tx, { accountId: g.teacherId, authUserId: '', sessionId: '' }, r!, found.a, null);
        return { code: openCode(c.secretCiphertext, c.encryptionKeyId, aad(c)), expiresAt: c.expiresAt.toISOString() };
      }); } catch (error) {
        if (error instanceof GameError && (error.status === 503 || error.status === 429 || error.reason)) throw error;
        if (error instanceof GameError) throw accessUnavailable();
        throw error;
      }
    },
    // Canje directo del modo aula: no pasa por el límite estricto por IP de /access/claim (toda la clase comparte IP).
    // Reintentar con el mismo claimId reutiliza el código ya canjeado, sin descartar la sesión preparada.
    async aulaClaim(this: { aulaCode(p: unknown): Promise<{ code: string }>; accessClaim(p: unknown): Promise<unknown> }, payload: unknown) {
      accessSettings();
      const input = z.strictObject({ ticket: ticketInput, taskId: z.enum(AULA_TASKS), claimId: uuidV4, runtimeSecret: secret }).parse(payload);
      readTicket(input.ticket);
      const [previous] = await db.select({ c: accessCodes }).from(accessClaims).innerJoin(accessCodes, eq(accessCodes.id, accessClaims.codeId)).where(eq(accessClaims.claimId, input.claimId));
      const code = previous ? openCode(previous.c.secretCiphertext, previous.c.encryptionKeyId, aad(previous.c)) : (await this.aulaCode({ ticket: input.ticket, taskId: input.taskId })).code;
      return this.accessClaim({ code, claimId: input.claimId, runtimeSecret: input.runtimeSecret });
    },
    async createAssignment(actor: AcademicActor, payload: unknown) {
      const input = createInput.parse(payload), { requestId, ...content } = input;
      return withAcademicAccess(actor, async tx => {
        await ownGroup(tx, actor, input.groupId);
        const op = await operation(tx, actor, input, 'CREATE_ASSIGNMENT', input.groupId, content, async () => {
          const c = await configuration(tx, input.publishedVersionId);
          if (!['1.1', 'ext-1'].includes(c.config.contractVersion)) throw conflict('CONFIGURATION_UNSUPPORTED');
          if (c.task.id !== input.taskId || !c.task.isEnabled || !methodAllowed(c.rule)) throw conflict('TASK_UNAVAILABLE');
          for (const id of [...input.studentIds].sort()) { await lockStudent(tx, id); const s = await ownStudent(tx, actor, id); if (s.groupId !== input.groupId) throw notFound(); await requireParticipation(participation, tx, id, new Date()); }
          const [a] = await tx.insert(assignments).values({ ...content, studentIds: undefined, createdBy: actor.accountId, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), requestId, requestHash: hash(content) } as typeof assignments.$inferInsert).returning();
          await tx.insert(recipients).values(input.studentIds.map(studentId => ({ assignmentId: a!.id, studentId })));
          return a!.id;
        });
        return { repeated: op.repeated, detail: await assignmentDetail(tx, await ownAssignment(tx, actor, op.id)) };
      });
    },
    async assignment(actor: AcademicActor, id: string) { return withAcademicAccess(actor, async tx => assignmentDetail(tx, await ownAssignment(tx, actor, id))); },
    async listAssignments(actor: AcademicActor, groupId: string, paging: Paging) {
      return withAcademicAccess(actor, async tx => {
        await ownGroup(tx, actor, groupId); const filter = `assignments:${groupId}`, position = datePosition(paging.cursor, filter);
        const rows = await tx.select().from(assignments).where(and(eq(assignments.groupId, groupId), position ? sql`(${assignments.createdAt}, ${assignments.id}) < (${position.at}::timestamptz, ${position.id}::uuid)` : undefined)).orderBy(desc(assignments.createdAt), desc(assignments.id)).limit(paging.limit + 1);
        const page = rows.slice(0, paging.limit), items = [];
        for (const a of page) { const { recipients: _, ...summary } = await assignmentDetail(tx, a); items.push(summary); }
        const last = page.at(-1);
        return { items, nextCursor: rows.length > paging.limit ? cursorFor(filter, { at: last!.createdAt.toISOString(), id: last!.id }) : null };
      });
    },
    async listStudentAssignments(actor: AcademicActor, studentId: string, paging: Paging) {
      return withAcademicAccess(actor, async tx => {
        // Fixed recipients, not current membership; only assignments of courses the actor is responsible for.
        await ownStudent(tx, actor, studentId); const filter = `student-assignments:${studentId}`, position = datePosition(paging.cursor, filter);
        const rows = await tx.select({ a: assignments, recipientId: recipients.id }).from(recipients)
          .innerJoin(assignments, eq(assignments.id, recipients.assignmentId)).innerJoin(groups, eq(groups.id, assignments.groupId))
          .where(and(eq(recipients.studentId, studentId), eq(groups.teacherId, actor.accountId),
            position ? sql`(${assignments.createdAt}, ${assignments.id}) < (${position.at}::timestamptz, ${position.id}::uuid)` : undefined))
          .orderBy(desc(assignments.createdAt), desc(assignments.id)).limit(paging.limit + 1);
        const page = rows.slice(0, paging.limit), items = [], now = new Date();
        for (const { a, recipientId } of page) {
          const [total] = await tx.select({ n: sql<number>`count(*)::int` }).from(recipients).where(eq(recipients.assignmentId, a.id));
          const [attempts] = await tx.select({ n: sql<number>`count(*)::int` }).from(gameSessions).where(and(eq(gameSessions.recipientId, recipientId), isNotNull(gameSessions.attemptNumber)));
          items.push({ ...await assignmentSummary(tx, a, total!.n, now), studentId, recipientId, attemptsStarted: attempts!.n });
        }
        const last = page.at(-1)?.a;
        return { items, nextCursor: rows.length > paging.limit ? cursorFor(filter, { at: last!.createdAt.toISOString(), id: last!.id }) : null };
      });
    },
    async cancel(actor: AcademicActor, id: string, payload: unknown) {
      const input = requestInput.parse(payload);
      return withAcademicAccess(actor, async tx => {
        await ownAssignment(tx, actor, id);
        await operation(tx, actor, input, 'CANCEL', id, {}, async () => {
          await tx.update(assignments).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor.accountId }).where(and(eq(assignments.id, id), eq(assignments.status, 'OPEN'))); return id;
        });
        return assignmentDetail(tx, await ownAssignment(tx, actor, id));
      });
    },
    async grant(actor: AcademicActor, target: string, payload: unknown, recovery = false) {
      const input: { requestId: string; submissionId?: string } = recovery ? requestInput.extend({ submissionId: uuidV4 }).parse(payload) : requestInput.parse(payload);
      return withAcademicAccess(actor, async tx => {
        const owned = recovery ? await ownSession(tx, actor, target) : null;
        const r = owned ? await recipient(tx, owned.s.recipientId) : await recipient(tx, target);
        const a = await ownAssignment(tx, actor, r.assignmentId);
        const s0 = await ownStudent(tx, actor, r.studentId);
        if (s0.groupId !== a.groupId) throw notFound();
        const { requestId, ...content } = input;
        const op = await operation(tx, actor, input, recovery ? 'RECOVER' : 'LAUNCH', target, content, async () => {
          await lockStudent(tx, r.studentId); await expire(tx, r.studentId);
          const now = new Date();
          let s: SessionRow;
          if (owned) {
            const [latest] = await tx.select().from(gameSessions).where(eq(gameSessions.id, owned.s.id)).for('update'); s = latest!;
            if (s.attemptNumber === null) throw conflict('SESSION_NOT_STARTED');
            await requireStartedAuthorization(tx, s);
            const [receipt] = await tx.select().from(resultReceipts).where(eq(resultReceipts.sessionId, s.id));
            if (receipt && receipt.submissionId !== input.submissionId) throw conflict('RESULT_CONFLICT');
          } else {
            const eligibility = await requireParticipation(participation, tx, r.studentId, now);
            s = await prepare(tx, r, a, now, eligibility.validUntil);
          }
          const id = randomUUID(), token = randomBytes(32).toString('base64url'), sealed = encryptGrant(token, `${s.id}:${id}`);
          await tx.insert(launchGrants).values({ id, sessionId: s.id, scope: recovery ? 'RECOVER_SUBMISSION' : 'START_SESSION',
            submissionId: recovery ? input.submissionId! : null, secretDigest: secretDigest(token),
            secretCiphertext: sealed.ciphertext, encryptionKeyId: sealed.keyId, expiresAt: new Date(now.getTime() + 300000), issuedBy: actor.accountId, requestId, requestHash: hash(content) });
          return id;
        });
        const [g] = await tx.select().from(launchGrants).where(eq(launchGrants.id, op.id));
        if (!g || g.invalidatedAt || g.expiresAt <= new Date()) throw conflict('GRANT_NOT_USABLE');
        if (owned) await requireStartedAuthorization(tx, owned.s);
        else await requireParticipation(participation, tx, r.studentId, new Date());
        return { repeated: op.repeated, detail: { sessionId: g.sessionId, grantId: g.id, launchGrant: decryptGrant(g.secretCiphertext, g.encryptionKeyId, `${g.sessionId}:${g.id}`), expiresAt: g.expiresAt.toISOString(), runtimeOrigin: runtimeSettings().origin } };
      });
    },
    async claim(token: string, payload: unknown) {
      const input = z.strictObject({ claimId: uuidV4, runtimeSecret: secret }).parse(payload), digest = secretDigest(token);
      return db.transaction(async tx => {
        const [initial] = await tx.select().from(launchGrants).where(eq(launchGrants.secretDigest, digest));
        if (!initial || initial.invalidatedAt) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
        const [before] = await tx.select().from(gameSessions).where(eq(gameSessions.id, initial.sessionId));
        const { a: assignment } = await sessionConfig(tx, before!);
        await tx.select().from(groups).where(eq(groups.id, assignment.groupId)).for('share');
        await lockStudent(tx, before!.studentId); await expire(tx, before!.studentId);
        const [g] = await tx.select().from(launchGrants).where(eq(launchGrants.id, initial.id)).for('update');
        const [s] = await tx.select().from(gameSessions).where(eq(gameSessions.id, initial.sessionId)).for('update');
        if (g!.invalidatedAt) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
        const { a } = await sessionConfig(tx, s!);
        if (g!.claimedAt) {
          const [cap] = await tx.select().from(runtimeCapabilities).where(eq(runtimeCapabilities.id, g!.boundCapabilityId!));
          if (g!.claimId !== input.claimId || cap!.secretDigest !== secretDigest(input.runtimeSecret)) throw new GameError(409, 'CLAIM_CONFLICT');
          if (cap!.revokedAt || cap!.expiresAt <= new Date()) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
          if (s!.executionStatus === 'READY') { await currentIssuer(tx, g!.issuedBy, a.groupId); await requireParticipation(participation, tx, s!.studentId, new Date()); await ready(tx, a, new Date()); }
          else { await currentIssuer(tx, g!.issuedBy, a.groupId); await requireStartedAuthorization(tx, s!); }
          return context(tx, s!, cap!);
        }
        const now = new Date();
        if (g!.expiresAt <= now) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
        await currentIssuer(tx, g!.issuedBy, a.groupId);
        const recovery = g!.scope === 'RECOVER_SUBMISSION';
        if (recovery) await requireStartedAuthorization(tx, s!);
        else await requireParticipation(participation, tx, s!.studentId, now);
        if (!recovery) { await ready(tx, a, now); if (s!.executionStatus !== 'READY' || s!.startAllowedUntil <= now) throw new GameError(409, 'SESSION_NOT_STARTABLE'); }
        const expires = recovery ? new Date(now.getTime() + 86400000) : s!.startAllowedUntil;
        const [cap] = await tx.insert(runtimeCapabilities).values({ sessionId: s!.id, claimId: input.claimId, secretDigest: secretDigest(input.runtimeSecret),
          canStart: !recovery, canSubmit: recovery, canReadReceipt: true, startAllowedUntil: s!.startAllowedUntil, expiresAt: expires, submissionId: g!.submissionId }).returning();
        await tx.update(launchGrants).set({ claimId: input.claimId, claimedAt: now, boundCapabilityId: cap!.id }).where(eq(launchGrants.id, g!.id));
        return context(tx, s!, cap!);
      });
    },
    async context(id: string, token: string) {
      return authenticated(id, token, async (tx, s, cap) => {
        if (s.executionStatus === 'READY') {
          const { a } = await sessionConfig(tx, s);
          await sourceAllowed(tx, s, cap); await ready(tx, a, new Date()); await requireParticipation(participation, tx, s.studentId, new Date());
        } else await requireStartedAuthorization(tx, s);
        return context(tx, s, cap);
      });
    },
    async start(id: string, token: string, payload: unknown) {
      const { startId } = z.strictObject({ startId: uuidV4 }).parse(payload);
      return authenticated(id, token, async (tx, s, cap) => {
        const now = new Date();
        if (!cap.canStart || !['READY', 'RUNNING'].includes(s.executionStatus)) throw new GameError(409, 'SESSION_NOT_STARTABLE');
        const { a } = await sessionConfig(tx, s);
        if (s.executionStatus === 'READY') await sourceAllowed(tx, s, cap);
        else if (s.launchMode === 'SUPERVISED') await sourceAllowed(tx, s, cap);
        if (s.executionStatus === 'RUNNING') {
          if (s.startRequestId !== startId) throw new GameError(409, 'SESSION_ALREADY_STARTED');
          await requireStartedAuthorization(tx, s);
        } else {
          const eligibility = await requireParticipation(participation, tx, s.studentId, now);
          await ready(tx, a, now);
          if (cap.startAllowedUntil <= now) throw new GameError(409, 'SESSION_NOT_STARTABLE');
          const [student] = await tx.select().from(students).where(eq(students.id, s.studentId));
          if (student!.groupId !== a.groupId) throw new GameError(403, 'PARTICIPATION_BLOCKED');
          const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(gameSessions).where(and(eq(gameSessions.recipientId, s.recipientId), sql`${gameSessions.attemptNumber} is not null`));
          if (count!.n >= a.maxAttempts) throw new GameError(409, 'ATTEMPT_LIMIT');
          const [started] = await tx.update(gameSessions).set({ executionStatus: 'RUNNING', attemptNumber: count!.n + 1, startedAtServer: now, startRequestId: startId,
            uploadAllowedUntil: new Date(now.getTime() + 604800000), groupIdAtStart: a.groupId, participationAuthorizationRef: eligibility.authorizationReference }).where(eq(gameSessions.id, id)).returning();
          s = started!;
          await tx.update(runtimeCapabilities).set({ canSubmit: true, expiresAt: s.uploadAllowedUntil! }).where(eq(runtimeCapabilities.id, cap.id));
        }
        return { sessionId: id, attemptNumber: s.attemptNumber!, executionStatus: 'RUNNING' as const, startedAtServer: s.startedAtServer!.toISOString(), uploadAllowedUntil: s.uploadAllowedUntil!.toISOString() };
      });
    },
    async submit(id: string, token: string, payload: unknown) {
      if (payload && typeof payload === 'object' && (payload as { contractVersion?: unknown }).contractVersion === 'ext-1') return submitExternal(id, token, payload);
      const e = envelopeSchema.parse(payload);
      return authenticated(id, token, async (tx, s, cap) => {
        const fingerprint = hash(e);
        if (e.sessionId !== id) throw new GameError(409, 'VERSION_UNSUPPORTED');
        if (cap.submissionId && cap.submissionId !== e.submissionId) throw new GameError(409, 'RESULT_CONFLICT');
        const [old] = await tx.select().from(resultReceipts).where(eq(resultReceipts.sessionId, id));
        if (old) {
          if (old.submissionId !== e.submissionId) throw new GameError(409, 'SESSION_ALREADY_SUBMITTED');
          if (old.evidenceHash !== fingerprint) throw new GameError(409, 'RESULT_CONFLICT');
          return { repeated: true, receipt: receiptDto(old) };
        }
        if (!s.startedAtServer || !s.attemptNumber) throw new GameError(409, 'SESSION_NOT_STARTED');
        if (!cap.canSubmit) throw new GameError(401, 'RUNTIME_UNAUTHENTICATED');
        await requireStartedAuthorization(tx, s);
        const { c } = await sessionConfig(tx, s);
        if (e.publishedVersionId !== c.version.id || e.configVersion !== c.version.version || e.contractVersion !== c.config.contractVersion || e.gameBuildId !== c.config.gameBuildId || e.configurationHash !== c.config.configurationHash || e.taskId !== s.taskId) throw new GameError(409, 'VERSION_UNSUPPORTED');
        const [global] = await tx.select().from(resultReceipts).where(eq(resultReceipts.submissionId, e.submissionId));
        if (global) throw new GameError(409, 'RESULT_CONFLICT');
        const [receipt] = await tx.insert(resultReceipts).values({ sessionId: id, submissionId: e.submissionId, contractVersion: e.contractVersion, evidenceHash: fingerprint,
          producerState: e.state, terminationReason: e.terminationReason, clockId: e.clock.id, timeOriginUnixMs: e.clock.timeOriginUnixMs, ...e.timing, device: e.device }).returning();
        if (e.events.length) await tx.insert(rawEvents).values(e.events.map(t => ({ sessionId: id, ...t })));
        if (e.incidents.length) await tx.insert(sessionIncidents).values(e.incidents.map(i => ({ sessionId: id, ...i })));
        await tx.insert(calculationRuns).values({ sessionId: id, ruleVersionId: c.rule.id, runNumber: 1, evidenceHash: fingerprint });
        await tx.update(gameSessions).set({ executionStatus: e.state === 'completed' ? 'COMPLETED' : 'INTERRUPTED', processingStatus: 'PENDING', closedReceivedAt: receipt!.receivedAt }).where(eq(gameSessions.id, id));
        return { repeated: false, receipt: receiptDto(receipt!) };
      });
    },
    async receipt(id: string, token: string, submissionId: string) {
      uuidV4.parse(submissionId);
      return authenticated(id, token, async (tx, _s, cap) => {
        if (!cap.canReadReceipt || cap.submissionId && cap.submissionId !== submissionId) throw notFound();
        const [r] = await tx.select().from(resultReceipts).where(and(eq(resultReceipts.sessionId, id), eq(resultReceipts.submissionId, submissionId)));
        return { receipt: r ? receiptDto(r) : null };
      }, true); // Expiry closes submission, not read-only acknowledgement of an existing commit.
    },
    async listSessions(actor: AcademicActor, studentId: string, taskId: string | undefined, paging: Paging) {
      return withAcademicAccess(actor, async tx => {
        await ownStudent(tx, actor, studentId); const filter = `sessions:${studentId}:${taskId ?? ''}`, position = datePosition(paging.cursor, filter);
        const rows = await tx.select().from(gameSessions).where(and(eq(gameSessions.studentId, studentId), taskId ? eq(gameSessions.taskId, taskId) : undefined,
          position ? sql`(${gameSessions.preparedAt}, ${gameSessions.id}) < (${position.at}::timestamptz, ${position.id}::uuid)` : undefined)).orderBy(desc(gameSessions.preparedAt), desc(gameSessions.id)).limit(paging.limit + 1);
        const page = rows.slice(0, paging.limit), items = [];
        for (const s of page) { await ownSession(tx, actor, s.id); items.push(await sessionSummary(tx, s)); }
        return { items, nextCursor: rows.length > paging.limit ? cursorFor(filter, { at: page.at(-1)!.preparedAt.toISOString(), id: page.at(-1)!.id }) : null };
      });
    },
    async session(actor: AcademicActor, id: string) {
      return withAcademicAccess(actor, async tx => {
        const { s } = await ownSession(tx, actor, id), { c } = await sessionConfig(tx, s);
        const [receipt] = await tx.select().from(resultReceipts).where(eq(resultReceipts.sessionId, id));
        const [run] = await tx.select().from(calculationRuns).where(s.activeCalculationRunId ? eq(calculationRuns.id, s.activeCalculationRunId) : eq(calculationRuns.sessionId, id)).orderBy(desc(calculationRuns.runNumber)).limit(1);
        const values = run?.status === 'SUCCEEDED' ? await tx.select().from(calculatedIndicators).where(eq(calculatedIndicators.runId, run.id)).orderBy(
          sql`case ${calculatedIndicators.scope} when 'SESSION' then 0 when 'SEGMENT_1' then 1 when 'SEGMENT_2' then 2 else 3 end`,
          sql`case ${calculatedIndicators.metricCode} when 'accuracy_pct' then 0 when 'omission_rate_pct' then 1 when 'commission_rate_pct' then 2 when 'median_reaction_time_ms' then 3 when 'rt_sd_ms' then 4 else 5 end`) : [];
        return { ...await sessionSummary(tx, s), publishedVersionId: c.version.id, configurationHash: c.config.configurationHash, configuration: c.config.configuration,
          declaredState: receipt?.producerState ?? null, terminationReason: receipt?.terminationReason ?? null,
          measuredDurationMs: receipt ? receipt.finishedAtMs - receipt.startedAtMs : null, device: receipt?.device ?? null, receipt: receipt ? receiptDto(receipt) : null,
          calculation: run ? { runId: run.id, ruleCode: c.rule.code, ruleVersion: c.rule.version, status: run.status, calculatedAt: run.finishedAt?.toISOString() ?? null, summary: run.summary,
            indicators: values.map(({ id: _, runId: __, value, ...v }) => ({ ...v, value: value === null ? null : Number(value) })) } : null };
      });
    },
    async evidence(actor: AcademicActor, id: string, kind: 'trials' | 'incidents', paging: Paging) {
      return withAcademicAccess(actor, async tx => {
        const { s } = await ownSession(tx, actor, id), filter = `evidence:${id}:${kind}`;
        const position = z.number().int().nonnegative().nullable().parse(cursorPosition(paging.cursor, filter)) ?? 0;
        const [run] = s.activeCalculationRunId ? await tx.select().from(calculationRuns).where(eq(calculationRuns.id, s.activeCalculationRunId)) : [];
        const decisions = (run?.evidenceDecisions ?? []) as { trial: number; included: boolean; rtIncluded: boolean; reason: string | null }[];
        if (kind === 'trials') {
          const rows = await tx.select().from(rawEvents).where(and(eq(rawEvents.sessionId, id), sql`${rawEvents.trial} > ${position}`)).orderBy(asc(rawEvents.trial)).limit(paging.limit + 1), page = rows.slice(0, paging.limit);
          return { items: page.map(({ id: _, sessionId: __, ...t }) => ({ ...t, calculationDecision: decisions.find(d => d.trial === t.trial) ?? null })), nextCursor: rows.length > paging.limit ? cursorFor(filter, page.at(-1)!.trial) : null };
        }
        const rows = await tx.select().from(sessionIncidents).where(and(eq(sessionIncidents.sessionId, id), sql`${sessionIncidents.sequence} > ${position}`)).orderBy(asc(sessionIncidents.sequence)).limit(paging.limit + 1), page = rows.slice(0, paging.limit);
        return { items: page.map(({ id: _, sessionId: __, ...i }) => i), nextCursor: rows.length > paging.limit ? cursorFor(filter, page.at(-1)!.sequence) : null };
      });
    },
    async retry(actor: AcademicActor, id: string, payload: unknown) {
      const input = requestInput.parse(payload);
      return withAcademicAccess(actor, async tx => {
        await ownSession(tx, actor, id);
        const op = await operation(tx, actor, input, 'PROCESSING_RETRY', id, {}, async () => {
          await tx.select().from(gameSessions).where(eq(gameSessions.id, id)).for('update');
          const [last] = await tx.select().from(calculationRuns).where(eq(calculationRuns.sessionId, id)).orderBy(desc(calculationRuns.runNumber)).limit(1);
          if (last?.status !== 'FAILED') throw conflict('PROCESSING_NOT_FAILED');
          const [run] = await tx.insert(calculationRuns).values({ sessionId: id, ruleVersionId: last.ruleVersionId, runNumber: last.runNumber + 1, evidenceHash: last.evidenceHash }).returning();
          await tx.update(gameSessions).set({ processingStatus: 'PENDING' }).where(eq(gameSessions.id, id)); return run!.id;
        });
        return { sessionId: id, runId: op.id, processingStatus: 'PENDING' as const };
      });
    },
  };
}
export type Paging = { limit: number; cursor?: string };
function datePosition(cursor: string | undefined, filter: string) {
  return z.strictObject({ at: z.iso.datetime(), id: uuid }).nullable().parse(cursorPosition(cursor, filter));
}
