# Security policy

OpenFolk runs coding agents on your own machines and exposes them to your phone through a relay. A vulnerability
can therefore reach your files and your model credentials. We take reports seriously and ask for one thing in
return: report privately first.

## Reporting a vulnerability

Write to **security@openfolk.app** or use GitHub's private vulnerability reporting on this repository
(*Security → Report a vulnerability*). Please do not open a public issue or pull request for a security problem.

Include what you can: the affected part (relay, backend, web app, an app, an engine adapter), steps to reproduce,
the impact you see, and a version or commit. A proof of concept helps; a working exploit against someone else's
installation is not needed and not welcome.

You will get an acknowledgement within three working days and a decision on how we handle the report within ten.
We keep you informed and credit you in the release notes unless you prefer otherwise.

## Scope

In scope: everything in this repository, including the relay container image, the backend, the web app, the
desktop and mobile apps and the protocol between them.

Out of scope: the agent runtimes themselves (Claude Code, Codex, Cursor, Copilot, Antigravity) and the services
behind them, the hosting of your own relay, and attacks that need an already compromised machine or a person with
your password and your end-to-end key.

## Supported versions

OpenFolk is an early release. Fixes go into `main` and the next release; there are no maintained older branches.
Keep the relay and the backends on the latest release.

## What the design assumes

The threat model is described in `docs/internals/overview.md`. In short: the relay is untrusted for contents
(with end-to-end encryption on, it sees routing only), the backend trusts nothing a client sends without checking
it, and a device key or pairing link is as sensitive as the password.
