import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'sqlite',
    schema: ['./src/modules/database/schema.ts', './src/modules/auth/schema.ts'],
    out: './drizzle',
    dbCredentials: {
        url: './data/orbiscast.db',
    },
    verbose: true,
    strict: true,
});
