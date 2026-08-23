import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";

export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey().$defaultRandom(),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  color: text("color"),
  plate: text("plate").notNull().unique(),
  vehicleType: text("vehicle_type").notNull().default("car"), // car or motorcycle
  category: text("category"),
  status: text("status").default("available").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Vehicle = typeof vehicles.$inferSelect;