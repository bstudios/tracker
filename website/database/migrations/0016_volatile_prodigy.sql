CREATE TABLE `h3_cell_elevations` (
	`h3_cell` text PRIMARY KEY NOT NULL,
	`elevation_meters` real NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
