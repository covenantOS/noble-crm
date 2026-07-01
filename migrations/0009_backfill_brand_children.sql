-- Custom data migration (no schema change): backfill the owning brand onto
-- every document table from its customer. Migration 0008 backfilled ONLY
-- customers.brand_id, which left every pre-existing job/invoice/estimate/
-- service agreement with brand_id NULL -- so scoping the app to "Westchase
-- Painting" showed its 7 customers but ZERO of their jobs/invoices/estimates
-- and $0 revenue (list + stats endpoints filter on each table's OWN brand_id
-- column, by design, so a row's brand tag can diverge from its customer's).
--
-- Each UPDATE is guarded by "WHERE brand_id IS NULL" so:
--   * re-running is a no-op (idempotent, same contract as the 0008 backfill);
--   * rows deliberately brand-tagged since Phase 3 are never overwritten;
--   * a row whose customer has no brand simply stays NULL (subquery -> NULL).
UPDATE jobs SET brand_id = (SELECT c.brand_id FROM customers c WHERE c.id = jobs.customer_id) WHERE brand_id IS NULL;--> statement-breakpoint
UPDATE invoices SET brand_id = (SELECT c.brand_id FROM customers c WHERE c.id = invoices.customer_id) WHERE brand_id IS NULL;--> statement-breakpoint
UPDATE estimates SET brand_id = (SELECT c.brand_id FROM customers c WHERE c.id = estimates.customer_id) WHERE brand_id IS NULL;--> statement-breakpoint
UPDATE service_agreements SET brand_id = (SELECT c.brand_id FROM customers c WHERE c.id = service_agreements.customer_id) WHERE brand_id IS NULL;
