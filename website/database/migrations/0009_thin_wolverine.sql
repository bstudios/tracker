CREATE TABLE `logbook_remarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`date_string` text NOT NULL,
	`timestamp` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `logbook_remarks_device_dateString_idx` ON `logbook_remarks` (`device_id`,`date_string`);