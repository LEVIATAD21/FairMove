CREATE TYPE "public"."event_status" AS ENUM('draft', 'open', 'running', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reward_tier" AS ENUM('tier_5_10', 'tier_4', 'tier_3', 'tier_2', 'tier_1');--> statement-breakpoint
CREATE TABLE "cinema_reward_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"driver_id" text NOT NULL,
	"event_id" text NOT NULL,
	"cinema_link" text NOT NULL,
	"pix_key" text,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"admin_notes" text,
	"approved_at" timestamp,
	"approved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_leaderboard" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric(12, 4) NOT NULL,
	"reward_tier" "reward_tier",
	"rides_count" integer DEFAULT 0 NOT NULL,
	"avg_rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"acceptance_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_participants_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"buy_in_fee" integer DEFAULT 2000 NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"max_participants" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"driver_id" text NOT NULL,
	"event_id" text,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"description" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"metadata" text,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reward_wallet_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "cinema_reward_claims" ADD CONSTRAINT "cinema_reward_claims_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_leaderboard" ADD CONSTRAINT "event_leaderboard_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_wallet_transactions" ADD CONSTRAINT "reward_wallet_transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;