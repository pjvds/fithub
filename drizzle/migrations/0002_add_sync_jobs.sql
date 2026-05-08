CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`platform` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`activities_synced` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_jobs_user_started` ON `sync_jobs` (`user_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_sync_jobs_status` ON `sync_jobs` (`status`);
