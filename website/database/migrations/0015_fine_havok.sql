CREATE TABLE `logbook_crew_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`date_string` text NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `logbook_crew_changes_device_dateString_idx` ON `logbook_crew_changes` (`device_id`,`date_string`);--> statement-breakpoint
CREATE INDEX `logbook_crew_changes_device_timestamp_idx` ON `logbook_crew_changes` (`device_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `logbook_crew_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`crew_change_id` integer NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`crew_change_id`) REFERENCES `logbook_crew_changes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `logbook_crew_members_crewChangeId_idx` ON `logbook_crew_members` (`crew_change_id`);--> statement-breakpoint
CREATE INDEX `logbook_crew_members_name_idx` ON `logbook_crew_members` (`name`);