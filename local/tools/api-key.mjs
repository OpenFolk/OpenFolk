// apiKeyHelper of the Claude Code CLI when Claude signs in with the machine's API key: prints the key the backend
// put into the CLI's environment (from the machine settings).
// Via the helper because the CLI otherwise prefers an existing subscription login over ANTHROPIC_API_KEY.
process.stdout.write(process.env.ANTHROPIC_API_KEY ?? '');
