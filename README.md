# OrbisCast

[![GitHub build status](https://img.shields.io/github/actions/workflow/status/zbejas/orbiscast/main.yml?label=main%20build)](https://github.com/zbejas/orbiscast/actions/workflows/main.yml)
[![GitHub build status](https://img.shields.io/github/actions/workflow/status/zbejas/orbiscast/dev.yml?label=dev%20build)](https://github.com/zbejas/orbiscast/actions/workflows/dev.yml)
[![GitHub last commit](https://img.shields.io/github/last-commit/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/commits/main)
[![GitHub issues](https://img.shields.io/github/issues/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/pulls)
[![GitHub license](https://img.shields.io/github/license/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/blob/main/LICENSE.md)
[![Release](https://img.shields.io/github/v/release/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/releases)
[![Repo size](https://img.shields.io/github/repo-size/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/)
[![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/zbejas/orbiscast?sort=date)](https://hub.docker.com/r/zbejas/orbiscast)
[![Docker Pulls](https://img.shields.io/docker/pulls/zbejas/orbiscast)](https://hub.docker.com/r/zbejas/orbiscast)
[![CodeFactor](https://www.codefactor.io/repository/github/zbejas/orbiscast/badge)](https://www.codefactor.io/repository/github/zbejas/orbiscast)

**OrbisCast** is a Discord bot that streams IPTV channels. It can be controlled by users with [commands](#commands) specified at the end of this document.

The bot was made to simplify watch parties with friends. It is also useful for testing IPTV channels without the need for a dedicated IPTV player.

This project is still in development, so expect bugs and missing features. If you find any issues, please report them in the [Issues](https://github.com/zbejas/orbiscast/issues) section.

> [!CAUTION]
> I am not responsible for any misuse of this tool. Ensure to comply with all applicable copyright laws and obtain necessary permissions for the IPTV content being streamed.
>
> _Using self-bots is against [Discord's terms of service](https://discord.com/guidelines) and may result in account termination. Use at your own risk._

## Installation

### Before you start

You will need to set a few things up before you can run the bot:

- Create a bot on the [Discord Developer Portal](https://discord.com/developers/applications) and get the bot token, and invite the bot to your server.
  - You can follow the instructions [here](https://discordpy.readthedocs.io/en/stable/discord.html) to create a bot and get the token and invite link. Make sure to give the bot the necessary permissions:
    - `bot`
    - `applications.commands`
    - In the [Developer Portal](https://discord.com/developers/applications), go to your bot's settings and enable the `Message Content Intent`.
- Get the user token from the Discord web client.
  - The user token is required to join the voice channel and stream video. It is recommended to use a secondary account for this purpose.
    - The user has to manually join the server.
  - You can get the token by checking this [gist](https://gist.github.com/MarvNC/e601f3603df22f36ebd3102c501116c6#file-get-discord-token-from-browser-md) I found, or by using a tool like [Discord Get User Token](https://chromewebstore.google.com/detail/discord-get-user-token/accgjfooejbpdchkfpngkjjdekkcbnfd).
  - **Note**: Be careful when using any third-party tools to get your user token, as they may be malicious. I recommend using the method in the gist.
- Create a `.env` file in the project directory and fill in the required environment variables (see below). You can use the provided `.env.example` file as a template.

> [!WARNING]
> Do not share any of the tokens mentioned above with anyone. If you do, regenerate them immediately by:
>
> - Regenerating the bot token in the [Discord Developer Portal](https://discord.com/developers/applications).
> - Regenerating the user token by logging out and back in to Discord.
>   - If you used incognito mode to get the token, you can go to Discord Settings > Devices > Log out of all known devices (or just log out of the specific session).

### Docker

In the repo is a provided `compose.yml` file that can be used to run the bot.
Copy the file and fill in the required environment variables or create a `.env` file in the same directory as the `compose.yml` file.

Then, run the following command to start the bot:

```bash
docker compose up
```

or to run it in the background:

```bash
docker compose up -d
```

> [!TIP]
> You can check the logs using:
>
> ```bash
> docker compose logs -f
> ```
>
> _The `-f` flag is optional and is used to follow the logs._

All of the app data is stored in `/app/data`. The cache is stored in `/app/cache` or RAM, depending on the `RAM_CACHE` and `CACHE_DIR` environment variables.

You can check the available tags on the [Docker Hub page](https://hub.docker.com/r/zbejas/orbiscast/tags?ordering=name).

### Manual

> [!IMPORTANT]
> The following instructions are for running the bot manually. If you are using Docker, you can skip this section. [Bun](https://bun.sh/) is required, so make sure to install it before proceeding.

The project can also be run manually. To do so, first download the project and install the dependencies:

```bash
git clone https://github.com/zbejas/orbiscast
cd orbiscast
bun install
```

Start the bot using:

```bash
bun run start
```

## Environment Variables

The application uses the following environment variables, which should be defined in a `.env` file (see `.env.example`):

### System and IPTV Configuration

| Variable           | Description                                      | Example/Default                          | Required |
|--------------------|--------------------------------------------------|------------------------------------------|----------|
| `PLAYLIST`         | URL to the M3U playlist.                         | `http://example.com/m3u/playlist.m3u`    | ✔        |
| `XMLTV`            | URL to the XMLTV guide.                          | `http://example.com/xmltv/guide.xml`     | ✔        |
| `REFRESH_IPTV`     | Interval in minutes to refresh the IPTV data.    | `1440`                                   | ✘        |
| `RAM_CACHE`        | Whether to use RAM for caching.                  | `true`                                  | ✘        |
| `CACHE_DIR`        | Directory for cache storage.                     | `../cache`                               | ✘        |
| `DEBUG`            | Enable debug mode.                               | `false`                                  | ✘        |
| `DEFAULT_STREAM_TIMEOUT` | Default stream timeout (when alone in channel) in minutes.            | `10`                                     | ✘        |
| `TZ`               | Timezone for the container. Example: `Europe/Ljubljana`                      | `UTC`                                    | ✘        |
| `MINIMIZE_LATENCY` | Minimize latency for the stream.                 | `true`                                   | ✘        |
| `BITRATE_VIDEO`    | Video bitrate in Kbps.                           | `5000`                                   | ✘        |
| `BITRATE_VIDEO_MAX`| Maximum video bitrate in Kbps.                   | `7500`                                   | ✘        |

### Discord Configuration

The reason we have a `bot` and a `user` token is because the current Discord API does not allow bots to stream video. The bot is used to control the user, which is the one that actually streams the video.

| Variable              | Description                                      | Example/Default                          | Required |
|-----------------------|--------------------------------------------------|------------------------------------------|----------|
| `DISCORD_BOT_TOKEN`           | Token for the Discord bot.                       | `YOUR_BOT_TOKEN_HERE`                    | ✔        |
| `DISCORD_USER_TOKEN`  | Token for the Discord user.                      | `YOUR_USER_TOKEN_HERE`                   | ✔        |
| `GUILD`               | Discord guild (server) ID.                       | `000000000000000000`                     | ✔        |

## Commands

The bot can be controlled using the following commands:

| Command | Description |
|---------|-------------|
| `/stream <channe>` | Start streaming the specified channel. |
| `/programme <channel>` | Show the current programme for the specified channel. If no channel is all channels will be listed. |
| `/channels <page>` | List all available channels. Page is optional. |
| `/stop` | Stop the current stream. |
| `/refresh <type>` | Refresh the specified data. Type can be "all", "channels", or "programme". |

> [!TIP]
> The available channels will be shown when tab-completing the channel name, but only up to 25 channels will be shown at a time, since Discord limits the number of options in a command. Use the `/channels` command to see all available channels, and then either navigate from there or use the channel name directly.

## Known Issues

If your issue is not listed here and you think it should be, please check the [Issues](https://github.com/zbejas/orbiscast/issues) section. If it is not there, please open a new issue.

- The streamer hangs if the stream is killed from the source side. I have not yet found a way to detect this, so the only remedy is to restart the bot for now.

> [!NOTE]
> In my testing, I've been using [Threadfin](https://github.com/Threadfin/Threadfin) as my IPTV provider. I'm not sure if it works with other providers, but it theoretically should. Also, this tool was not built or tested with a large number of channels in mind, so it may not work as expected if you overload it with data.
