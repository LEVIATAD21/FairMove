-- BUG-D: tabela existia apenas no modelo órfão wallet_id (0 linhas);
-- drop+create alinha o físico ao modelo usado pelo código (reserve_id).
DROP TABLE IF EXISTS "reserve_transactions";
CREATE TABLE "reserve_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"reserve_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"purpose" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"description" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
