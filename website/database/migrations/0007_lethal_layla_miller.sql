-- SQLite cannot ADD a NOT NULL column that has a REFERENCES clause (such a column must default to
-- NULL), so device_id is added as nullable, backfilled, and the table then rebuilt with NOT NULL.
-- The rebuild also drops the now unused applicable_dates column.
ALTER TABLE `timing_points` ADD `device_id` integer REFERENCES devices(id);--> statement-breakpoint
UPDATE `timing_points`
SET `device_id` = (SELECT MIN(`id`) FROM `devices`)
WHERE `device_id` IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_timing_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`device_id` integer NOT NULL,
	`order` integer DEFAULT 99999 NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`h3_index` text DEFAULT '' NOT NULL,
	`radius` integer DEFAULT 10 NOT NULL,
	`icon` text DEFAULT NULL,
	`google_link` text DEFAULT NULL,
	`group` text DEFAULT 'Other Timing Points',
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_timing_points`("id", "name", "device_id", "order", "latitude", "longitude", "h3_index", "radius", "icon", "google_link", "group")
SELECT "id", "name", "device_id", "order", "latitude", "longitude", "h3_index", "radius", "icon", "google_link", "group" FROM `timing_points`;--> statement-breakpoint
DROP TABLE `timing_points`;--> statement-breakpoint
ALTER TABLE `__new_timing_points` RENAME TO `timing_points`;--> statement-breakpoint
CREATE INDEX `timing_points_device_idx` ON `timing_points` (`device_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
