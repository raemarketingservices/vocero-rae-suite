CREATE TABLE "platform_brand" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"accent" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
