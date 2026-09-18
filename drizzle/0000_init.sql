CREATE TABLE "signed_waiver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waiver_type_id" uuid NOT NULL,
	"waiver_type_name" text NOT NULL,
	"version_signed" integer NOT NULL,
	"signer_name" text NOT NULL,
	"signature_image_url" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"downloaded" boolean DEFAULT false NOT NULL,
	"downloaded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "waiver_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"docx_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signed_waiver" ADD CONSTRAINT "signed_waiver_waiver_type_id_waiver_type_id_fk" FOREIGN KEY ("waiver_type_id") REFERENCES "public"."waiver_type"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "signed_waiver_duplicate_idx" ON "signed_waiver" USING btree ("waiver_type_id","version_signed",lower("signer_name"));--> statement-breakpoint
CREATE INDEX "signed_waiver_retention_idx" ON "signed_waiver" USING btree ("downloaded","downloaded_at");--> statement-breakpoint
CREATE INDEX "signed_waiver_signed_at_idx" ON "signed_waiver" USING btree ("signed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_type_name_unq" ON "waiver_type" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_type_slug_unq" ON "waiver_type" USING btree ("slug");