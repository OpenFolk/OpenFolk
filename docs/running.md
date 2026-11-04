# Running OpenFolk permanently

`npm start` and the desktop apps run everything on one computer. This page is for the next step: a relay of your own
on a server, backends that start with their machine, a backend in a container that never sleeps, several machines,
and the settings for waking and shutting them down. The overview of all setups is in `../README.md` under "Which
setup fits"; every variable is described with comments in `../.env.sample` (backend) and `../relay/.env.sample`
(relay). A German five-step guide for a relay of your own is in `README.de.md` ("Dauerbetrieb").

**Desktop app or checkout?** Every `npm run …` command on this page (`claim`, `pair`, `join`, `restart`, `env`) belongs
to a checkout of the source and runs in the `openfolk` folder after `npm install`; in a shell without a checkout it
fails. The desktop app has no checkout and does each of those steps in its interface: claiming a relay in the first
steps or under Settings → "Devices and security" → "Move to a relay on a server", pairing a device under "Pair another
device", joining a further computer with the link from "Add machine" on the app's setup page ("Connect this computer to
my server"), restart and "Run without signing in" in the tray menu. Its `.env` lives in the app's profile folder
(Windows `%APPDATA%\OpenFolk`, macOS `~/Library/Application Support/OpenFolk`, Linux `~/.config/OpenFolk`), never in a
checkout. Do not pick "Display only: connect to an existing relay server" on the setup page to use a relay of your own
with the bots on this computer: that way the app starts no backend here and the bots go offline.

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
  Alternatively *Public/Private Repository* with build pack *Docker Compose* (`docker-compose.coolify.yml` for
  relay and backend together, see below) or *Dockerfile* with `/relay/Dockerfile` and base directory `/`. Coolify's
  proxy handles HTTPS and WebSockets; `TRUST_PROXY` can stay empty.
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
(`openssl rand -hex 8`); the backend claims the fresh relay with it on its first connection.

```sh
docker compose -f docker-compose.server.yml up -d
docker compose -f docker-compose.server.yml logs local                         # the code for the first device
```

In Coolify take `docker-compose.coolify.yml` instead, with the build pack *Docker Compose* or pasted into an
*Empty Docker Compose*: it pulls the prebuilt images rather than building both on the server, publishes no host
port and has Coolify generate the setup code. Give the `relay` service your domain with port 8787
(`https://bots.example.com:8787`) and set `APP_URL` to the same address without the port. Coolify hands every
variable of the resource to both containers, so engine keys set there reach the relay too; enter them in the app's
first steps or in the terminal of `local` instead.

The first device needs no terminal: the backend prints a code to its log on every start, and the relay's sign-in
page offers "Code from the server log" while the main account has no device. The page sends only its key; the backend
seals the pairing link with that key and the code, so the relay passes on a box it cannot open. Not the setup code:
the relay knows that one. Claude signs in with an Anthropic API key in the first steps, or with its subscription in
the container (`docker compose -f docker-compose.server.yml exec -u node local claude`); `… exec -u node local npm
run pair` makes a pairing link as before. The bots on that server see the connectors of the claude.ai account
signed in there (Gmail, Drive …) only if the machine settings let them in; an account of its own for the server
keeps them out for good.

**Other services on the same host:** from inside a container, the Docker gateway (`172.17.0.1` and the like) reaches
every port of the host that listens on all addresses, such as SSH, a Coolify dashboard or a database. The firewall of
the hosting provider sits in front of the host and does not filter this way. A bot runs shell commands in the backend
container, so on a host with other services bind them to `127.0.0.1` or protect them with their own sign-in, or
block the containers' networks in the host firewall (`DOCKER-USER` chain with iptables).

The backend part works as described in the next paragraph. PCs that should join set `RELAY_URL` to the relay's
public address and copy `E2E_KEY`, `AGENT_TOKEN` and `PUSH_VAPID_*` from the container
(`docker compose -f docker-compose.server.yml exec -u node local npm run env -- --print` shows the lines).

**Server size:** the relay alone needs about 30 MB of memory while idle and under 200 MB at its peak, next to no
CPU and under 200 MB of disk; it fits next to anything on the smallest VPS. A backend in a container idles at about
200 MB of memory and next to no CPU. The models compute at their providers, so CPU load comes only from what the
bots run themselves (installs, builds, tests). Every bot at work adds an engine process; plan with a few hundred MB
for each bot working at the same time (an estimate, not a measurement). For relay and backend together take at least
2 GB of memory, 4 GB for several bots at once, one or two cores and about 10 GB of disk: the backend image is about
1.9 GB, an update briefly keeps a second one, and the bots' repositories in `/work` grow with use.

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

## Allowed folders

`ALLOWED_ROOTS` in a machine's `.env` lists the folders bots may be created in, separated by `;`; without it, the home
folder of the user the backend runs as. A bot's folder outside of them is refused, in every account, with the reason
(`Folder is not under …`), and the app hands out files from these folders only. Where the variable lives: a checkout
in its `.env`, the desktop app in the `.env` of its profile folder (above), a container in the `.env` next to the
compose file; there `/work` is the allowed folder and `WORK_DIR` the host folder behind it. The backend names the
folders in its log on start; restart it after a change. The bot editor's folder field takes a folder that exists
there or a repository address, which the backend clones into the first allowed folder; there is no folder browser yet.

## Git access

The backend runs without a terminal, often as a task before anyone signs in or in a container, so it can never answer a
password prompt; its own git and SSH calls are started so that they fail instead of asking (`GIT_TERMINAL_PROMPT=0`,
no askpass), and a bot's shell has no terminal either. For bots to clone and push, credentials have to be there
without a prompt:

- **HTTPS remotes** on your own PC: push once in a terminal so the credential manager of Windows or macOS knows the
  sign-in; that is enough while the backend runs in your signed-in session. As a task without a sign-in, in a
  container and on a Linux server set a git token (GitHub, GitLab, Forgejo, Gitea) in the settings of the machine under
  "Pushing with git" instead: host (the host name only, e.g. `git.example.com`), user, token. The token travels to the
  machine end-to-end encrypted only and sits in the environment of the bots' sessions there, never in `.git/config`.
  "Open changes" warns while the host of a bot's repository has no access.
- **SSH remotes** need a key that asks for no passphrase: an SSH agent in the backend's session. On a Mac the desktop
  app ("Start on this computer") inherits the agent launchd provides, and a key in the keychain
  (`ssh-add --apple-use-keychain ~/.ssh/id_ed25519`) loads without a prompt. On Windows the service "OpenSSH
  Authentication Agent" keeps the keys loaded with `ssh-add` for your user. Without a signed-in session (task,
  container, server) there usually is no agent: switch the remote to HTTPS and set a token, or put a key without a
  passphrase into `~/.ssh` of the user the backend runs as.
- The backend checks on start, hourly and after a change whether it can push to the hosts of its bots (HTTPS only;
  SSH it cannot judge) and says so in "Open changes" and its log.

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
