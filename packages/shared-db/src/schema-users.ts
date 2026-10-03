import { pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { users } from "./schema-auth";

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().unique().references(() => users.id),
  phone: text("phone"),
  documentNumber: text("document_number"),
  documentType: text("document_type"),
  documentUrl: text("document_url"),
  isVerified: boolean("is_verified").default(false).notNull(),
  rating: integer("rating").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const drivers = pgTable(
  "drivers",
  {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().unique().references(() => users.id),
  vehicleId: text("vehicle_id"),
  status: text("status").default("offline").notNull(),
  available: boolean("available").default(true).notNull(),
  currentLocationLat: text("current_location_lat"),
  currentLocationLng: text("current_location_lng"),
  earnedToday: integer("earned_today").default(0).notNull(),
  pendingBalance: integer("pending_balance").default(0).notNull(),
  reserveBalance: integer("reserve_balance").default(0).notNull(),
  subscriptionStatus: text("subscription_status").default("free").notNull(),
  // Fluxo de aprovação Uber/99: todo candidato NOVO nasce "pending" e só
  // opera (online/aceitar corrida) com "approved". "approved" como DEFAULT
  // preserva contas existentes e fixtures de teste (backfill da migração).
  approvalStatus: text("approval_status").default("approved").notNull(),
  approvalReason: text("approval_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // BUG-H2: filtro de matching (online + disponível) era Seq Scan a cada busca.
    statusAvailableIdx: index("idx_drivers_status_available").on(t.status, t.available),
    approvalStatusIdx: index("idx_drivers_approval_status").on(t.approvalStatus),
  })
);

/** Documentos enviados pelo candidato a motorista (CNH, CRLV, fotos do veículo). */
export const driverDocuments = pgTable("driver_documents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  driverId: text("driver_id")
    .notNull()
    .references(() => drivers.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(), // cnh_front | cnh_back | vehicle_front | vehicle_back | vehicle_side | crlv
  mimeType: text("mime_type").notNull(),
  data: text("data").notNull(), // data URL base64 (imagem; limite de tamanho validado na rota)
  cnhNumber: text("cnh_number"),
  cnhExpiresOn: timestamp("cnh_expires_on"),
  renavam: text("renavam"),
  status: text("status").default("submitted").notNull(), // submitted | accepted | rejected
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  driverId: text("driver_id").references(() => drivers.id),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  color: text("color"),
  plate: text("plate").notNull().unique(),
  vehicleType: text("vehicle_type").notNull().default("car"),
  category: text("category"),
  status: text("status").default("available").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Profile = typeof profiles.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type DriverDocument = typeof driverDocuments.$inferSelect;
