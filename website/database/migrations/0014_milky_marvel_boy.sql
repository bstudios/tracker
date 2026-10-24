DROP TABLE `timing_point_h3_cells`;--> statement-breakpoint
DROP INDEX `timing_point_cells_h3_idx`;--> statement-breakpoint
CREATE INDEX `timing_point_cells_h3_idx` ON `timing_point_cells` (`h3_index`,`timing_point_id`);--> statement-breakpoint
ALTER TABLE `timing_points` DROP COLUMN `latitude`;--> statement-breakpoint
ALTER TABLE `timing_points` DROP COLUMN `longitude`;--> statement-breakpoint
ALTER TABLE `timing_points` DROP COLUMN `h3_index`;--> statement-breakpoint
ALTER TABLE `timing_points` DROP COLUMN `radius`;