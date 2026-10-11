CREATE TABLE "wallet_deposits" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'BRL' NOT NULL,
  "provider" text DEFAULT 'mercadopago' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "idempotency_key" text NOT NULL,
  "provider_payment_id" text,
  "qr_code" text,
  "qr_code_base64" text,
  "ticket_url" text,
  "expires_at" timestamp,
  "approved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "wallet_deposits_idempotency_key_unique" UNIQUE("idempotency_key"),
  CONSTRAINT "wallet_deposits_provider_payment_id_unique" UNIQUE("provider_payment_id")
);
--> statement-breakpoint
CREATE INDEX "idx_wallet_deposits_user_created" ON "wallet_deposits" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_wallet_deposits_status_created" ON "wallet_deposits" USING btree ("status", "created_at");