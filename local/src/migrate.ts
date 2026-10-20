// Migration of the data written by older versions with German keys, values and file names (data version 1) to the
// English format (data version 2), and of the single owner's data into the account folder accounts/main/ (data
// version 3). migrateDataDir() runs once at startup before anything reads data; it is idempotent and leaves a
// marker in data-version.json. The same mapping functions translate snapshots, history and
// peer data that arrive from machines still running the old code, so they can keep syncing.
//
// The German names below are data, not identifiers: they are exactly the keys and values old versions wrote.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { withId } from './history.ts';
import { removeTree } from './remove-tree.ts';
import { DEFAULT_ACCOUNT } from './store.ts';
import type { HistoryEntry, KnowledgeFact, PeerData, Snapshot } from '../../shared/protocol.ts';

export const DATA_VERSION = 3;
const VERSION_FILE = 'data-version.json';

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

/** Renames keys of an object (old → new); an existing new key wins over the old one. */
function renameKeys(o: Obj, map: Record<string, string>): Obj {
    const r: Obj = {};
    for (const [k, v] of Object.entries(o)) {
        const n = map[k] ?? k;
        if (n !== k && n in o) continue;
        r[n] = v;
    }
    return r;
}

const mapValue = (v: unknown, map: Record<string, string>): unknown => (typeof v === 'string' && v in map ? map[v] : v);

// ------------------------------------------------------------------ value tables

const APPROVAL: Record<string, string> = { nie: 'never', riskant: 'risky', schreiben: 'write' };
const ROUTINE_STATUS: Record<string, string> = { fehler: 'error', 'läuft': 'running' };
const PUSH_KIND: Record<string, string> = { fertig: 'done', freigabe: 'approval', wach: 'awake' };
const PUSH_PRIORITY: Record<string, string> = { aus: 'off', leise: 'quiet', hoch: 'high' };
const SCOPE: Record<string, string> = { ordner: 'folder', gruppe: 'group', alle: 'all' };
const KNOWLEDGE_TYPE: Record<string, string> = { nutzer: 'user', arbeitsweise: 'workstyle', projekt: 'project', verweis: 'reference', notiz: 'note' };
/** Sender 'ich' ("me") of old entries. */
const from = (v: unknown): unknown => (v === 'ich' ? 'me' : v);

// ------------------------------------------------------------------ single shapes

export function migrateConversation(c: unknown): unknown {
    return isObj(c) ? renameKeys(c, { titel: 'title', archiviert: 'archived' }) : c;
}

export function migrateBot(b: unknown): unknown {
    if (!isObj(b)) return b;
    const r = renameKeys(b, { favorit: 'favorite', stumm: 'muted', rechner: 'machine', nurDort: 'machineOnly', unterhaltungen: 'conversations' });
    r.approval = mapValue(r.approval, APPROVAL);
    if (Array.isArray(r.conversations)) r.conversations = r.conversations.map(migrateConversation);
    return r;
}

export function migrateGroup(g: unknown): unknown {
    return isObj(g) ? renameKeys(g, { favorit: 'favorite', stumm: 'muted' }) : g;
}

export function migrateRoutine(x: unknown): unknown {
    if (!isObj(x)) return x;
    const r = renameKeys(x, { wecken: 'wake' });
    r.lastStatus = mapValue(r.lastStatus, ROUTINE_STATUS);
    if (r.lastStatus === undefined) delete r.lastStatus;
    return r;
}

function migrateAttachment(a: unknown): unknown {
    return isObj(a) ? renameKeys(a, { rechner: 'machine', dauerMs: 'durationMs' }) : a;
}

function migrateTool(t: unknown): unknown {
    return isObj(t) ? renameKeys(t, { nachladen: 'deferred' }) : t;
}

function migrateQuote(q: unknown): unknown {
    if (!isObj(q)) return q;
    const r = renameKeys(q, { von: 'from' });
    r.from = from(r.from);
    return r;
}

/**
 * A history entry. Entries from before ids existed get their id fixed first: it is derived from the content,
 * and the content (sender 'ich' → 'me') changes here.
 */
export function migrateEntry(e: unknown): unknown {
    if (!isObj(e)) return e;
    const r = renameKeys(withId(e as unknown as HistoryEntry) as unknown as Obj, {
        sprache: 'voice', gelesen: 'readAt', verschoben: 'movedTo', geloescht: 'deletedAt', verworfen: 'discardedAt', antwortAuf: 'replyTo',
    });
    if ('from' in r) r.from = from(r.from);
    if (r.replyTo !== undefined) r.replyTo = migrateQuote(r.replyTo);
    if (Array.isArray(r.attachments)) r.attachments = r.attachments.map(migrateAttachment);
    if (Array.isArray(r.tools)) r.tools = r.tools.map(migrateTool);
    return r;
}

export function migrateEntries(list: unknown): HistoryEntry[] {
    return Array.isArray(list) ? list.map(migrateEntry) as HistoryEntry[] : [];
}

function migratePinnedEntry(e: unknown): unknown {
    if (!isObj(e)) return e;
    const r = renameKeys(e, { von: 'from' });
    r.from = from(r.from);
    return r;
}

export function migratePinned(state: unknown): unknown {
    if (!isObj(state)) return state;
    const r: Obj = {};
    for (const [chatId, s] of Object.entries(state)) {
        if (!isObj(s)) continue;
        const x = renameKeys(s, { eintraege: 'entries' });
        if (Array.isArray(x.entries)) x.entries = x.entries.map(migratePinnedEntry);
        r[chatId] = x;
    }
    return r;
}

export function migrateSeen(state: unknown): unknown {
    if (!isObj(state)) return state;
    const r: Obj = {};
    for (const [chatId, s] of Object.entries(state)) r[chatId] = isObj(s) ? renameKeys(s, { bis: 'until', ungelesen: 'unread' }) : s;
    return r;
}

export function migratePushSettings(s: unknown): unknown {
    if (!isObj(s)) return s;
    const r = renameKeys(s, { arten: 'kinds' });
    if (isObj(r.kinds)) {
        const kinds: Obj = {};
        for (const [k, v] of Object.entries(r.kinds)) {
            const n = mapValue(k, PUSH_KIND) as string;
            if (n !== k && n in r.kinds) continue;
            kinds[n] = mapValue(v, PUSH_PRIORITY);
        }
        r.kinds = kinds;
    }
    return r;
}

/** Knowledge location in text form: 'alle' → 'all', 'ordner/x' → 'folder/x', 'gruppe/x' → 'group/x'. */
export function migrateLocationText(k: string): string {
    const [first, ...rest] = k.split('/');
    return [SCOPE[first] ?? first, ...rest].join('/');
}

export function migrateTombstones(d: unknown): unknown {
    if (!isObj(d)) return d;
    const r: Obj = {};
    for (const [k, v] of Object.entries(d)) {
        const n = k.startsWith('wissen:') ? `knowledge:${migrateLocationText(k.slice(7))}` : k.startsWith('knowledge:') ? `knowledge:${migrateLocationText(k.slice(10))}` : k;
        if (!(n in r) || String(v) > String(r[n])) r[n] = v;
    }
    return r;
}

export function migrateFact(f: unknown): unknown {
    if (!isObj(f)) return f;
    const r = renameKeys(f, { beschreibung: 'description', typ: 'type' });
    r.type = mapValue(r.type, KNOWLEDGE_TYPE);
    return r;
}

export function migrateFacts(facts: unknown): Record<string, KnowledgeFact> | undefined {
    if (!isObj(facts)) return undefined;
    const r: Record<string, KnowledgeFact> = {};
    for (const [k, f] of Object.entries(facts)) r[migrateLocationText(k)] = migrateFact(f) as KnowledgeFact;
    return r;
}

/** Snapshot of another machine; already English snapshots pass unchanged. */
export function migrateSnapshot(input: Snapshot): Snapshot {
    if (!isObj(input)) return input;
    const s = renameKeys(input as unknown as Obj, { wissen: 'knowledge', pushEinstellungen: 'pushSettings', verlauf: 'history', fixiert: 'pinned', gesehen: 'seen' });
    if (Array.isArray(s.bots)) s.bots = s.bots.map(migrateBot);
    if (Array.isArray(s.groups)) s.groups = s.groups.map(migrateGroup);
    if (Array.isArray(s.routines)) s.routines = s.routines.map(migrateRoutine);
    if (s.knowledge !== undefined) s.knowledge = migrateFacts(s.knowledge);
    if (s.deleted !== undefined) s.deleted = migrateTombstones(s.deleted);
    if (s.pushSettings !== undefined) s.pushSettings = migratePushSettings(s.pushSettings);
    if (s.pinned !== undefined) s.pinned = migratePinned(s.pinned);
    if (s.seen !== undefined) s.seen = migrateSeen(s.seen);
    if (isObj(s.history)) {
        const h: Record<string, HistoryEntry[]> = {};
        for (const [chatId, list] of Object.entries(s.history)) h[chatId] = migrateEntries(list);
        s.history = h;
    }
    return s as unknown as Snapshot;
}

function migrateTurn(t: unknown): unknown {
    if (!isObj(t)) return t;
    const r = renameKeys(t, { kette: 'chain', runde: 'round', rundeSchon: 'roundDone', eintragId: 'entryId' });
    r.from = from(r.from);
    return r;
}

/** Peer data of a backend; old backends send `art` instead of `kind` and German kinds and fields. */
export function migratePeerData(input: unknown): PeerData {
    if (!isObj(input) || !('art' in input) || 'kind' in input) return input as PeerData;
    const { art, ...d } = input;
    switch (art) {
        case 'snapshot': return { kind: 'snapshot', snapshot: migrateSnapshot(d.snapshot as Snapshot) };
        case 'verlauf': return { kind: 'history', chatId: String(d.chatId), entries: migrateEntries(d.eintraege) };
        case 'auftrag': return { kind: 'job', id: String(d.id), botId: String(d.botId), turn: migrateTurn(d.turn) as never, reply: d.antwort === true };
        case 'auftrag_fertig': return { kind: 'job_done', id: String(d.id), result: renameKeys(isObj(d.ergebnis) ? d.ergebnis : {}, { fehler: 'error' }) as never };
        case 'neustart': return { kind: 'restart', botId: String(d.botId) };
        case 'gesehen': return { kind: 'seen', state: migrateSeen(d.stand) as never };
        case 'unterbrechen': return { kind: 'interrupt', chatId: String(d.chatId) };
        case 'session_umzug': return {
            kind: 'session_transfer', botId: String(d.botId), folder: String(d.folder), key: String(d.schluessel), sessionId: String(d.sessionId),
            part: Number(d.teil), parts: Number(d.teile), data: String(d.daten),
        };
        default: return { kind: art, ...d } as unknown as PeerData;
    }
}

// ------------------------------------------------------------------ data folder

/** File renames in the data folder (old → new). */
const FILE_RENAMES: Record<string, string> = {
    'fixiert.json': 'pinned.json',
    'gesehen.json': 'seen.json',
    'push-einstellungen.json': 'push-settings.json',
    'kontext.json': 'context.json',
    'modelle.json': 'models.json',
    'umzuege.json': 'transfers.json',
    'neustart.schnell': 'restart.fast',
};

interface Report {
    files: string[];
    entries: number;
    facts: number;
}

function readJsonFile(p: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return undefined;
    }
}

function writeJsonFile(p: string, data: unknown): void {
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, p);
}

/** Changes a JSON file in place if it exists and the mapping changes something. */
function rewrite(dir: string, name: string, map: (data: unknown) => unknown, report: Report): void {
    const p = path.join(dir, name);
    const data = readJsonFile(p);
    if (data === undefined) return;
    const fresh = map(data);
    if (JSON.stringify(fresh) === JSON.stringify(data)) return;
    writeJsonFile(p, fresh);
    report.files.push(name);
}

/** Moves `from` to `to`; if both exist, the new one stays and the old one is kept with the suffix .old. */
function renameFile(dir: string, oldName: string, newName: string, report: Report): void {
    const a = path.join(dir, oldName);
    if (!fs.existsSync(a)) return;
    const b = path.join(dir, newName);
    if (fs.existsSync(b)) fs.renameSync(a, `${a}.old`);
    else fs.renameSync(a, b);
    report.files.push(`${oldName} → ${newName}`);
}

function migrateHistoryFiles(dir: string, report: Report): void {
    const folder = path.join(dir, 'history');
    let names: string[];
    try {
        names = fs.readdirSync(folder).filter((n) => n.endsWith('.jsonl'));
    } catch {
        return;
    }
    for (const n of names) {
        const p = path.join(folder, n);
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        let changed = 0;
        const out = lines.map((l) => {
            if (!l.trim()) return l;
            try {
                const e = JSON.parse(l) as unknown;
                const m = migrateEntry(e);
                const s = JSON.stringify(m);
                if (s !== JSON.stringify(e)) changed++;
                return s;
            } catch {
                return l;
            }
        });
        if (!changed) continue;
        const tmp = `${p}.tmp`;
        fs.writeFileSync(tmp, out.join('\n'));
        fs.renameSync(tmp, p);
        report.entries += changed;
        report.files.push(`history/${n}`);
    }
}

/** Front matter of a fact file: beschreibung/typ → description/type with English type values. */
export function migrateFactFile(content: string): string {
    const m = /^---(\r?\n)([\s\S]*?)\r?\n---/.exec(content);
    if (!m) return content;
    const nl = m[1];
    const head = m[2].split(/\r?\n/).map((l) => {
        const i = l.indexOf(':');
        if (i <= 0) return l;
        const key = l.slice(0, i).trim();
        const value = l.slice(i + 1).trim();
        if (key === 'beschreibung') return `description: ${value}`;
        if (key === 'typ' || key === 'type') return `type: ${KNOWLEDGE_TYPE[value] ?? value}`;
        return l;
    }).join(nl);
    return `---${nl}${head}${nl}---${content.slice(m[0].length)}`;
}

/** data/wissen/<old scope>/<key> → data/knowledge/<scope>/<key>, front matter translated. */
function migrateKnowledge(dir: string, report: Report): void {
    const oldRoot = path.join(dir, 'wissen');
    const root = path.join(dir, 'knowledge');
    if (fs.existsSync(oldRoot)) {
        for (const scope of fs.readdirSync(oldRoot)) {
            const from = path.join(oldRoot, scope);
            const to = path.join(root, SCOPE[scope] ?? scope);
            fs.mkdirSync(to, { recursive: true });
            for (const name of fs.readdirSync(from)) {
                const target = path.join(to, name);
                if (!fs.existsSync(target)) fs.renameSync(path.join(from, name), target);
                else if (fs.statSync(target).isDirectory() && fs.statSync(path.join(from, name)).isDirectory()) {
                    for (const f of fs.readdirSync(path.join(from, name))) {
                        if (!fs.existsSync(path.join(target, f))) fs.renameSync(path.join(from, name, f), path.join(target, f));
                    }
                }
            }
        }
        removeTree(oldRoot);
        report.files.push('wissen/ → knowledge/');
    }
    if (!fs.existsSync(root)) return;
    const walk = (folder: string) => {
        for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
            const p = path.join(folder, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.md')) {
                const content = fs.readFileSync(p, 'utf8');
                const fresh = migrateFactFile(content);
                if (fresh !== content) {
                    fs.writeFileSync(p, fresh);
                    report.facts++;
                }
            }
        }
    };
    walk(root);
}

/** Restart request {grund, seit} in neustart.wunsch → restart.request {reason, since}. */
function migrateRestartRequest(dir: string, report: Report): void {
    const old = path.join(dir, 'neustart.wunsch');
    if (!fs.existsSync(old)) return;
    const d = readJsonFile(old);
    const target = path.join(dir, 'restart.request');
    if (isObj(d) && !fs.existsSync(target)) writeJsonFile(target, { reason: String(d.grund ?? d.reason ?? ''), since: String(d.seit ?? d.since ?? new Date().toISOString()) });
    fs.rmSync(old, { force: true });
    report.files.push('neustart.wunsch → restart.request');
}

/** Notes that were already taken over into the knowledge folder: *.md.migriert → *.md.migrated. */
function migrateOldNotes(dir: string, report: Report): void {
    const folder = path.join(dir, 'notes');
    let names: string[];
    try {
        names = fs.readdirSync(folder).filter((n) => n.endsWith('.md.migriert'));
    } catch {
        return;
    }
    for (const n of names) renameFile(folder, n, n.replace(/\.migriert$/, '.migrated'), report);
}

/**
 * What belongs to an account; everything else in the data folder (tokens, end-to-end key, VAPID keys, the embedded
 * relay, restart markers) belongs to the machine and stays. Named one by one, so nothing unknown is moved.
 */
const ACCOUNT_ENTRIES = [
    'bots.json', 'sessions.json', 'groups.json', 'deleted.json', 'routines.json', 'pinned.json', 'seen.json', 'settings.json',
    'push.json', 'push-settings.json', 'context.json', 'transfers.json', 'engines.json', 'models.json',
    'history', 'knowledge', 'notes', 'uploads',
];

/** Data of the time before accounts → accounts/main/. An entry that already exists there wins; the old one stays. */
function moveIntoAccount(dir: string, report: Report): void {
    const target = path.join(dir, 'accounts', DEFAULT_ACCOUNT);
    for (const name of ACCOUNT_ENTRIES) {
        const from = path.join(dir, name);
        if (!fs.existsSync(from) || fs.existsSync(path.join(target, name))) continue;
        fs.mkdirSync(target, { recursive: true });
        fs.renameSync(from, path.join(target, name));
        report.files.push(`${name} → accounts/${DEFAULT_ACCOUNT}/`);
    }
}

/** A data folder no backend has used yet: no version marker, no accounts and no data from before them. */
export function isNewDataDir(dir = config.dataDir): boolean {
    return [VERSION_FILE, 'accounts', 'bots.json'].every((name) => !fs.existsSync(path.join(dir, name)));
}

export function dataVersion(dir = config.dataDir): number {
    const v = readJsonFile(path.join(dir, VERSION_FILE));
    return isObj(v) && typeof v.version === 'number' ? v.version : 1;
}

/**
 * Converts the data folder to the current format. Runs before anything else reads data; returns what changed
 * (null if the folder was already current). A new, empty folder only gets the version marker.
 */
export function migrateDataDir(dir = config.dataDir): Report | null {
    if (dataVersion(dir) >= DATA_VERSION) return null;
    fs.mkdirSync(dir, { recursive: true });
    const report: Report = { files: [], entries: 0, facts: 0 };
    for (const [a, b] of Object.entries(FILE_RENAMES)) renameFile(dir, a, b, report);
    rewrite(dir, 'bots.json', (d) => (Array.isArray(d) ? d.map(migrateBot) : d), report);
    rewrite(dir, 'groups.json', (d) => (Array.isArray(d) ? d.map(migrateGroup) : d), report);
    rewrite(dir, 'routines.json', (d) => (Array.isArray(d) ? d.map(migrateRoutine) : d), report);
    rewrite(dir, 'pinned.json', migratePinned, report);
    rewrite(dir, 'seen.json', migrateSeen, report);
    rewrite(dir, 'push-settings.json', migratePushSettings, report);
    rewrite(dir, 'deleted.json', migrateTombstones, report);
    migrateHistoryFiles(dir, report);
    migrateKnowledge(dir, report);
    migrateRestartRequest(dir, report);
    migrateOldNotes(dir, report);
    moveIntoAccount(dir, report);
    writeJsonFile(path.join(dir, VERSION_FILE), { version: DATA_VERSION, migratedAt: new Date().toISOString() });
    return report;
}
