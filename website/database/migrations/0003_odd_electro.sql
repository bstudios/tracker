CREATE TABLE `access_passwords` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`password` text NOT NULL,
	`allowed_dates` text DEFAULT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_passwords_password_unique` ON `access_passwords` (`password`);
