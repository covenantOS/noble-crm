CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`kind` text DEFAULT 'doc' NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text,
	`content_type` text,
	`uploaded_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color_primary` text,
	`color_secondary` text,
	`logo_r2_key` text,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`zip` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`stripe_customer_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_customers_name` ON `customers` (`name`);--> statement-breakpoint
CREATE TABLE `estimate_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1,
	`unit_price` real DEFAULT 0,
	`total` real DEFAULT 0,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text,
	`customer_id` integer NOT NULL,
	`brand_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` real DEFAULT 0,
	`tax_rate` real DEFAULT 0,
	`tax_amount` real DEFAULT 0,
	`total` real DEFAULT 0,
	`valid_until` text,
	`notes` text,
	`signature_r2_key` text,
	`approved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_invoice_lines_invoice` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`customer_id` integer NOT NULL,
	`job_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
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
CREATE UNIQUE INDEX `invoices_identifier_unique` ON `invoices` (`identifier`);--> statement-breakpoint
CREATE INDEX `idx_invoices_customer` ON `invoices` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_job` ON `invoices` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_status` ON `invoices` (`status`);--> statement-breakpoint
CREATE TABLE `job_checklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`label` text NOT NULL,
	`checked` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_job_checklist_job` ON `job_checklist` (`job_id`);--> statement-breakpoint
CREATE TABLE `job_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_job_materials_job` ON `job_materials` (`job_id`);--> statement-breakpoint
CREATE TABLE `job_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_job_notes_job` ON `job_notes` (`job_id`);--> statement-breakpoint
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
	`price` real DEFAULT 0 NOT NULL,
	`address` text DEFAULT '',
	`notes` text DEFAULT '',
	`completion_notes` text DEFAULT '',
	`is_recurring` integer DEFAULT 0 NOT NULL,
	`recurrence_interval` text DEFAULT '',
	`next_recurrence_date` text DEFAULT '',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`brand_id` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technician_id`) REFERENCES `technicians`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_type_id`) REFERENCES `service_types`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_identifier_unique` ON `jobs` (`identifier`);--> statement-breakpoint
CREATE INDEX `idx_jobs_customer` ON `jobs` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_technician` ON `jobs` (`technician_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_service_type` ON `jobs` (`service_type_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_scheduled_date` ON `jobs` (`scheduled_date`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`in_stock` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`method` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`surcharge_amount` real DEFAULT 0,
	`processor_ref` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `service_agreements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`brand_id` integer,
	`service_type_id` integer,
	`interval` text NOT NULL,
	`next_run_date` text,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_type_id`) REFERENCES `service_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `service_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`default_duration` integer DEFAULT 60 NOT NULL,
	`default_price` real DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#6b7280' NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`brand_id` integer,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `technicians` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#16a34a' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`user_id` text
);
