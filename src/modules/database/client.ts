import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseConnection {
    sqlite: Database.Database;
    db: Db;
    path: string;
    close: () => void;
}

/**
 * Opens the SQLite database and applies the runtime pragmas the app expects.
 *
 * @param dataDir - Directory that owns orbiscast.db
 * @returns SQLite handle, Drizzle client, and a close function
 */
export function openDatabase(dataDir: string): DatabaseConnection {
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, 'orbiscast.db');
    const sqlite = new Database(path);

    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('synchronous = NORMAL');

    const db = drizzle(sqlite, { schema });

    return {
        sqlite,
        db,
        path,
        close: () => sqlite.close(),
    };
}

/**
 * Runs every pending Drizzle migration.
 *
 * @param db - Drizzle client
 * @param migrationsFolder - Folder containing the generated SQL migrations
 */
export function runMigrations(db: Db, migrationsFolder = join(process.cwd(), 'drizzle')): void {
    migrate(db, { migrationsFolder });
}

/**
 * Returns true when the database has no operator data yet.
 *
 * Used by the one-time .env importer. A database with a source, a token, or an
 * explicit settings row is considered configured.
 *
 * @param sqlite - Raw SQLite handle
 * @returns True when the database is still pristine
 */
export function isDatabasePristine(sqlite: Database.Database): boolean {
    const sources = sqlite.prepare('SELECT COUNT(*) AS count FROM iptv_sources').get() as { count: number };
    if (sources.count > 0) {
        return false;
    }
    const rows = sqlite.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number };
    return rows.count === 0;
}
