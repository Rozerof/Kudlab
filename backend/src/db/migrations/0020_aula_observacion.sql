CREATE TABLE "classroom_windows" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	CONSTRAINT "classroom_windows_order_check" CHECK ("classroom_windows"."opened_at" < "classroom_windows"."closes_at")
);
--> statement-breakpoint
CREATE TABLE "game_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"assignment_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"student_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "game_activations_assignment_id_unique" UNIQUE("assignment_id")
);
--> statement-breakpoint
CREATE TABLE "observation_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"period" text NOT NULL,
	"observed_on" date NOT NULL,
	"area" text NOT NULL,
	"responses" jsonb NOT NULL,
	"notes" jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observation_panels_request_unique" UNIQUE("teacher_id","request_id"),
	CONSTRAINT "observation_panels_period_check" CHECK ("observation_panels"."period" ~ '^[0-9]{4}-P[1-4]$')
);
--> statement-breakpoint
CREATE TABLE "student_play_profiles" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"figure" smallint NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_play_profiles_alias_unique" UNIQUE("group_id","alias"),
	CONSTRAINT "student_play_profiles_alias_check" CHECK ("student_play_profiles"."alias" ~ '^[A-Z0-9Ñ]{3,15}$'),
	CONSTRAINT "student_play_profiles_figure_check" CHECK ("student_play_profiles"."figure" between 0 and 7)
);
--> statement-breakpoint
ALTER TABLE "classroom_windows" ADD CONSTRAINT "classroom_windows_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_windows" ADD CONSTRAINT "classroom_windows_opened_by_user_accounts_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_activations" ADD CONSTRAINT "game_activations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_activations" ADD CONSTRAINT "game_activations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_activations" ADD CONSTRAINT "game_activations_assignment_id_task_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."task_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_activations" ADD CONSTRAINT "game_activations_created_by_user_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_panels" ADD CONSTRAINT "observation_panels_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_panels" ADD CONSTRAINT "observation_panels_teacher_id_user_accounts_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_play_profiles" ADD CONSTRAINT "student_play_profiles_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_play_profiles" ADD CONSTRAINT "student_play_profiles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_play_profiles" ADD CONSTRAINT "student_play_profiles_updated_by_user_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_activations_active_unique" ON "game_activations" USING btree ("group_id","task_id") WHERE "game_activations"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "game_activations_group_idx" ON "game_activations" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "observation_panels_student_idx" ON "observation_panels" USING btree ("student_id","observed_on");