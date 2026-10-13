# Operating [music]

Backups, restores, upgrades, health checks, and who can read what inside the container. The
examples assume a container named `music` with its data in a volume or folder mounted at `/data`;
on NixOS the container is also named `music` and its data lives in `services.music.dataDir`
(`/var/lib/music`).

## What lives in `/data`

| Path              | Contents                                                 | Owner (in the container) |
| ----------------- | -------------------------------------------------------- | ------------------------ |
| `convex/`         | The database (`db.sqlite3`) and Convex file storage      | `convex` (uid 901), 700  |
| `media/`          | Artwork and the transcode cache; both can be rebuilt     | `music` (PUID), 750      |
| `secrets/`        | Generated instance secret, admin key, and media secret   | root, 700                |
| `backups/`        | `pre-*.zip` exports taken before upgrades                | root, 700                |
| `build`/`version` | The build and version the last successful start deployed | root                     |

Your music is never in `/data`: it is mounted read-only (at `/music` in the examples) and never
written to.

## Backups

**Automatic, before every upgrade.** Each image carries a build identity: a hash of the Convex
functions, schema, and migrations it deploys, and of the Convex backend it runs. On start, when it
differs from the one recorded in `/data/build`, the container exports the database to
`/data/backups/pre-<version>-<build>-<time>.zip` _before_ it deploys anything, so a `:main` image
with a schema change is backed up just like a release. A failed export stops the start. A start
that fails after the export reuses that backup when it retries, rather than taking (and pruning
for) another one.

Only the newest `BACKUP_KEEP` backups (default `5`) are kept; set `BACKUP_KEEP=0` to keep all of
them. A restart of the same image takes no backup.

**On demand.** Export the database while the container runs:

```sh
docker exec music sh -c 'cd /app/backend && CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
  CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat /data/secrets/admin_key)" \
  ./node_modules/.bin/convex export --path /data/backups/manual-$(date +%Y%m%d).zip'
```

Copy backups somewhere else (`docker cp music:/data/backups ./music-backups`, or from the host
folder you mounted at `/data`). The exports hold every account, playlist, and API key hash, so keep
them private.

**Whole volume.** For a full copy, including secrets and artwork, stop the container and archive
the volume:

```sh
docker stop music
docker run --rm -v music-data:/data -v "$PWD":/backup debian:trixie-slim \
  tar -C /data -czf /backup/music-data.tar.gz .
docker start music
```

## Restore

A `pre-*.zip` holds the data as the _previous_ version stored it. To undo an upgrade, go back to
the image that wrote it, then import it:

1. Start the previous image on the same volume (see [Pin a version](#pin-a-version)). It deploys
   its own functions again (and backs up the current data first).
2. Replace the database with the backup:

   ```sh
   docker exec music sh -c 'cd /app/backend && CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
     CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat /data/secrets/admin_key)" \
     ./node_modules/.bin/convex import --replace-all -y /data/backups/pre-0.2.0-<build>-<time>.zip'
   ```

   `--replace-all` replaces every table in the backup, including accounts and sessions, with
   its contents. A file from outside the container must be copied in first:
   `docker cp ./backup.zip music:/data/backups/`.

3. Restart (`docker restart music`) so every service starts from the restored data.

The same import restores a backup into a new install: start the image on an empty volume, wait
for it to report healthy, and import. People sign in again; their API keys keep working.

## Upgrade

Images on `ghcr.io/lmdevv/music` are published only after every CI check has passed:

| Tag           | What it is                                             |
| ------------- | ------------------------------------------------------ |
| `0.2.0`       | A release. Never changes.                              |
| `0.2`         | The newest release in that minor series.               |
| `latest`      | The newest release.                                    |
| `main`        | The newest commit on `main`. Moves often; for testing. |
| `sha-<short>` | One commit from `main` or a release.                   |

### Pin a version

Run a release tag such as `0.2.0` and change it to upgrade. Every start of a new build backs up
first, so upgrading (or going back) is: change the tag, then recreate the container.

### Docker

```sh
docker pull ghcr.io/lmdevv/music:0.2.0
docker rm -f music
docker run -d --name music -p 8080:8080 -v music-data:/data -v /path/to/music:/music:ro \
  -e PUBLIC_URL=https://music.example.com ghcr.io/lmdevv/music:0.2.0
```

### Docker Compose

Set the tag in `compose.yaml` (`image: ghcr.io/lmdevv/music:0.2.0`), then:

```sh
docker compose pull && docker compose up -d
```

With a moving tag (`latest` or `main`), `docker compose pull && docker compose up -d` fetches and
starts the new image.

### NixOS

The module runs the image with `virtualisation.oci-containers`, which pulls an image once and
keeps using that copy: a moving tag such as `main` does **not** update on its own. Either pin a
release and change it to upgrade:

```nix
services.music.image = "ghcr.io/lmdevv/music:0.2.0";
```

or keep a moving tag and have it pulled on every service start, then restart the service (named
`podman-music` or `docker-music`, after `virtualisation.oci-containers.backend`):

```nix
services.music = {
  image = "ghcr.io/lmdevv/music:latest";
  pull = "newer"; # or "always"
};
```

```sh
sudo systemctl restart podman-music
```

## Health

`GET /healthz` answers `200` with `{"ok":true,"convex":true,"ffmpeg":true,...}` only while Caddy,
the media service, and Convex all work: Caddy proxies it to the media service's health check,
which queries Convex and checks ffmpeg. It answers `502` while the media service is down or still
starting and `503` when it cannot reach Convex or run ffmpeg. Point uptime monitors at it.

The image's `HEALTHCHECK` uses the same endpoint every 30 seconds, with a 120-second start period,
so `docker ps` shows `healthy` once everything is up. A first start, or an upgrade with a large
database to back up, can take longer than the start period; the container is not restarted for
being unhealthy unless your orchestrator does so.

Logs from every service go to the container's output: `docker logs -f music` (or
`journalctl -u podman-music` on NixOS).

## Permissions

Every service runs as its own unprivileged user; only the start-up script runs as root.

| Process                    | User                    | Reads                           | Writes             |
| -------------------------- | ----------------------- | ------------------------------- | ------------------ |
| Start-up (`/app/bin/init`) | root                    | everything                      | secrets, backups   |
| Convex backend             | `convex` (uid/gid 901)  | its copy of the instance secret | `/data/convex`     |
| Caddy (port 8080)          | `caddy` (uid/gid 902)   | its config and the web app      | nothing persistent |
| Media service and ffmpeg   | `music` (`PUID`/`PGID`) | your music, its own env file    | `/data/media`      |

- `PUID`/`PGID` (default 1000; the NixOS module's `uid`/`gid`) must be able to read your music;
  ordinary `644` files in `755` folders are fine. They cannot be 0, 901, or 902.
- Ownership is fixed on every start: `/data/media` goes to the media user (also after `PUID`
  changes), and `/data/convex` to the Convex user (earlier images ran Convex as root).
- The media service, which parses every file in your library with ffmpeg, cannot read the
  database, the secrets, or the backups. The Convex instance secret, which would let a process
  become a Convex admin, is never on a command line (any process can read every other's in
  `/proc`): the backend and the key generator read it from a file through a small preloaded
  shim. CI checks that the media user cannot find it in any `/proc/*/cmdline` or
  `/proc/*/environ`.
- Container ports bypass a NixOS firewall; the module publishes on `127.0.0.1` unless
  `openFirewall` is set.
