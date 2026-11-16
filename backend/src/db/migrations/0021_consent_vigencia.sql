ALTER TABLE "consent_operations" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "consent_records" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_valid_until_check" CHECK ("consent_records"."valid_until" is null or "consent_records"."valid_until" >= "consent_records"."received_on");