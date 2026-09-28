CREATE INDEX "idx_drivers_status_available" ON "drivers" USING btree ("status","available");--> statement-breakpoint
CREATE INDEX "idx_fraud_events_user_type" ON "fraud_events" USING btree ("user_id","event_type");--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_wallet_created" ON "ledger_entries" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ledger_tx_wallet_created" ON "ledger_transactions" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_promotion_redemptions_ride" ON "promotion_redemptions" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "idx_ride_location_events_ride" ON "ride_location_events" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "idx_rides_passenger_created" ON "rides" USING btree ("passenger_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_rides_driver_created" ON "rides" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_rides_status_created" ON "rides" USING btree ("status","created_at");