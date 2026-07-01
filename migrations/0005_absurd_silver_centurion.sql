CREATE TABLE `change_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_change_orders_job` ON `change_orders` (`job_id`);--> statement-breakpoint
CREATE TABLE `estimate_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_estimate_rooms_estimate` ON `estimate_rooms` (`estimate_id`);--> statement-breakpoint
CREATE TABLE `estimate_surfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`surface_type` text NOT NULL,
	`measurement` real DEFAULT 0 NOT NULL,
	`prep_notes` text,
	`coats` integer DEFAULT 2 NOT NULL,
	`paint_product` text,
	`labor_cost` real DEFAULT 0 NOT NULL,
	`material_cost` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`generated_line_id` integer,
	FOREIGN KEY (`room_id`) REFERENCES `estimate_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_estimate_surfaces_room` ON `estimate_surfaces` (`room_id`);--> statement-breakpoint
ALTER TABLE `estimates` ADD `deposit_amount` real;