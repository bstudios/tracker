ALTER TABLE `timing_points` ADD `icon` text DEFAULT NULL;--> statement-breakpoint
ALTER TABLE `timing_points` ADD `google_link` text DEFAULT NULL;--> statement-breakpoint
ALTER TABLE `timing_points` ADD `group` text DEFAULT 'Other Timing Points';

CREATE TABLE `access_passwords` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`password` text NOT NULL,
	`allowed_dates` text DEFAULT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_passwords_password_unique` ON `access_passwords` (`password`);
