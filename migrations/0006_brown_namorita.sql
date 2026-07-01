CREATE TABLE `job_crew` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`technician_id` integer NOT NULL,
	`role` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technician_id`) REFERENCES `technicians`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_job_crew_job` ON `job_crew` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_job_crew_technician` ON `job_crew` (`technician_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_crew_unique` ON `job_crew` (`job_id`,`technician_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer,
	`name` text NOT NULL,
	`sku` text,
	`category` text,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_products_brand` ON `products` (`brand_id`);--> statement-breakpoint
ALTER TABLE `brands` ADD `review_url` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `warranty_months` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `warranty_expires_at` text;--> statement-breakpoint
ALTER TABLE `technicians` ADD `is_subcontractor` integer DEFAULT 0 NOT NULL;