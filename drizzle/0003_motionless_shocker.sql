CREATE TABLE `media_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`show_title` text,
	`season_number` integer,
	`episode_number` integer,
	`duration_ms` integer,
	`thumb_url` text,
	`position_ms` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`quality` text DEFAULT '1080p-8' NOT NULL,
	`subtitle_mode` text DEFAULT 'auto' NOT NULL,
	`played_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_history_source_item_idx` ON `media_history` (`source_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `media_history_played_idx` ON `media_history` (`played_at`);--> statement-breakpoint
CREATE INDEX `media_history_completed_idx` ON `media_history` (`completed`);