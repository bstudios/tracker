ALTER TABLE `timing_points` ADD `h3_index` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `device_dateString_timestamp_idx` ON `events` (`device_id`,`date_string`,`timestamp`);--> statement-breakpoint
CREATE TABLE `timing_point_h3_cells` (
	`timing_point_id` integer NOT NULL,
	`h3_index` text NOT NULL,
	PRIMARY KEY(`timing_point_id`, `h3_index`),
	FOREIGN KEY (`timing_point_id`) REFERENCES `timing_points`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `timing_point_h3_cells_h3_idx` ON `timing_point_h3_cells` (`h3_index`);