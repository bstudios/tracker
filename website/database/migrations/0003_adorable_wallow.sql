CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT NULL,
	`icon` text DEFAULT NULL,
	`match_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_name_unique` ON `devices` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_match_id_unique` ON `devices` (`match_id`);--> statement-breakpoint
INSERT INTO `devices` (`name`, `description`, `icon`, `match_id`) VALUES ('Default Device', NULL, NULL, 'default-device');--> statement-breakpoint
ALTER TABLE `events` ADD `device_id` integer REFERENCES devices(id);--> statement-breakpoint
UPDATE `events`
SET `device_id` = (SELECT `id` FROM `devices` WHERE `match_id` = 'default-device')
WHERE `device_id` IS NULL;--> statement-breakpoint
ALTER TABLE `access_passwords` ADD `device_id` integer REFERENCES devices(id);--> statement-breakpoint
UPDATE `access_passwords`
SET `device_id` = (SELECT `id` FROM `devices` WHERE `match_id` = 'default-device')
WHERE `device_id` IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`data` text NOT NULL,
	`device_id` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "timestamp", "data", "device_id")
SELECT "id", "timestamp", "data", "device_id" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
CREATE TABLE `__new_access_passwords` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`password` text NOT NULL,
	`allowed_dates` text DEFAULT NULL,
	`device_id` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_access_passwords`("id", "password", "allowed_dates", "device_id")
SELECT "id", "password", "allowed_dates", "device_id" FROM `access_passwords`;--> statement-breakpoint
DROP TABLE `access_passwords`;--> statement-breakpoint
ALTER TABLE `__new_access_passwords` RENAME TO `access_passwords`;--> statement-breakpoint
CREATE UNIQUE INDEX `access_passwords_password_unique` ON `access_passwords` (`password`);--> statement-breakpoint
PRAGMA foreign_keys=ON;