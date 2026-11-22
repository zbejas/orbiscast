# Better Auth 1.7.25 research

Better Auth provides the optional WebUI login. This note records the exact APIs, schema, and integration limits used by `src/modules/auth`.

Verified against the installed packages on 2026-11-15:

- `better-auth` 1.7.25
- `@better-auth/drizzle-adapter` 1.7.25
- `drizzle-orm` 0.45.4
- `better-sqlite3` 13.2.0
- Node.js 22.23.2

## Key files

| File | Purpose |
| --- | --- |
| `src/modules/auth/schema.ts` | Drizzle tables for `user`, `session`, `account`, and `verification`, plus inferred row types. |
| `src/modules/auth/index.ts` | `createAuth`, session helpers, and the `toNodeHandler` re-export. |
| `src/modules/auth/setup.ts` | Username and password validation, first-run check, and `createAdmin`. |
| `test/auth/better-auth.test.ts` | Sign-up, sign-in, session, sign-out, duplicate username, and wrong password coverage. |
| `test/auth/setup.test.ts` | Validation limits and first-run admin behavior. |

## APIs used

- `betterAuth` from `better-auth`
- `drizzleAdapter(db, { provider: 'sqlite', schema })` from `better-auth/adapters/drizzle`
- `username()` from `better-auth/plugins`
- `auth.api.signUpEmail({ body })`
- `auth.api.signInUsername({ body })`
- `auth.api.getSession({ headers })`
- `auth.api.signOut({ headers })`
- `toNodeHandler(auth)` and `fromNodeHeaders(req.headers)` from `better-auth/node`
- `auth.$context` followed by `context.adapter.count({ model: 'user' })` for the first-run check

`createAuth` sets `emailAndPassword.autoSignIn` to `false`. A username sign-up creates the user and credential account but no session. The setup flow creates the admin, then the admin signs in explicitly.

## Required schema

Better Auth 1.7.25 needs four tables:

| Table | Columns |
| --- | --- |
| `user` | `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`, `username`, `displayUsername` |
| `session` | `id`, `expiresAt`, `token`, `createdAt`, `updatedAt`, `ipAddress`, `userAgent`, `userId` |
| `account` | `id`, `accountId`, `providerId`, `userId`, `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt` |
| `verification` | `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt` |

Additional constraints used by the module:

- `user.email` is required and unique.
- `user.username` is unique and nullable.
- `user.emailVerified` is a non-null boolean with a default of `false`.
- `session.token` is unique.
- `session.userId` and `account.userId` reference `user.id` with cascade delete.
- `verification` is required by the generated schema even though the username and password flow does not write to it.

## Username plugin behavior

- Sign-up still uses `POST /sign-up/email` and passes `username` and `displayUsername` in the body.
- Sign-in uses `POST /sign-in/username` through `auth.api.signInUsername`.
- Default username limits are 3 to 30 characters.
- The default validator allows letters, numbers, underscores, and dots only.
- Usernames are normalized to lowercase. `displayUsername` keeps the original casing.
- Duplicate usernames fail with `USERNAME_IS_ALREADY_TAKEN`.
- Wrong usernames and wrong passwords both fail with `INVALID_USERNAME_OR_PASSWORD` and HTTP 401.

OrbisCast validates with the same limits before calling Better Auth, so the setup form gets a clear error without a database round trip.

## Email requirement

Better Auth's email and password flow requires a unique email address even when sign-in happens by username. OrbisCast stores:

```text
<lowercase-username>@orbiscast.local
```

The address is not returned by `createAdmin` and must not appear in the WebUI. It is only used to satisfy the `user.email` contract.

## Session cookies

- Cookie name is `better-auth.session_token`.
- The value is signed with the auth secret and is `HttpOnly`.
- Default attributes are `Path=/`, `SameSite=Lax`, and `Max-Age=604800` (7 days).
- With an `https` base URL the cookie gets the `__Secure-` prefix. A local `http` base URL does not.
- Sessions are stored in the `session` table. `signOut` deletes the row and expires the cookie.
- `getSession` reads the cookie from a standard `Headers` object. Use `fromNodeHeaders(req.headers)` in Express.

Tests use `http://127.0.0.1:3100`, so the cookie name has no secure prefix.

## Trusted origins and reverse proxy

- `baseURL` is trusted automatically.
- `trustedOrigins` accepts extra origins. Better Auth also supports wildcard origins.
- Origin checks are disabled when `NODE_ENV` is `test`.
- Behind a reverse proxy, set `baseURL` to the public HTTPS origin. Do not rely on request headers to infer the protocol.
- Enable Express `trust proxy` so client IPs and rate limits use the real address.
- Forward `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto`.
- If the WebUI is served from a different origin than the API, add that origin to `trustedOrigins`.

## Express 5 integration

Mount the Better Auth handler with Express 5 named wildcard syntax:

```ts
app.all('/api/auth/*splat', toNodeHandler(auth));
```

Express 5 uses named wildcards, so `*` is not valid path syntax. `toNodeHandler` expects the raw Node request and response.

The documented setup mounts the handler before body parsers. `better-call` 1.4.5 also falls back to `req.body` when a parser already consumed the stream. Mounting after `express.json()` was verified with Express 5 in this repository, but the raw mount remains the safer default.

## Schema quirks

- The 1.7.25 Drizzle generator emits `integer(..., { mode: 'timestamp_ms' })` by default. OrbisCast uses `mode: 'timestamp'` (seconds) as required. Better Auth passes `Date` objects to the driver and converts them back on read, so both modes work. The table defaults use `unixepoch()` to match seconds. Tested with real sign-up, sign-in, session read, and sign-out.
- The Drizzle adapter resolves columns by their JavaScript property names. Columns named `email_verified`, `created_at`, and similar snake_case names fail runtime schema validation under the Better Auth field names (`emailVerified`, `createdAt`). Keep the Drizzle properties in camelCase or supply explicit `fieldName` mappings.
- Runtime schema validation checks for missing tables, missing columns, and unexpected required columns. It does not validate SQLite column types or timestamp modes.
- Production rate limiting allows 3 requests per 10 seconds to sign-in and sign-up paths. It is disabled outside production, so Vitest does not hit it.

## Integration warnings

- `better-auth` 1.7.25 is ESM-only. This repository compiles to CommonJS. `require('better-auth')` works on Node 22.12 and newer, but `package.json` still declares `node >= 22.4`. Either raise the minimum Node version or move the server build to ESM.
- `drizzle.config.ts` includes both `src/modules/database/schema.ts` and `src/modules/auth/schema.ts`. Keep both entries so generated migrations create the auth tables.
- `createAdmin` checks `hasAnyUser` before sign-up. Concurrent first-run requests are not serialized. The unique username and email columns stop duplicate accounts, but not two different admin usernames.
- `createAdmin` throws `AuthValidationError` for invalid credentials and `AuthSetupError` when an admin already exists. The WebUI should map those to HTTP 400 and 409. It should also skip `createAdmin` when `hasAnyUser` is already true, otherwise enabling auth a second time fails.
- Password reset and email verification are not configured. Enabling them later requires an email sender and a real email address policy.
- The auth secret must be at least 32 characters. `createAuth` rejects shorter secrets. Use a random value; Better Auth warns when it detects low entropy.

## Related docs

- [`../../AGENTS.md`](../../AGENTS.md) covers project conventions and verification commands.
- [`../../src/modules/auth/schema.ts`](../../src/modules/auth/schema.ts) is the canonical table definition.
- [`../../test/auth/better-auth.test.ts`](../../test/auth/better-auth.test.ts) is the executable behavior contract.
