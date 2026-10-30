CREATE TABLE "zernio_handoff" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"account_ref" text,
	"error_code" text,
	"error_message" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN "profile_ref" text;--> statement-breakpoint
ALTER TABLE "zernio_handoff" ADD CONSTRAINT "zernio_handoff_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zernio_handoff_org_idx" ON "zernio_handoff" USING btree ("organization_id");