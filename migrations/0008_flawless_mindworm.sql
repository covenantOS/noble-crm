ALTER TABLE `brands` ADD `is_demo` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `brand_id` integer REFERENCES brands(id);--> statement-breakpoint
CREATE INDEX `idx_customers_brand` ON `customers` (`brand_id`);--> statement-breakpoint
-- Backfill: every pre-existing customer belongs to the original Westchase
-- Painting account (slug confirmed against src/server/seed-brands.sql).
-- Guarded by "WHERE brand_id IS NULL" so re-running is a no-op, and the
-- subquery resolves to NULL harmlessly if the brand seed hasn't run yet.
UPDATE customers SET brand_id = (SELECT id FROM brands WHERE slug = 'westchase-painting') WHERE brand_id IS NULL;
