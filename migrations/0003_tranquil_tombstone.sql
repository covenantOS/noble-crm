ALTER TABLE `customers` ADD `status` text DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `source` text;
