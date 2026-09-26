CREATE TYPE "public"."billing_ledger_destination" AS ENUM('PLATFORM_REVENUE', 'DRIVER_DISCIPLINE_RESERVE');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "subscription_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "current_billing_cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "opted_out_of_reserve" boolean DEFAULT false NOT NULL;