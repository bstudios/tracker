DROP INDEX `h3_idx`;--> statement-breakpoint
DROP INDEX `device_dateString_h3_idx`;--> statement-breakpoint
CREATE INDEX `access_passwords_lower_password_idx` ON `access_passwords` (lower("password"));