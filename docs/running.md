# Running OpenFolk permanently

`npm start` and the desktop apps run everything on one computer. This page is for the next step: a relay of your own
on a server, backends that start with their machine, a backend in a container that never sleeps, several machines,
and the settings for waking and shutting them down. The overview of all setups is in `../README.md` under "Which
setup fits"; every variable is described with comments in `../.env.sample` (backend) and `../relay/.env.sample`
(relay).

## Relay and backends

**Relay:** runs as a container with a persistent volume at `/data` (owner, signed-in devices, machines seen, wake
schedule) and HTTPS in front of port `8787` (WebSockets must pass through). Started without tokens, it waits for its
owner and prints a setup code to its log; claim it from the machine that runs your backend, which hands the relay its
own tokens and writes `RELAY_URL` into the `.env`:

```sh
npm run claim -- https://relay.example.com ABCDE-FGHJK   # address of the relay, setup code from its log
npm run restart                                         # or npm start, if the backend is not running
```

The same from the app, without a terminal: while a backend runs the relay itself, the first steps and the settings
("Devices and security", "Move to a relay on a server") ask for the relay's address and the setup code. The backend
claims the relay, gets a pairing link there for the asking device, writes `RELAY_URL` into its `.env` and moves over
without a restart; the page opens the link and is signed in at the new relay, end-to-end key included. A backend
whose embedded relay has further accounts refuses, since accounts live in the relay and would be lost; move it with
`npm run claim` and invite them again.

The relay keeps only hashes of the tokens (`/data/owner.json`); to hand it to another backend, delete that file and
restart the container. If you prefer to choose the values yourself, set `USER_PASSWORD` (web app password) and
`AGENT_TOKEN` (backends), both at least 16 characters, on the relay and `AGENT_TOKEN` in the backends' `.env`.
Optional: waking (`WAKE_METHOD`, see "Machine settings" below) and `AGENT_ALLOWED_FROM` for Tailscale; the second factor
is set up in the app (Settings, Devices and security); all variables with comments in `relay/.env.sample`.

The relay believes the client address in `X-Forwarded-For` only from a reverse proxy that connects from a private
or loopback address (Docker network, Coolify, nginx on the same host), and then only the entry that proxy added.
That is right for the setups below; with a CDN in front of the proxy set `TRUST_PROXY=2`, to ignore the header
`TRUST_PROXY=0`.

- **Prebuilt image:** `ghcr.io/openfolk/openfolk` for amd64 and arm64; `latest` and `1.2.3` from
  releases, `edge` from `main`.

  ```sh
  docker run -d --name openfolk-relay --restart unless-stopped -p 8787:8787 \
    -v openfolk-relay:/data ghcr.io/openfolk/openfolk:latest
  docker logs openfolk-relay      # the setup code
  ```

- **Docker Compose:** `docker-compose.yml` in the repository root reads the relay's settings (wake, optionally the
  tokens) from a `.env` next to it; fill it from `relay/.env.sample`, not from the backend's `.env`. `docker compose up -d` uses the prebuilt image,
  `docker compose up -d --build` builds from the checkout.
- **Coolify:** add a new resource of the type *Docker Image* `ghcr.io/openfolk/openfolk:latest`, port `8787`, your
  domain, a persistent storage at `/data` and the variables you want; the setup code is in the application's log.
  Alternatively *Public/Private Repository* with build pack *Docker Compose* (Coolify asks for the required
  variables itself; `docker-compose.server.yml` for relay and backend together, see below) or *Dockerfile* with
  `/relay/Dockerfile` and base directory `/`. Coolify's proxy handles HTTPS and WebSockets; `TRUST_PROXY` can
  stay empty.
- **Home server:** Unraid users add `deploy/unraid/openfolk-relay.xml` as a template (Docker, Add Container); Portainer
  and similar take `docker-compose.yml` or `docker-compose.server.yml` straight from this repository as a stack.
- **Own build:** `docker build -f relay/Dockerfile -t openfolk-relay .` from the repository root. The image
  compiles the relay with `tsc` in a build stage and runs plain JavaScript (`npm run build -w relay` does the same
  locally, `npm run start:dist -w relay` starts the result).

The container runs as the user `node`; on start it hands `/data` to that user, so volumes from older images
keep working.

**Backend (Windows):** with the desktop app, "Run without signing in" in its tray menu does this: it asks for
administrator rights once and creates a scheduled task that starts the app's backend at boot, before anyone signs
in, so a woken machine reports by itself. While it is on, the app starts no backend of its own and quitting it
leaves the backend running. From a checkout: set `RELAY_URL=wss://<your relay>/ws/agent` in `.env` and register the
backend as such a task (administrator PowerShell):

```powershell
.\local\tools\install-task.ps1 -Install   # task "openfolk local"
.\local\tools\install-task.ps1 -Start
.\local\tools\install-task.ps1            # status and last log lines (local\data\local.log)
```

After changes to `local/` or `shared/` restart without admin rights; the restart waits until no bot is working:

```powershell
npm run restart -w local -- <reason>   # leaves the request and returns
npm run restart                         # same, but returns only once the backend is running again
```

**Relay and backend on one server:** `docker-compose.server.yml` starts both, the backend talking to the relay
inside the Docker network. Two values in a `.env` next to it are required: `APP_URL`, the public HTTPS address of
the relay (pairing links carry it), and `RELAY_SETUP_CODE`, any 10 or more letters and digits
(`openssl rand -hex 8`); the backend claims the fresh relay with it on its first connection. In Coolify use the
build pack *Docker Compose* with this file, give the `relay` service your domain and port `8787`.

```sh
docker compose -f docker-compose.server.yml up -d
docker compose -f docker-compose.server.yml logs local                         # the code for the first device
```

The first device needs no terminal: the backend prints a code to its log on every start, and the relay's sign-in
page offers "Code from the server log" while the main account has no device. The page sends only its key; the backend
seals the pairing link with that key and the code, so the relay passes on a box it cannot open. Not the setup code:
the relay knows that one. Claude signs in with an Anthropic API key in the first steps, or with its subscription in
the container (`docker compose -f docker-compose.server.yml exec -u node local claude`); `… exec -u node local npm
run pair` makes a pairing link as before.

The backend part works as described in the next paragraph. PCs that should join set `RELAY_URL` to the relay's
public address and copy `E2E_KEY`, `AGENT_TOKEN` and `PUSH_VAPID_*` from the container
(`docker compose -f docker-compose.server.yml exec -u node local npm run env -- --print` shows the lines).

**Backend as a container (Linux):** a machine that never sleeps, e.g. on the server that also hosts the relay.
Bots that live on it work around the clock, and their routines run without waking a PC.
The image `ghcr.io/openfolk/openfolk-local` (amd64 and arm64, tags as for the relay) holds Node, git and the
engines that come with npm (Claude, Codex, Copilot); `docker-compose.local.yml` in the repository root reads the
backend's values from a `.env` next to it, the same values as on every other machine, plus `MACHINE_NAME` for the
name the app shows (default `cloud`). `RELAY_URL` is required here: the image has no relay of its own. A relay
that is still unclaimed is claimed by the container itself when `RELAY_SETUP_CODE` holds the code from its log.

The container's backend prints the code for the main account's first device to its log as well (see above).

```sh
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml exec -u node local claude     # sign in to Claude once (opens no browser: copy the URL)
docker compose -f docker-compose.local.yml exec -u node local npm run pair   # pairing link for one more device
docker compose -f docker-compose.local.yml exec -u node local npx codex login --device-auth   # optional: Codex
docker compose -f docker-compose.local.yml exec -u node local npx copilot login               # optional: Copilot (device code)
docker compose -f docker-compose.local.yml logs -f local
```

Three places keep the state: `/home/node` (the sign-ins; Cursor and Antigravity are installed into it with
`curl https://cursor.com/install -fsS | bash` and `node local/tools/acp-install.mjs antigravity-acp` inside the
container, always as `-u node`), `/data` (`DATA_DIR`: bots, history, knowledge) and `/work` (`ALLOWED_ROOTS`: the folders the bots
work in; set `git config --global user.name` and `user.email` in the container, and a git token in the settings of the machine
because there is no credential manager; "Open changes" in the app warns while a bot's repository host lacks them). The first two are Docker volumes; `/work` is a folder of the host (`WORK_DIR`, default
`./work` next to the compose file), so you can open the bots' folders over SSH or with VS Code Remote. Its files
belong to the container's user `node` (uid 1000); work there as that user or with `sudo`. Instead of signing in inside the container you can also copy
a sign-in file from a machine that is signed in (`~/.claude/.credentials.json`, `~/.codex/auth.json`) into the
home volume. The image cannot shut down (`OPENFOLK_CONTAINER=1`) and `AUTOLOGON_METHOD` is `none`; the relay never needs to wake this
machine. `npm run restart -w local` inside the container ends the process once no bot is working and Docker
starts it again (`restart: unless-stopped`); `docker compose restart` does the same at once. The image has no
Python, so bots on this machine do not transcribe voice messages. A bot for the container gets a folder under
`/work`: choose the container's machine in the bot editor and enter the repository's address as its folder;
saving clones it there.

**Several machines:** every bot lives on one machine and works in a folder there. Nothing moves on its own: while
a bot's machine sleeps, the bot sleeps too, and a bot that should work while your PCs are off lives on a machine
that never sleeps. Machines exchange work the way people do, through git. If a project is worked on from two
machines, each has its own clone with a bot of its own; one pushes, the other pulls, and "Open changes" shows what
has not been pushed or pulled yet. The pulling happens by itself where it is safe: each backend fetches the repos of
its bots on start, after waking, every quarter hour and when another machine pushes from the app, and fast-forwards
the clean ones (a switch in the settings turns it off). Moving a bot to another machine takes its chats along; if it has
work there that is not on the git server yet, the bot editor offers to take that along too. The previous machine
sends it through the relay once the move arrives and sets its uncommitted changes aside (`git stash`); the new one
takes over unpushed commits as a fast-forward, applies the changes if they apply cleanly and parks whatever does not
fit in `.git/openfolk-work/<time>/` of the repo, named in the bot's chat. Nothing is pushed, so no deploy webhook
runs. Both machines need to be awake for it. The bot editor has a folder and a repository field and fills
each from the other on the bot's machine: a folder's origin, or the folder a repository goes to (named after it in the
first folder of `ALLOWED_ROOTS`, or the one that holds it already). Is the folder not there yet, saving clones the
repository into it, so no machine needs a terminal for it.

**One more machine:** in the app, Settings, Machines, "Add machine". A backend that is awake mints a one-time invitation
at the relay (15 minutes) and builds the command with the end-to-end key behind '#', which no server sees. On the new
machine, the desktop app takes the link on its setup page ("Connect this computer to my server"); from a checkout,
after `npm install`: `npm run join -- "<link>"` (`local/tools/join.mjs`). Either redeems it for an agent token of
that machine's own and writes `RELAY_URL`, `AGENT_TOKEN` and `E2E_KEY` into its `.env`; on its first start it takes
the web push key pair from the other machines, encrypted. Then sign in to Claude Code once and install the task. The
machine's token counts for its name only (`MACHINE_NAME`, otherwise the computer name), and "Log out" at the machine in
the settings removes it and disconnects the backend at once.

By hand instead: the same `.env` values on every machine. On the first machine `npm run env` writes the values it
generated (`E2E_KEY`, `AGENT_TOKEN`, the VAPID pair) into its `.env`; copy that `.env` before the next machine
starts, otherwise it generates keys of its own and cannot read the others' sync. Either way several machines need a
relay they all reach: the relay embedded in a backend serves its own computer only.

## Machine settings

Everything around the machines is set with environment variables (all of them with comments in `.env.sample`);
without any of them nothing is woken and shutting down uses the operating system's own command.

**Waking (relay):** `WAKE_METHOD` picks the way.

| Method | What it does | Settings |
| --- | --- | --- |
| `wol` | Sends the Wake-on-LAN packet itself. Needs the relay in the same network, or a router that forwards the UDP port. | `WAKE_MACHINES=desktop=AA:BB:CC:DD:EE:FF,…`, `WOL_ADDRESS`, `WOL_PORT` |
| `command` | Runs your command, e.g. `ssh root@router etherwake {mac}` or a call to a home automation system. | `WAKE_COMMAND` with `{machine}` and `{mac}`, `WAKE_MACHINES` |
| `service` | Asks an external wake service, which also reports whether a machine is running. | `WAKEUP_URL`, `WAKEUP_API_TOKEN` |
| `none` | No waking. | |

The machine names are the backends' `MACHINE_NAME`. For routines with "wake" the relay wakes `WAKE_LEAD_SECONDS`
(180) before the due time.

**Shutting down and restarting (each backend):** how comes from the `.env`: a companion script (`SHUTDOWN_SCRIPT`),
own commands (`SHUTDOWN_COMMAND` with `{seconds}`/`{minutes}`, `SHUTDOWN_CANCEL_COMMAND`, and `SHUTDOWN_RESTART_COMMAND`
for "restart"), otherwise the system's command (Windows `shutdown /s` and `/r`, macOS/Linux `shutdown -h` and `-r`, which
needs the right to shut down there; never in a container). Whether the app may use it, the countdown (60 s) and what
happens after routines the machine was woken for are settings of the machine in the app: shut down if nobody uses it
(default; own check via `MACHINE_IDLE_COMMAND`), always or never, after 300 s. Switched off, the app shows neither "shut
down" nor "restart".

**Automatic sign-in (Windows):** `AUTOLOGON_METHOD=script` with `AUTOLOGON_SCRIPT` shows a switch per machine in
the settings; without it the app says that it is not set up.
