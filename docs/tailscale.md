# Tailscale: the agent connection off the internet

Tailscale (a free WireGuard network for your own devices) takes the backend's connection to a relay on a server off
the public internet.

Without Tailscale, the backend at home connects via the relay's public address
(e.g. `wss://relay.example.com/ws/agent`), protected only by `AGENT_TOKEN`. With Tailscale, this connection
runs through the WireGuard network of your machines, and the relay accepts agent logins only from Tailscale
addresses. The browser side stays publicly reachable over HTTPS.

The direction stays the same: the backend opens the connection, nothing is opened on the home router.
Tailscale itself does not need port forwarding either.

The examples below use a Windows machine `desktop` running the backend and a Linux server running the relay
container with the Tailscale address `100.101.102.103`; replace them with your own.

### 1. Create a tailnet

Create an account at <https://login.tailscale.com> (a GitHub or Google login is enough). A tailnet with up to
three users and 100 devices is free.

### 2. Add the backend machine

On Windows:

```powershell
winget install --id tailscale.tailscale -e
```

Then start "Tailscale" from the Start menu and sign in. Check:

```powershell
tailscale status
tailscale ip -4      # own Tailscale address, 100.x.y.z
```

In the admin panel (<https://login.tailscale.com/admin/machines>) set "Disable key expiry" for the machine,
otherwise it is signed out after 180 days.

### 3. Add the relay server

On the server (via SSH):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh=false
tailscale ip -4
```

Confirm the login link from `tailscale up` in the browser and set "Disable key expiry" here as well.
The server's Tailscale address (here `100.101.102.103`) is needed below.

### 4. Make the relay reachable on the Tailscale address

Typically the relay runs as a container behind a reverse proxy (Traefik, Caddy, nginx; for example as a Coolify
application). In addition to the public domain routing, bind the container port directly to the host's Tailscale
address, so that the backend gets in without going through the proxy:

- Port mapping `100.101.102.103:8787:8787` (host IP = the server's Tailscale address, not `0.0.0.0`).
  In Coolify: application → **Ports Mappings**; with plain Docker: `-p 100.101.102.103:8787:8787`.
- Set the environment variable `AGENT_ALLOWED_FROM=100.64.0.0/10`. The relay then rejects every agent login
  that does not come from the Tailscale range; via the public domain the proxy passes the real source address,
  which is never in the Tailscale range. The relay takes that address from the entry the proxy added to
  `X-Forwarded-For`, and only when the proxy connects from a private address, so a client cannot claim a Tailscale
  address by sending the header itself (`TRUST_PROXY` empty).
- Redeploy the relay.

Check from the server:

```bash
curl -s http://100.101.102.103:8787/health      # {"ok":true}
```

### 5. Switch the backend over

In the project's `.env` on the backend machine:

```
RELAY_URL=ws://100.101.102.103:8787/ws/agent
```

Inside the tailnet the connection is already encrypted (WireGuard), hence `ws://` instead of `wss://`. Restart
the backend; the web app must show the machine as connected, and the relay log shows
`Agent desktop connected from 100.x.y.z` (the machine's Tailscale address).

Counter-check: a login via the public address must fail now:

```powershell
# expected: 401 (even with the correct token) or a dropped connection
curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Bearer <AGENT_TOKEN>" `
  -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" `
  -H "Sec-WebSocket-Key: dGVzdA==" https://relay.example.com/ws/agent
```

### Troubleshooting

- **Machine shown as offline although the backend runs:** run `tailscale status` on both sides; if the server
  shows the machine as "offline", restarting the Tailscale service on the machine usually helps.
- **Relay log "Agent login rejected from …" with a 100.x address:** the token does not match (compare
  `AGENT_TOKEN` in the relay's environment and in the backend's `.env`).
- **Rejected with a public address:** `RELAY_URL` still points to the domain instead of the Tailscale address.
