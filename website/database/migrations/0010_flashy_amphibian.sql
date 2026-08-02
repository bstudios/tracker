ALTER TABLE `devices` ADD `input_speed_unit` text DEFAULT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `display_speed_unit` text DEFAULT 'mph' NOT NULL;