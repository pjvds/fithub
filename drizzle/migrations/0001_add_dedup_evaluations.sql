CREATE TABLE `dedup_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`compared_to_id` text,
	`confidence` integer NOT NULL,
	`outcome` text NOT NULL,
	`reasoning_json` text NOT NULL,
	`evaluated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dedup_eval_activity` ON `dedup_evaluations` (`activity_id`,`compared_to_id`,`outcome`);--> statement-breakpoint
CREATE INDEX `idx_dedup_eval_user_time` ON `dedup_evaluations` (`user_id`,`evaluated_at`);