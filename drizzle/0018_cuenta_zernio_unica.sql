DROP INDEX "meta_credentials_account_ref_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "meta_credentials_account_ref_uq" ON "meta_credentials" USING btree ("account_ref");