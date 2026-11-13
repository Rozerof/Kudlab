CREATE TABLE "login_failures" (
	"email_digest" text PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"last_failure_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "login_failures_count_check" CHECK ("login_failures"."failures" >= 0)
);
--> statement-breakpoint
-- DF-NF10001: la auditoría de cuentas tampoco se puede vaciar con TRUNCATE (ni por CASCADE desde otra tabla).
-- Solo una base de pruebas que lo active explícitamente (PGOPTIONS='-c kudlab.allow_truncate=on') puede hacerlo.
CREATE FUNCTION reject_account_audit_truncate() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('kudlab.allow_truncate', true), '') = 'on' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'account_audit_events es de solo inserción' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER account_audit_no_truncate BEFORE TRUNCATE ON account_audit_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_account_audit_truncate();
