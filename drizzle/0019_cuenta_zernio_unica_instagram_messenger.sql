DROP INDEX "instagram_credentials_account_ref_idx";--> statement-breakpoint
DROP INDEX "messenger_credentials_account_ref_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_credentials_account_ref_uq" ON "instagram_credentials" USING btree ("account_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_credentials_account_ref_uq" ON "messenger_credentials" USING btree ("account_ref");