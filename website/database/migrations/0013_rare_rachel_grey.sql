CREATE TABLE `timing_point_cells` (
	`timing_point_id` integer NOT NULL,
	`h3_index` text NOT NULL,
	PRIMARY KEY(`timing_point_id`, `h3_index`),
	FOREIGN KEY (`timing_point_id`) REFERENCES `timing_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `timing_point_cells_h3_idx` ON `timing_point_cells` (`h3_index`);--> statement-breakpoint
ALTER TABLE `events` ADD `h3_cell` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `device_h3Cell_dateString_idx` ON `events` (`device_id`,`h3_cell`,`date_string`);--> statement-breakpoint
ALTER TABLE `timing_points` ADD `anchor_cell` text DEFAULT '' NOT NULL;