ALTER TABLE `events` ADD `date_string` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `events` ADD `latitude` real NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `events` ADD `longitude` real NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `events` ADD `h3_index` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `h3_idx` ON `events` (`h3_index`);--> statement-breakpoint
CREATE INDEX `device_dateString_h3_idx` ON `events` (`device_id`,`date_string`,`h3_index`);