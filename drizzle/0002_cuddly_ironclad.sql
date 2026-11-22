CREATE TABLE `media_libraries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`library_key` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_libraries_source_key_idx` ON `media_libraries` (`source_id`,`library_key`);--> statement-breakpoint
CREATE INDEX `media_libraries_source_idx` ON `media_libraries` (`source_id`);--> statement-breakpoint
CREATE TABLE `media_queue_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`show_title` text,
	`season_number` integer,
	`episode_number` integer,
	`duration_ms` integer,
	`thumb_url` text,
	`quality` text DEFAULT '1080p-8' NOT NULL,
	`subtitle_mode` text DEFAULT 'auto' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_queue_position_idx` ON `media_queue_items` (`position`);--> statement-breakpoint
CREATE INDEX `media_queue_status_idx` ON `media_queue_items` (`status`);--> statement-breakpoint
CREATE INDEX `media_queue_source_idx` ON `media_queue_items` (`source_id`);--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`token_encrypted` text DEFAULT '' NOT NULL,
	`token_last4` text DEFAULT '' NOT NULL,
	`client_identifier` text DEFAULT '' NOT NULL,
	`user_id` text,
	`user_name` text,
	`channel_name` text NOT NULL,
	`idle_minutes` integer DEFAULT 5 NOT NULL,
	`empty_grace_seconds` integer DEFAULT 30 NOT NULL,
	`default_quality` text DEFAULT '1080p-8' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_sources_kind_idx` ON `media_sources` (`kind`);--> statement-breakpoint
CREATE INDEX `media_sources_enabled_idx` ON `media_sources` (`enabled`);