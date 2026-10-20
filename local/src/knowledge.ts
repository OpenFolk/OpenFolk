// Knowledge of the bots: single facts as Markdown files with front matter, stored per scope under
// data/accounts/<id>/knowledge/<scope>/<key>/<name>.md (for 'all' without key). Only the index (name, type, description) goes
// into the system prompt; the bot fetches the full text with read_knowledge.
// Scopes: bot (only this bot), folder (all bots with the same working folder), group (members of a group chat),
// all. Synced per fact; tombstones 'knowledge:<location>/<name>'.

import fs from 'node:fs';
import path from 'node:path';
import { loadGroups } from './bots.ts';
import { t } from './i18n.ts';
import { accountPath, PRIVATE, setTombstone, slug } from './store.ts';
import {
    KNOWLEDGE_TYPES, type Bot, type Group, type KnowledgeFact, type KnowledgeLocation, type KnowledgeScope, type KnowledgeSection, type KnowledgeType,
} from '../../shared/protocol.ts';

export const MAX_TEXT = 4000;
export const MAX_DESCRIPTION = 200;
export const MAX_FACTS = 200;
/** This many facts per scope appear in the system prompt (the most recently changed). */
export const IN_PROMPT = 60;

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,119}$/;
const SCOPES: KnowledgeScope[] = ['bot', 'folder', 'group', 'all'];

/** Folder key as in Claude Code (C:/www/x → c--www-x), lower case so the spelling does not matter. */
export function folderKey(folder: string): string {
    return folder.replace(/[\\/]+$/, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(-120).replace(/^-+/, '') || 'folder';
}

export function isValidLocation(o: unknown): o is KnowledgeLocation {
    const x = o as KnowledgeLocation;
    if (!x || typeof x !== 'object' || !SCOPES.includes(x.scope)) return false;
    return x.scope === 'all' ? !x.key : typeof x.key === 'string' && KEY.test(x.key);
}

export function locationText(o: KnowledgeLocation): string {
    return o.scope === 'all' ? 'all' : `${o.scope}/${o.key}`;
}

export function sameLocation(a: KnowledgeLocation, b: KnowledgeLocation): boolean {
    return a.scope === b.scope && (a.key || '') === (b.key || '');
}

/** Fact key for sync and tombstones: '<location>/<name>'. */
export function factKey(o: KnowledgeLocation, name: string): string {
    return `${locationText(o)}/${name}`;
}

export function splitFactKey(k: string): { location: KnowledgeLocation; name: string } | null {
    const parts = k.split('/');
    const location: KnowledgeLocation = parts.length === 2 && parts[0] === 'all'
        ? { scope: 'all', key: '' }
        : { scope: parts[0] as KnowledgeScope, key: parts.length === 3 ? parts[1] : '\0' };
    const name = parts[parts.length - 1];
    return isValidLocation(location) && NAME.test(name) ? { location, name } : null;
}

function locationPath(o: KnowledgeLocation): string {
    return o.scope === 'all' ? accountPath('knowledge', 'all') : accountPath('knowledge', o.scope, o.key);
}

// ---- File format ----

function oneLine(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
}

function serialize(f: KnowledgeFact): string {
    return `---\nname: ${f.name}\ndescription: ${oneLine(f.description)}\ntype: ${f.type}\nupdatedAt: ${f.updatedAt}\n---\n${f.text.trim()}\n`;
}

export function parseFact(content: string, fileName: string): KnowledgeFact | null {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
    if (!m) return null;
    const head = parseFrontMatter(m[1]);
    const type = (KNOWLEDGE_TYPES as readonly string[]).includes(head.type) ? head.type as KnowledgeType : 'note';
    return { name: fileName, description: head.description ?? '', type, text: m[2].trim(), updatedAt: head.updatedAt ?? '' };
}

export function parseFrontMatter(head: string): Record<string, string> {
    const r: Record<string, string> = {};
    for (const l of head.split(/\r?\n/)) {
        const i = l.indexOf(':');
        if (i > 0) r[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
    return r;
}

// ---- Reading and writing ----

/** All facts of a scope, most recently changed first. */
export function readFacts(o: KnowledgeLocation): KnowledgeFact[] {
    if (!isValidLocation(o)) return [];
    const folder = locationPath(o);
    let names: string[];
    try {
        names = fs.readdirSync(folder).filter((n) => n.endsWith('.md') && NAME.test(n.slice(0, -3)));
    } catch {
        return [];
    }
    const facts: KnowledgeFact[] = [];
    for (const n of names) {
        try {
            const f = parseFact(fs.readFileSync(path.join(folder, n), 'utf8'), n.slice(0, -3));
            if (f) facts.push(f);
        } catch {
            // file just gone
        }
    }
    return facts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

export function readFact(o: KnowledgeLocation, name: string): KnowledgeFact | null {
    if (!isValidLocation(o) || !NAME.test(name)) return null;
    try {
        return parseFact(fs.readFileSync(path.join(locationPath(o), `${name}.md`), 'utf8'), name);
    } catch {
        return null;
    }
}

/** Name from any text: slug, at most 40 characters, cut at a hyphen. */
export function factName(text: string): string {
    let s = slug(text);
    if (s.length > 40) s = s.slice(0, 40).replace(/-[^-]*$/, '') || s.slice(0, 40);
    return s.replace(/-+$/, '');
}

/** Checks and saves a fact (create or replace); throws with an understandable message. */
export function saveFact(o: KnowledgeLocation, input: Omit<KnowledgeFact, 'updatedAt'>, updatedAt = new Date().toISOString()): KnowledgeFact {
    if (!isValidLocation(o)) throw new Error(t('knowledge.unknownScope'));
    const name = String(input.name ?? '').trim();
    if (!NAME.test(name)) throw new Error(t('knowledge.invalidName'));
    const text = String(input.text ?? '').trim();
    if (!text) throw new Error(t('knowledge.emptyText'));
    if (text.length > MAX_TEXT) throw new Error(t('knowledge.textTooLong', { max: MAX_TEXT }));
    const type: KnowledgeType = (KNOWLEDGE_TYPES as readonly string[]).includes(input.type) ? input.type : 'note';
    const description = oneLine(String(input.description ?? '')).slice(0, MAX_DESCRIPTION) || oneLine(text).slice(0, 120);
    const folder = locationPath(o);
    const file = path.join(folder, `${name}.md`);
    if (!fs.existsSync(file) && readFacts(o).length >= MAX_FACTS) {
        throw new Error(t('knowledge.tooMany', { max: MAX_FACTS }));
    }
    const fact: KnowledgeFact = { name, description, type, text, updatedAt };
    fs.mkdirSync(folder, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, serialize(fact), { mode: PRIVATE });
    fs.renameSync(tmp, file);
    return fact;
}

/** Deletes a fact and sets a tombstone for syncing; false if it did not exist. */
export function deleteFact(o: KnowledgeLocation, name: string): boolean {
    if (!isValidLocation(o) || !NAME.test(name)) return false;
    const file = path.join(locationPath(o), `${name}.md`);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    setTombstone(`knowledge:${factKey(o, name)}`);
    return true;
}

// ---- Sync between machines ----

export function allFacts(): Record<string, KnowledgeFact> {
    const r: Record<string, KnowledgeFact> = {};
    const root = accountPath('knowledge');
    const locations: KnowledgeLocation[] = [{ scope: 'all', key: '' }];
    for (const scope of ['bot', 'folder', 'group'] as const) {
        try {
            for (const k of fs.readdirSync(path.join(root, scope))) locations.push({ scope, key: k });
        } catch {
            // scope still empty
        }
    }
    for (const o of locations) for (const f of readFacts(o)) r[factKey(o, f.name)] = f;
    return r;
}

/**
 * Takes over facts of another machine: the newer state wins, tombstones take precedence over older states;
 * facts here with a newer tombstone are deleted. Returns the changed scopes.
 */
export function mergeKnowledge(other: Record<string, KnowledgeFact>, dead: Record<string, string>): KnowledgeLocation[] {
    const changed: KnowledgeLocation[] = [];
    const note = (o: KnowledgeLocation) => { if (!changed.some((g) => sameLocation(g, o))) changed.push(o); };
    const own = allFacts();
    for (const [k, f] of Object.entries(other ?? {})) {
        const z = splitFactKey(k);
        if (!z || !f || typeof f !== 'object' || f.name !== z.name || typeof f.updatedAt !== 'string') continue;
        const tomb = dead[`knowledge:${k}`];
        if (tomb && tomb >= f.updatedAt) continue;
        if ((own[k]?.updatedAt ?? '') >= f.updatedAt) continue;
        try {
            saveFact(z.location, f, f.updatedAt);
            note(z.location);
        } catch {
            // invalid fact from the other machine
        }
    }
    for (const [k, f] of Object.entries(own)) {
        const tomb = dead[`knowledge:${k}`];
        const z = splitFactKey(k);
        if (z && tomb && tomb >= f.updatedAt) {
            fs.rmSync(path.join(locationPath(z.location), `${z.name}.md`), { force: true });
            note(z.location);
        }
    }
    return changed;
}

// ---- What a bot sees ----

/** Scopes a bot sees: its own knowledge, its folder, its groups, all. */
export function locationsFor(bot: Bot, groups: Group[] = loadGroups()): KnowledgeLocation[] {
    return [
        { scope: 'bot', key: bot.id },
        { scope: 'folder', key: folderKey(bot.folder) },
        ...groups.filter((g) => g.members.includes(bot.id)).map((g): KnowledgeLocation => ({ scope: 'group', key: g.id })),
        { scope: 'all', key: '' },
    ];
}

export function sees(bot: Bot, o: KnowledgeLocation, groups: Group[] = loadGroups()): boolean {
    return locationsFor(bot, groups).some((x) => sameLocation(x, o));
}

function groupName(o: KnowledgeLocation, groups: Group[]): string {
    return groups.find((g) => g.id === o.key)?.name ?? o.key;
}

function title(o: KnowledgeLocation, bot: Bot, groups: Group[]): string {
    switch (o.scope) {
        case 'bot': return t('knowledge.titleBot');
        case 'folder': return t('knowledge.titleFolder', { folder: bot.folder });
        case 'group': return t('knowledge.titleGroup', { name: groupName(o, groups) });
        default: return t('knowledge.titleAll');
    }
}

export function knowledgeSections(bot: Bot, groups: Group[] = loadGroups()): KnowledgeSection[] {
    return locationsFor(bot, groups).map((location) => ({ location, title: title(location, bot, groups), facts: readFacts(location) }));
}

function heading(o: KnowledgeLocation, groups: Group[]): string {
    switch (o.scope) {
        case 'bot': return t('knowledge.headingBot');
        case 'folder': return t('knowledge.headingFolder');
        case 'group': return t('knowledge.headingGroup', { name: groupName(o, groups), key: o.key });
        default: return t('knowledge.headingAll');
    }
}

/** Index for the system prompt; empty if the bot knows nothing yet. */
export function knowledgeIndex(bot: Bot, groups: Group[] = loadGroups()): string {
    const blocks: string[] = [];
    for (const a of knowledgeSections(bot, groups)) {
        if (!a.facts.length) continue;
        const lines = a.facts.slice(0, IN_PROMPT).map((f) => `- ${f.name} (${f.type}): ${f.description}`);
        if (a.facts.length > IN_PROMPT) lines.push(t('knowledge.indexMore', { count: a.facts.length - IN_PROMPT }));
        blocks.push(`${heading(a.location, groups)}:\n${lines.join('\n')}`);
    }
    return blocks.join('\n\n');
}

// ---- Transition from the old notes ----

/** Splits text at line boundaries into pieces of at most `max` characters. */
export function splitText(text: string, max: number): string[] {
    const parts: string[] = [];
    let current = '';
    for (const l of text.split('\n')) {
        for (let rest = l; ; rest = rest.slice(max)) {
            const piece = rest.slice(0, max);
            if (current && current.length + 1 + piece.length > max) {
                parts.push(current);
                current = '';
            }
            current = current ? `${current}\n${piece}` : piece;
            if (rest.length <= max) break;
        }
    }
    if (current.trim()) parts.push(current);
    return parts.map((p) => p.trim()).filter(Boolean);
}

/** Turns the account's notes/<botId>.md into a fact 'previous-notes' each and renames the old file. */
export function migrateNotes(): number {
    const folder = accountPath('notes');
    let n = 0;
    let files: string[];
    try {
        files = fs.readdirSync(folder).filter((x) => x.endsWith('.md'));
    } catch {
        return 0;
    }
    for (const d of files) {
        const botId = d.slice(0, -3);
        const old = path.join(folder, d);
        const location: KnowledgeLocation = { scope: 'bot', key: botId };
        try {
            const text = fs.readFileSync(old, 'utf8').trim();
            if (text && isValidLocation(location) && !readFact(location, 'previous-notes')) {
                const changed = fs.statSync(old).mtime.toISOString();
                const parts = splitText(text, MAX_TEXT);
                parts.forEach((p, i) => saveFact(location, {
                    name: i ? `previous-notes-${i + 1}` : 'previous-notes', type: 'note',
                    description: parts.length > 1 ? t('knowledge.previousNotesPart', { part: i + 1, parts: parts.length }) : t('knowledge.previousNotes'),
                    text: p,
                }, changed));
                n++;
            }
            fs.renameSync(old, `${old}.migrated`);
        } catch (e) {
            console.log(`knowledge: notes of ${botId} not taken over: ${(e as Error).message}`);
        }
    }
    return n;
}
