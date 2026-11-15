CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`stable_key` text NOT NULL,
	`tvg_id` text,
	`name` text NOT NULL,
	`logo` text,
	`group_title` text,
	`stream_url` text NOT NULL,
	`country` text,
	`visible` integer DEFAULT false NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `iptv_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_source_stable_idx` ON `channels` (`source_id`,`stable_key`);--> statement-breakpoint
CREATE INDEX `channels_visible_idx` ON `channels` (`visible`);--> statement-breakpoint
CREATE INDEX `channels_source_idx` ON `channels` (`source_id`);--> statement-breakpoint
CREATE TABLE `discord_guild_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`allowed_role_ids` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `iptv_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`playlist_url` text NOT NULL,
	`xmltv_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`refresh_minutes` integer DEFAULT 1440 NOT NULL,
	`last_refreshed_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plex_libraries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_key` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plex_libraries_library_key_unique` ON `plex_libraries` (`library_key`);--> statement-breakpoint
CREATE TABLE `plex_queue_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`rating_key` text NOT NULL,
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
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plex_queue_position_idx` ON `plex_queue_items` (`position`);--> statement-breakpoint
CREATE INDEX `plex_queue_status_idx` ON `plex_queue_items` (`status`);--> statement-breakpoint
CREATE TABLE `programmes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`channel_tvg_id` text NOT NULL,
	`start` text NOT NULL,
	`stop` text NOT NULL,
	`start_timestamp` integer NOT NULL,
	`stop_timestamp` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`subtitle` text,
	`episode_num` text,
	`season` integer,
	`episode` integer,
	`icon` text,
	`image` text,
	`date` text,
	`previously_shown` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `iptv_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `programmes_channel_time_idx` ON `programmes` (`source_id`,`channel_tvg_id`,`start_timestamp`);--> statement-breakpoint
CREATE INDEX `programmes_time_idx` ON `programmes` (`start_timestamp`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
