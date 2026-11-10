# OpenFolk wake agent

Your relay runs on a server, your computers sleep at home, and the Wake-on-LAN packet that would wake them cannot
travel from the server into your network: routers do not pass it on. The wake agent is a small program on a device
in your home network that stays on anyway, for example a Raspberry Pi. It connects to your relay by itself, so
nothing has to be opened on your router, and sends the packet when the relay asks, for a routine with "wake" or a tap
on "Wake" in the app.

It can do nothing else. It only ever gets "wake <MAC address>" for the machines in the relay's `WAKE_MACHINES`, never a
chat, a file or a key, and it needs no npm packages: one file, Node 22 or newer.

## On the relay

In the relay's `.env` (or the environment of its container):

```sh
WAKE_METHOD=agent
WAKE_AGENT_TOKEN=<at least 32 random characters, e.g. from: openssl rand -hex 24>
WAKE_MACHINES=desktop=AA:BB:CC:DD:EE:FF,laptop=11:22:33:44:55:66
```

The names are the `MACHINE_NAME`s of your backends, the MAC addresses those of their network cards (`ipconfig /all`
on Windows, `ip link` on Linux). Restart the relay; its log says `waking via agent for desktop, laptop`. Until an agent
is connected the app shows "No wake agent is connected" in the machines' status.

## On the Raspberry Pi

Any Raspberry Pi with Raspberry Pi OS (a Zero 2 W is plenty), wired or on Wi-Fi in the same network as the computers.
Install Node 22 (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs`), then:

```sh
sudo mkdir -p /opt/openfolk-wake && sudo curl -fsSL -o /opt/openfolk-wake/wake-agent.mjs \
  https://raw.githubusercontent.com/OpenFolk/OpenFolk/main/wake-agent/wake-agent.mjs
sudo tee /etc/openfolk-wake.env >/dev/null <<'EOF'
RELAY_URL=https://bots.example.com
WAKE_AGENT_TOKEN=<the same token as on the relay>
EOF
sudo chmod 600 /etc/openfolk-wake.env
sudo tee /etc/systemd/system/openfolk-wake.service >/dev/null <<'EOF'
[Unit]
Description=OpenFolk wake agent
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
EnvironmentFile=/etc/openfolk-wake.env
ExecStart=/usr/bin/node /opt/openfolk-wake/wake-agent.mjs
DynamicUser=yes
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now openfolk-wake
journalctl -u openfolk-wake -f      # "connected to wss://… as "raspberrypi""
```

Test it: put a computer to sleep and tap "Wake" on it in the app. The agent's log says `woke desktop (…)`.

## Settings

| Variable | |
| --- | --- |
| `RELAY_URL` | The address of your relay, as in the browser (`https://…`). |
| `WAKE_AGENT_TOKEN` | The same as on the relay. |
| `WOL_ADDRESS` | Where the packet goes, default `255.255.255.255`. In a network with several subnets the broadcast address of the computers' one, e.g. `192.168.1.255`. |
| `WOL_PORT` | Default `9`. |
| `AGENT_NAME` | The name in the relay's log, default the host name. |

Other always-on devices work the same: a NAS or a home server with Node, or a container (`node:22-alpine` with
`--network host`, since the broadcast has to reach the home network). Several agents, one per network, may be
connected at once; every wake goes to all of them.

## What goes over the connection

The agent opens `wss://<relay>/ws/wake` and signs in with its first message, `{"type":"auth","token":…,"name":…}`; a
wrong token closes the connection (4003) and counts against the relay's login throttle. Then the relay sends
`{"type":"wake","id":…,"machine":"desktop","mac":"aa:bb:cc:dd:ee:ff"}` and the agent answers
`{"type":"woken","id":…,"ok":true}` (or `"ok":false` with `"error"`). It reconnects by itself, after 5 s, and up to
every 5 minutes while the relay cannot be reached or refuses it.
