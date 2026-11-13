CREATE TABLE "external_game_results" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"event_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_result_events_check" CHECK ("external_game_results"."event_count" >= 0 and "external_game_results"."event_count" <= 1000)
);
--> statement-breakpoint
ALTER TABLE "external_game_results" ADD CONSTRAINT "external_game_results_session_id_task_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."task_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_game_results" ADD CONSTRAINT "external_game_results_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "tasks" ("id", "title", "description", "purpose", "pedagogical_notice") VALUES
('TG-02', 'Palabra intrusa',
  'Cuatro palabras: tres pertenecen a un mismo grupo y una es la intrusa. Práctica guiada y 18 ítems de medición en tres niveles.',
  'Apoyar la observación pedagógica de la atención selectiva en un contexto de categorización semántica (Fundamento teórico 4.3 y 5.6).',
  'Uso de apoyo pedagógico, complementario y no diagnóstico. No reemplaza la valoración pedagógica ni la evaluación especializada.'),
('TG-03', 'Mentalista',
  'Kud dicta instrucciones encadenadas de suma y resta que van desapareciendo; al final el estudiante elige el resultado entre cuatro opciones.',
  'Apoyar la observación pedagógica de la memoria de trabajo bajo carga matemática (Fundamento teórico 5.7, precisión por carga).',
  'Uso de apoyo pedagógico, complementario y no diagnóstico. No reemplaza la valoración pedagógica ni la evaluación especializada.'),
('TG-04', 'Kud Dice',
  'Reproducción inmediata de secuencias audiovisuales con cuatro tambores, de longitud creciente (adaptación de Simón dice y Corsi).',
  'Apoyar la observación pedagógica de la memoria de trabajo para secuencias (Fundamento teórico 5.7 y 5.8, recuerdo serial).',
  'Uso de apoyo pedagógico, complementario y no diagnóstico. No reemplaza la valoración pedagógica ni la evaluación especializada.')
ON CONFLICT ("id") DO NOTHING;
