ALTER TABLE "meta_credentials" ALTER COLUMN "waba_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_credentials" ALTER COLUMN "phone_number_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'meta' NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "account_ref" text;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "webhook_secret" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_credentials_account_ref_idx" ON "meta_credentials" USING btree ("account_ref");
