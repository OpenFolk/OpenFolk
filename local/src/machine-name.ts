// The name a machine signs in to the relay with. The backend (config.ts) and joining (tools/join.mjs) must agree on
// it: the relay binds a machine's agent token to the name it joined with and rejects a sign-in under another one.

/** The relay takes 1 to 32 characters of a-z, 0-9 and '-'; longer host names (macOS CI runners, some Macs) are cut. */
export function machineName(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32).replace(/-+$/, '') || 'home';
}
