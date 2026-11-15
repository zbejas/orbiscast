# Security Policy

## Reporting a vulnerability

Please report suspected security vulnerabilities on the [Issues](https://github.com/zbejas/orbiscast/issues) page. You can also contact the maintainer at the email address in the GitHub profile.

Do not open a public issue for a live token, session cookie, or a vulnerability that exposes one.

## Supported versions

Only the latest release and the `master` branch receive fixes. The Docker image is rebuilt on release.

## What OrbisCast stores

- **SQLite database:** `data/orbiscast.db` holds settings, IPTV sources and channels, Plex libraries, the queue, and Better Auth sessions.
- **Encryption keys:** `data/keys.json` holds the AES-256-GCM key and the Better Auth secret. It is created with mode `0600`.
- **Encrypted provider tokens:** Discord bot and user tokens and the Plex token are encrypted at rest with AES-256-GCM.
- **Plaintext data:** IPTV source URLs are stored plaintext by decision. They may contain provider credentials. Treat the whole data directory as secret.
- **Logs:** `data/logs/app.log` is redacted for token patterns, but source URLs and other operational metadata can appear.
- **Cache:** `data/cache/` holds downloaded playlists, guides, and the generated Plex placeholder clip.

Losing `data/keys.json` makes saved provider tokens unrecoverable. Back up the whole data directory and restrict access to the host and the Docker volume.

## Self-bot risk

OrbisCast uses a Discord user token to send video. This violates Discord's Terms of Service and can get the account banned. Use a secondary account and accept the risk. Never commit a real token.

## Deployment guidance

- The WebUI has no authentication by default. Enable it in Settings before exposing the app outside a trusted network.
- Put the app behind HTTPS when it is reachable from the internet.
- Do not expose the streaming library's ZMQ port, `42069`.
- Keep Node.js and the Docker base image current.
- Do not run a second instance with the same Discord tokens or the same data directory.
- Rotate any token that appears in a log, screenshot, issue, or commit.

## Reporting a leaked credential

Remove the value from the source, rotate it with the provider, and check `data/logs/app.log` and the WebUI Logs page. Deleting a message or commit is not enough once the value has been copied.

## Admin recovery

If auth is enabled and the password is lost, use the host CLI:

```bash
npm run admin -- auth disable
npm run admin -- auth reset <username> <password>
```

See [docs/operations.md](docs/operations.md) for Docker commands.
