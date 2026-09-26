CREATE TABLE "event_rewards" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"rank" integer NOT NULL,
	"reward_type" text NOT NULL,
	"reward_value_cents" integer DEFAULT 0 NOT NULL,
	"discount_percent" integer,
	"duration_months" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_rewards_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "event_rewards" ADD CONSTRAINT "event_rewards_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;