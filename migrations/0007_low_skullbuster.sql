-- Cents migration: convert every money column from real (decimal dollars) to
-- integer (whole cents). Each table's data is converted via an explicit
-- UPDATE ... SET col = CAST(ROUND(col * 100) AS INTEGER) BEFORE that table is
-- rebuilt (SQLite can't ALTER COLUMN TYPE directly) -- the UPDATE runs against
-- the OLD real-typed table so its existing decimal values (e.g. 110.0) are
-- multiplied by 100 and rounded to a whole-cents integer (11000) BEFORE the
-- rebuild. Columns that are NOT money (tax_rate, quantity, measurement,
-- in_stock) are left untouched.
--
-- NOTE on foreign_keys vs defer_foreign_keys: D1 runs every migration file as
-- one implicit transaction, and SQLite's `PRAGMA foreign_keys` is a documented
-- no-op when set inside a transaction (confirmed against this D1 instance --
-- it silently stayed ON). `PRAGMA defer_foreign_keys=ON`, by contrast, IS
-- honored mid-transaction (also confirmed) and defers FK enforcement to
-- COMMIT, then auto-resets to OFF.
--
-- NOTE on table-rebuild pattern (confirmed by direct experimentation against
-- this exact D1/miniflare-SQLite instance, with real FK-referencing data
-- present -- not just an empty-table check): drizzle-kit's normal
-- "CREATE __new_x -> INSERT INTO __new_x SELECT ... FROM x -> DROP x ->
-- ALTER TABLE __new_x RENAME TO x" pattern reliably FAILS the deferred FK
-- check at commit -- even with defer_foreign_keys=ON -- whenever `x` is the
-- REFERENCED (parent) side of a live foreign key from another table also
-- being touched in this same migration. The rename-based rebuild works fine
-- for the referencING (child) side, and works fine for a parent table with no
-- live children pointing at it. It does NOT work for a parent table that DOES
-- have live FK-referencing rows, regardless of statement order or of
-- defer_foreign_keys. The fix that DOES work in every tested case: rebuild
-- that table with a direct "UPDATE ... -> DROP TABLE x -> CREATE TABLE x
-- (same name, no __new_ staging table) -> INSERT INTO x ..." sequence
-- instead of the rename dance.
--
-- Of the tables touched below, four are BOTH being rebuilt AND referenced by
-- another rebuilt-in-this-migration table's FK, so they use the direct
-- drop/create/insert pattern: estimates (referenced by estimate_lines),
-- invoices (referenced by invoice_lines, payments), jobs (referenced by
-- change_orders, invoices, job_materials), materials (referenced by
-- job_materials). Every other table here (change_orders, estimate_lines,
-- estimate_surfaces, invoice_lines, job_materials, payments, products) has no
-- OTHER rebuilt-in-this-migration table pointing at it, so the standard
-- __new_x/rename pattern is used for those, unchanged from drizzle-kit's
-- generated form.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint

-- ── change_orders (child of jobs -- rebuilt via rename; jobs itself is
-- rebuilt further below via the direct pattern) ──
UPDATE `change_orders` SET `amount` = CAST(ROUND(`amount` * 100) AS INTEGER) WHERE `amount` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_change_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_change_orders`("id", "job_id", "description", "amount", "status", "created_at") SELECT "id", "job_id", "description", "amount", "status", "created_at" FROM `change_orders`;--> statement-breakpoint
DROP TABLE `change_orders`;--> statement-breakpoint
ALTER TABLE `__new_change_orders` RENAME TO `change_orders`;--> statement-breakpoint
CREATE INDEX `idx_change_orders_job` ON `change_orders` (`job_id`);--> statement-breakpoint

-- ── estimate_lines (child of estimates -- rename pattern) ──
UPDATE `estimate_lines` SET `unit_price` = CAST(ROUND(`unit_price` * 100) AS INTEGER) WHERE `unit_price` IS NOT NULL;--> statement-breakpoint
UPDATE `estimate_lines` SET `total` = CAST(ROUND(`total` * 100) AS INTEGER) WHERE `total` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_estimate_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1,
	`unit_price` integer DEFAULT 0,
	`total` integer DEFAULT 0,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_estimate_lines`("id", "estimate_id", "description", "quantity", "unit_price", "total") SELECT "id", "estimate_id", "description", "quantity", "unit_price", "total" FROM `estimate_lines`;--> statement-breakpoint
DROP TABLE `estimate_lines`;--> statement-breakpoint
ALTER TABLE `__new_estimate_lines` RENAME TO `estimate_lines`;--> statement-breakpoint

-- ── estimate_surfaces (child of estimate_rooms, which is NOT touched in this
-- migration -- rename pattern is safe) ──
UPDATE `estimate_surfaces` SET `labor_cost` = CAST(ROUND(`labor_cost` * 100) AS INTEGER) WHERE `labor_cost` IS NOT NULL;--> statement-breakpoint
UPDATE `estimate_surfaces` SET `material_cost` = CAST(ROUND(`material_cost` * 100) AS INTEGER) WHERE `material_cost` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_estimate_surfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`surface_type` text NOT NULL,
	`measurement` real DEFAULT 0 NOT NULL,
	`prep_notes` text,
	`coats` integer DEFAULT 2 NOT NULL,
	`paint_product` text,
	`labor_cost` integer DEFAULT 0 NOT NULL,
	`material_cost` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`generated_line_id` integer,
	FOREIGN KEY (`room_id`) REFERENCES `estimate_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_estimate_surfaces`("id", "room_id", "surface_type", "measurement", "prep_notes", "coats", "paint_product", "labor_cost", "material_cost", "sort_order", "generated_line_id") SELECT "id", "room_id", "surface_type", "measurement", "prep_notes", "coats", "paint_product", "labor_cost", "material_cost", "sort_order", "generated_line_id" FROM `estimate_surfaces`;--> statement-breakpoint
DROP TABLE `estimate_surfaces`;--> statement-breakpoint
ALTER TABLE `__new_estimate_surfaces` RENAME TO `estimate_surfaces`;--> statement-breakpoint
CREATE INDEX `idx_estimate_surfaces_room` ON `estimate_surfaces` (`room_id`);--> statement-breakpoint

-- ── estimates (PARENT of estimate_lines, rebuilt above -- direct
-- drop/create/insert pattern, NOT the rename dance) ──
UPDATE `estimates` SET `subtotal` = CAST(ROUND(`subtotal` * 100) AS INTEGER) WHERE `subtotal` IS NOT NULL;--> statement-breakpoint
UPDATE `estimates` SET `tax_amount` = CAST(ROUND(`tax_amount` * 100) AS INTEGER) WHERE `tax_amount` IS NOT NULL;--> statement-breakpoint
UPDATE `estimates` SET `total` = CAST(ROUND(`total` * 100) AS INTEGER) WHERE `total` IS NOT NULL;--> statement-breakpoint
UPDATE `estimates` SET `deposit_amount` = CAST(ROUND(`deposit_amount` * 100) AS INTEGER) WHERE `deposit_amount` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__estimates_staging` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text,
	`customer_id` integer NOT NULL,
	`brand_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` integer DEFAULT 0,
	`tax_rate` real DEFAULT 0,
	`tax_amount` integer DEFAULT 0,
	`total` integer DEFAULT 0,
	`valid_until` text,
	`notes` text,
	`signature_r2_key` text,
	`approved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`public_token` text,
	`signed_at` text,
	`signed_name` text,
	`signed_ip` text,
	`deposit_amount` integer
);
--> statement-breakpoint
INSERT INTO `__estimates_staging`("id", "identifier", "customer_id", "brand_id", "status", "subtotal", "tax_rate", "tax_amount", "total", "valid_until", "notes", "signature_r2_key", "approved_at", "created_at", "public_token", "signed_at", "signed_name", "signed_ip", "deposit_amount") SELECT "id", "identifier", "customer_id", "brand_id", "status", "subtotal", "tax_rate", "tax_amount", "total", "valid_until", "notes", "signature_r2_key", "approved_at", "created_at", "public_token", "signed_at", "signed_name", "signed_ip", "deposit_amount" FROM `estimates`;--> statement-breakpoint
DROP TABLE `estimates`;--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text,
	`customer_id` integer NOT NULL,
	`brand_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` integer DEFAULT 0,
	`tax_rate` real DEFAULT 0,
	`tax_amount` integer DEFAULT 0,
	`total` integer DEFAULT 0,
	`valid_until` text,
	`notes` text,
	`signature_r2_key` text,
	`approved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`public_token` text,
	`signed_at` text,
	`signed_name` text,
	`signed_ip` text,
	`deposit_amount` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `estimates`("id", "identifier", "customer_id", "brand_id", "status", "subtotal", "tax_rate", "tax_amount", "total", "valid_until", "notes", "signature_r2_key", "approved_at", "created_at", "public_token", "signed_at", "signed_name", "signed_ip", "deposit_amount") SELECT "id", "identifier", "customer_id", "brand_id", "status", "subtotal", "tax_rate", "tax_amount", "total", "valid_until", "notes", "signature_r2_key", "approved_at", "created_at", "public_token", "signed_at", "signed_name", "signed_ip", "deposit_amount" FROM `__estimates_staging`;--> statement-breakpoint
DROP TABLE `__estimates_staging`;--> statement-breakpoint

-- ── invoice_lines (child of invoices, rebuilt below -- rename pattern) ──
UPDATE `invoice_lines` SET `unit_price` = CAST(ROUND(`unit_price` * 100) AS INTEGER) WHERE `unit_price` IS NOT NULL;--> statement-breakpoint
UPDATE `invoice_lines` SET `total` = CAST(ROUND(`total` * 100) AS INTEGER) WHERE `total` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_invoice_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_invoice_lines`("id", "invoice_id", "description", "quantity", "unit_price", "total") SELECT "id", "invoice_id", "description", "quantity", "unit_price", "total" FROM `invoice_lines`;--> statement-breakpoint
DROP TABLE `invoice_lines`;--> statement-breakpoint
ALTER TABLE `__new_invoice_lines` RENAME TO `invoice_lines`;--> statement-breakpoint
CREATE INDEX `idx_invoice_lines_invoice` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint

-- ── job_materials (child of jobs AND materials, both rebuilt below via the
-- direct pattern -- rename pattern here is fine since job_materials itself
-- isn't referenced by anything else in this migration) ──
UPDATE `job_materials` SET `unit_cost` = CAST(ROUND(`unit_cost` * 100) AS INTEGER) WHERE `unit_cost` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_job_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_job_materials`("id", "job_id", "material_id", "quantity", "unit_cost") SELECT "id", "job_id", "material_id", "quantity", "unit_cost" FROM `job_materials`;--> statement-breakpoint
DROP TABLE `job_materials`;--> statement-breakpoint
ALTER TABLE `__new_job_materials` RENAME TO `job_materials`;--> statement-breakpoint
CREATE INDEX `idx_job_materials_job` ON `job_materials` (`job_id`);--> statement-breakpoint

-- ── payments (child of invoices, rebuilt below -- rename pattern) ──
UPDATE `payments` SET `amount` = CAST(ROUND(`amount` * 100) AS INTEGER) WHERE `amount` IS NOT NULL;--> statement-breakpoint
UPDATE `payments` SET `surcharge_amount` = CAST(ROUND(`surcharge_amount` * 100) AS INTEGER) WHERE `surcharge_amount` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`method` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`surcharge_amount` integer DEFAULT 0,
	`processor_ref` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_payments`("id", "invoice_id", "method", "amount", "surcharge_amount", "processor_ref", "status", "paid_at", "created_at") SELECT "id", "invoice_id", "method", "amount", "surcharge_amount", "processor_ref", "status", "paid_at", "created_at" FROM `payments`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
ALTER TABLE `__new_payments` RENAME TO `payments`;--> statement-breakpoint

-- ── products (child of brands, NOT touched in this migration -- rename
-- pattern is safe) ──
UPDATE `products` SET `unit_cost` = CAST(ROUND(`unit_cost` * 100) AS INTEGER) WHERE `unit_cost` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer,
	`name` text NOT NULL,
	`sku` text,
	`category` text,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "brand_id", "name", "sku", "category", "unit_cost", "unit", "active") SELECT "id", "brand_id", "name", "sku", "category", "unit_cost", "unit", "active" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE INDEX `idx_products_brand` ON `products` (`brand_id`);--> statement-breakpoint

-- ── invoices (PARENT of invoice_lines and payments, both rebuilt above --
-- direct drop/create/insert pattern) ──
UPDATE `invoices` SET `subtotal` = CAST(ROUND(`subtotal` * 100) AS INTEGER) WHERE `subtotal` IS NOT NULL;--> statement-breakpoint
UPDATE `invoices` SET `tax_amount` = CAST(ROUND(`tax_amount` * 100) AS INTEGER) WHERE `tax_amount` IS NOT NULL;--> statement-breakpoint
UPDATE `invoices` SET `total` = CAST(ROUND(`total` * 100) AS INTEGER) WHERE `total` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__invoices_staging` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`customer_id` integer NOT NULL,
	`job_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '',
	`due_date` text DEFAULT '',
	`paid_date` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`brand_id` integer
);
--> statement-breakpoint
INSERT INTO `__invoices_staging`("id", "identifier", "customer_id", "job_id", "status", "subtotal", "tax_rate", "tax_amount", "total", "notes", "due_date", "paid_date", "created_at", "updated_at", "brand_id") SELECT "id", "identifier", "customer_id", "job_id", "status", "subtotal", "tax_rate", "tax_amount", "total", "notes", "due_date", "paid_date", "created_at", "updated_at", "brand_id" FROM `invoices`;--> statement-breakpoint
DROP TABLE `invoices`;--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`customer_id` integer NOT NULL,
	`job_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '',
	`due_date` text DEFAULT '',
	`paid_date` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`brand_id` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `invoices`("id", "identifier", "customer_id", "job_id", "status", "subtotal", "tax_rate", "tax_amount", "total", "notes", "due_date", "paid_date", "created_at", "updated_at", "brand_id") SELECT "id", "identifier", "customer_id", "job_id", "status", "subtotal", "tax_rate", "tax_amount", "total", "notes", "due_date", "paid_date", "created_at", "updated_at", "brand_id" FROM `__invoices_staging`;--> statement-breakpoint
DROP TABLE `__invoices_staging`;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_identifier_unique` ON `invoices` (`identifier`);--> statement-breakpoint
CREATE INDEX `idx_invoices_customer` ON `invoices` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_job` ON `invoices` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_status` ON `invoices` (`status`);--> statement-breakpoint

-- ── jobs (PARENT of change_orders, invoices, job_materials, all rebuilt
-- above -- direct drop/create/insert pattern) ──
UPDATE `jobs` SET `price` = CAST(ROUND(`price` * 100) AS INTEGER) WHERE `price` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__jobs_staging` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`customer_id` integer NOT NULL,
	`technician_id` integer,
	`service_type_id` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`scheduled_date` text DEFAULT (date('now')) NOT NULL,
	`scheduled_time` text DEFAULT '09:00',
	`duration` integer DEFAULT 60 NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`address` text DEFAULT '',
	`notes` text DEFAULT '',
	`completion_notes` text DEFAULT '',
	`is_recurring` integer DEFAULT 0 NOT NULL,
	`recurrence_interval` text DEFAULT '',
	`next_recurrence_date` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`brand_id` integer,
	`end_date` text,
	`warranty_months` integer,
	`warranty_expires_at` text
);
--> statement-breakpoint
INSERT INTO `__jobs_staging`("id", "identifier", "customer_id", "technician_id", "service_type_id", "status", "priority", "scheduled_date", "scheduled_time", "duration", "price", "address", "notes", "completion_notes", "is_recurring", "recurrence_interval", "next_recurrence_date", "created_at", "updated_at", "brand_id", "end_date", "warranty_months", "warranty_expires_at") SELECT "id", "identifier", "customer_id", "technician_id", "service_type_id", "status", "priority", "scheduled_date", "scheduled_time", "duration", "price", "address", "notes", "completion_notes", "is_recurring", "recurrence_interval", "next_recurrence_date", "created_at", "updated_at", "brand_id", "end_date", "warranty_months", "warranty_expires_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`customer_id` integer NOT NULL,
	`technician_id` integer,
	`service_type_id` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`scheduled_date` text DEFAULT (date('now')) NOT NULL,
	`scheduled_time` text DEFAULT '09:00',
	`duration` integer DEFAULT 60 NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`address` text DEFAULT '',
	`notes` text DEFAULT '',
	`completion_notes` text DEFAULT '',
	`is_recurring` integer DEFAULT 0 NOT NULL,
	`recurrence_interval` text DEFAULT '',
	`next_recurrence_date` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`brand_id` integer,
	`end_date` text,
	`warranty_months` integer,
	`warranty_expires_at` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technician_id`) REFERENCES `technicians`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_type_id`) REFERENCES `service_types`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `jobs`("id", "identifier", "customer_id", "technician_id", "service_type_id", "status", "priority", "scheduled_date", "scheduled_time", "duration", "price", "address", "notes", "completion_notes", "is_recurring", "recurrence_interval", "next_recurrence_date", "created_at", "updated_at", "brand_id", "end_date", "warranty_months", "warranty_expires_at") SELECT "id", "identifier", "customer_id", "technician_id", "service_type_id", "status", "priority", "scheduled_date", "scheduled_time", "duration", "price", "address", "notes", "completion_notes", "is_recurring", "recurrence_interval", "next_recurrence_date", "created_at", "updated_at", "brand_id", "end_date", "warranty_months", "warranty_expires_at" FROM `__jobs_staging`;--> statement-breakpoint
DROP TABLE `__jobs_staging`;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_identifier_unique` ON `jobs` (`identifier`);--> statement-breakpoint
CREATE INDEX `idx_jobs_customer` ON `jobs` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_technician` ON `jobs` (`technician_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_service_type` ON `jobs` (`service_type_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_scheduled_date` ON `jobs` (`scheduled_date`);--> statement-breakpoint

-- ── materials (PARENT of job_materials, rebuilt above -- direct
-- drop/create/insert pattern) ──
UPDATE `materials` SET `unit_cost` = CAST(ROUND(`unit_cost` * 100) AS INTEGER) WHERE `unit_cost` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__materials_staging` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`in_stock` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT INTO `__materials_staging`("id", "name", "unit", "unit_cost", "in_stock", "created_at") SELECT "id", "name", "unit", "unit_cost", "in_stock", "created_at" FROM `materials`;--> statement-breakpoint
DROP TABLE `materials`;--> statement-breakpoint
CREATE TABLE `materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`in_stock` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT INTO `materials`("id", "name", "unit", "unit_cost", "in_stock", "created_at") SELECT "id", "name", "unit", "unit_cost", "in_stock", "created_at" FROM `__materials_staging`;--> statement-breakpoint
DROP TABLE `__materials_staging`;
