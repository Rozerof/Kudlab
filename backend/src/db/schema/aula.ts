// Modo aula: código fijo por estudiante (apodo + figura secreta), clase abierta por la docente y juegos activos
// por curso o por estudiante. Panel de observación docente en escala 0–5 (13 preguntas, bloques A–E).
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, smallint, timestamp, jsonb, date, unique, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { groups, students } from './academic.js';
import { userAccounts } from './accounts.js';
import { tasks } from './tasks.js';
import { assignments } from './game.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

export const studentPlayProfiles = pgTable('student_play_profiles', {
  studentId: uuid('student_id').primaryKey().references(() => students.id),
  groupId: uuid('group_id').notNull().references(() => groups.id),
  alias: text('alias').notNull(),
  figure: smallint('figure').notNull(),
  updatedBy: uuid('updated_by').notNull().references(() => userAccounts.id),
  updatedAt: at('updated_at').notNull().defaultNow(),
}, t => [unique('student_play_profiles_alias_unique').on(t.groupId, t.alias),
  check('student_play_profiles_alias_check', sql`${t.alias} ~ '^[A-Z0-9Ñ]{3,15}$'`),
  check('student_play_profiles_figure_check', sql`${t.figure} between 0 and 7`)]);

export const classroomWindows = pgTable('classroom_windows', {
  groupId: uuid('group_id').primaryKey().references(() => groups.id),
  openedBy: uuid('opened_by').notNull().references(() => userAccounts.id),
  openedAt: at('opened_at').notNull(),
  closesAt: at('closes_at').notNull(),
}, t => [check('classroom_windows_order_check', sql`${t.openedAt} < ${t.closesAt}`)]);

export const gameActivations = pgTable('game_activations', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => groups.id),
  taskId: text('task_id').notNull().references(() => tasks.id),
  assignmentId: uuid('assignment_id').notNull().references(() => assignments.id).unique(),
  audience: text('audience', { enum: ['GROUP', 'STUDENTS'] }).notNull(),
  studentIds: jsonb('student_ids').$type<string[]>().notNull().default([]),
  createdBy: uuid('created_by').notNull().references(() => userAccounts.id),
  createdAt: at('created_at').notNull().defaultNow(),
  endedAt: at('ended_at'),
}, t => [uniqueIndex('game_activations_active_unique').on(t.groupId, t.taskId).where(sql`${t.endedAt} is null`),
  index('game_activations_group_idx').on(t.groupId)]);

export const observationPanels = pgTable('observation_panels', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id').notNull().references(() => students.id),
  teacherId: uuid('teacher_id').notNull().references(() => userAccounts.id),
  period: text('period').notNull(),
  observedOn: date('observed_on').notNull(),
  area: text('area', { enum: ['LECTURA', 'MATEMATICAS', 'AMBAS'] }).notNull(),
  responses: jsonb('responses').$type<Record<string, number | null>>().notNull(),
  notes: jsonb('notes').$type<Record<string, string>>().notNull(),
  requestId: uuid('request_id').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
}, t => [unique('observation_panels_request_unique').on(t.teacherId, t.requestId),
  index('observation_panels_student_idx').on(t.studentId, t.observedOn),
  check('observation_panels_period_check', sql`${t.period} ~ '^[0-9]{4}-P[1-4]$'`)]);
