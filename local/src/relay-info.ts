// What the relay told this backend about itself in relay_hello, for the status the web app shows (backend_status).

/** The relay's version as its last relay_hello said; '' before the first one and for a relay before 0.9.0. */
export const relayInfo = { version: '' };

/** A version of the form `1.2.3` (optionally with `-beta.1` and the like) from a frame, or '' for anything else. */
export function cleanRelayVersion(v: unknown): string {
    return typeof v === 'string' && v.length <= 40 && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v) ? v : '';
}
