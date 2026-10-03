CREATE TABLE "driver_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"driver_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"mime_type" text NOT NULL,
	"data" text NOT NULL,
	"cnh_number" text,
	"cnh_expires_on" timestamp,
	"renavam" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "approval_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "approval_reason" text;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_drivers_approval_status" ON "drivers" USING btree ("approval_status");