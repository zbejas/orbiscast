import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDatabase, runMigrations } from '../modules/database/client';
import { loadOrCreateKeys } from '../utils/crypto';
import { SettingsService } from '../modules/settings';
import { createAuthAdapter } from '../web/auth';
import { account, session, user } from '../modules/auth/schema';

/**
 * Small admin CLI for lockout recovery. It never starts the HTTP server.
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const dataDirArg = args.find(arg => arg.startsWith('--data-dir='));
    const dataDir = dataDirArg
        ? resolve(dataDirArg.slice('--data-dir='.length))
        : join(process.cwd(), 'data');
    const command = args.find(arg => !arg.startsWith('--')) ?? 'help';

    const connection = openDatabase(dataDir);
    runMigrations(connection.db);
    const keys = loadOrCreateKeys(dataDir);
    const settings = new SettingsService(connection.db, keys);
    settings.init();
    process.env.TZ = settings.getUi().timezone;

    try {
        if (command === 'auth' && args[1] === 'disable') {
            settings.update({ auth: { enabled: false } });
            console.log('Auth disabled. The WebUI is open again.');
            return;
        }

        if (command === 'auth' && args[1] === 'status') {
            const auth = createAuthAdapter({ db: connection.db, settings });
            const hasUser = await auth.hasUser();
            console.log(`enabled=${settings.isAuthEnabled()} hasUser=${hasUser}`);
            return;
        }

        if (command === 'auth' && args[1] === 'reset') {
            const username = args[2];
            const password = args[3];
            if (!username || !password) {
                console.error('Usage: npm run admin -- auth reset <username> <password>');
                process.exitCode = 1;
                return;
            }

            const auth = createAuthAdapter({ db: connection.db, settings });
            const existing = connection.db.select().from(user).where(eq(user.username, username)).get();
            if (!existing) {
                console.error(`No user named ${username}`);
                process.exitCode = 1;
                return;
            }

            connection.db.delete(session).where(eq(session.userId, existing.id)).run();
            connection.db.delete(account).where(eq(account.userId, existing.id)).run();
            connection.db.delete(user).where(eq(user.id, existing.id)).run();
            await auth.createAdmin(username, password);
            console.log(`Password reset for ${username}. Existing sessions were invalidated.`);
            return;
        }

        console.log('Commands:');
        console.log('  npm run admin -- auth status');
        console.log('  npm run admin -- auth disable');
        console.log('  npm run admin -- auth reset <username> <password>');
        console.log('Add --data-dir=/path to target a different data directory.');
    } finally {
        connection.close();
    }
}

void main().catch(error => {
    console.error(error);
    process.exit(1);
});
