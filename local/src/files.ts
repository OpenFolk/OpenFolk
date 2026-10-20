// Store attachments from the phone, read files for download, collect bot info.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.ts';
import { claudeConfigDir } from './engine-home.ts';
import { t } from './i18n.ts';
import { accountPath, PRIVATE } from './store.ts';
import { isUnder, loadBots, realPath } from './bots.ts';
import type { Attachment, UploadInput } from '../../shared/protocol.ts';

export const MAX_FILE = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const MIME: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.csv': 'text/csv', '.html': 'text/html', '.zip': 'application/zip',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export function mimeOf(file: string): string {
    return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function safeName(name: string): string {
    return name.replace(/[^\w.\- äöüÄÖÜß]+/g, '_').slice(-120) || 'file';
}

export interface Saved {
    attachment: Attachment;
    /** Content block for Claude (image or PDF), otherwise null */
    block: Record<string, unknown> | null;
}

/** Stores uploads under the account's uploads/<chat>/ and builds matching content blocks. */
export function saveUploads(chatId: string, uploads: UploadInput[]): Saved[] {
    const folder = accountPath('uploads', chatId.replace(/[^a-z0-9-]/gi, '_'));
    fs.mkdirSync(folder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return uploads.map((u) => {
        const data = Buffer.from(u.data, 'base64');
        if (data.length > MAX_FILE) throw new Error(t('files.uploadTooLarge', { name: u.name }));
        const p = path.join(folder, `${stamp}-${safeName(u.name)}`);
        fs.writeFileSync(p, data, { mode: PRIVATE });
        const type = u.type || mimeOf(u.name);
        const attachment: Attachment = { name: u.name, type, size: data.length, path: p.replace(/\\/g, '/'), thumb: u.thumb, machine: config.machine,
            durationMs: typeof u.durationMs === 'number' ? Math.round(u.durationMs) : undefined };
        let block: Record<string, unknown> | null = null;
        if (IMAGE_TYPES.has(type) && data.length <= 5 * 1024 * 1024) {
            block = { type: 'image', source: { type: 'base64', media_type: type, data: u.data } };
        } else if (type === 'application/pdf' && data.length <= 20 * 1024 * 1024) {
            block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: u.data }, title: u.name };
        }
        return { attachment, block };
    });
}

/** File names that are never handed out ('zugangsdaten' is German for credentials, common in existing setups). */
const SECRET = /\.env(\.|$)|\.(pem|key|pfx|p12|ppk)$|^id_(rsa|ed25519|ecdsa)|zugangsdaten|credentials|secrets\./i;

/**
 * Dot folders and app data directly under the user's home: the logins of the CLIs (~/.claude, ~/.codex, ~/.gemini,
 * ~/.ssh), browser profiles and the transcripts of every session live there.
 */
function homeConfig(abs: string): boolean {
    const home = realPath(os.homedir());
    if (!isUnder(abs, home)) return false;
    const first = path.relative(home, realPath(abs)).split(path.sep)[0] ?? '';
    return first.startsWith('.') || /^(AppData|Library)$/i.test(first);
}

/** Secrets, the backend's own data (push keys, bots, history; uploads excepted) and the CLIs' logins under home. */
export function fileBlocked(abs: string): boolean {
    if (SECRET.test(path.basename(abs)) || /zugangsdaten/i.test(abs)) return true;
    if (isUnder(abs, accountPath('uploads'))) return false;
    return isUnder(abs, config.dataDir) || homeConfig(abs);
}

/**
 * Files are handed out only from a bot's folder (any bot's, groups mix them) and from the uploads, not from
 * everything under ALLOWED_ROOTS: a paired device must not be able to fetch the rest of the disk. A bot folder that
 * itself lies in a dot folder under home (e.g. one for ~/.claude/skills) keeps working.
 */
function checkAccess(p: string): string {
    const abs = realPath(p);
    if (fileBlocked(abs)) throw new Error(t('files.blocked'));
    if (isUnder(abs, accountPath('uploads'))) return abs;
    const owners = loadBots().map((b) => b.folder).filter((f) => isUnder(abs, f));
    if (!owners.length) throw new Error(t('files.outsideAllowed'));
    if (homeConfig(abs) && !owners.some(homeConfig)) throw new Error(t('files.blocked'));
    return abs;
}

/** Read a file for download; only from bot folders or the upload folder. */
export function readFile(p: string): { name: string; mime: string; data: string } {
    const abs = checkAccess(p);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error(t('files.notAFile'));
    if (st.size > MAX_FILE) throw new Error(t('files.tooLarge'));
    return { name: path.basename(abs), mime: mimeOf(abs), data: fs.readFileSync(abs).toString('base64') };
}

/** Checks a file a bot wants to send and describes it as an attachment. */
export function botFile(folder: string, p: string): Attachment {
    const shown = path.resolve(folder, p);
    const abs = checkAccess(shown);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error(t('files.notAFile'));
    if (st.size > MAX_FILE) throw new Error(t('files.tooLarge'));
    return { name: path.basename(shown), type: mimeOf(shown), size: st.size, path: shown.replace(/\\/g, '/'), machine: config.machine };
}

// ---- Bot info ----

function skillName(file: string, fallback: string): string {
    try {
        const head = fs.readFileSync(file, 'utf8').slice(0, 600);
        return /^name:\s*(.+)$/m.exec(head)?.[1].trim() ?? fallback;
    } catch {
        return fallback;
    }
}

function skillsIn(folder: string): string[] {
    try {
        return fs.readdirSync(folder, { withFileTypes: true })
            .filter((e) => e.isDirectory() && fs.existsSync(path.join(folder, e.name, 'SKILL.md')))
            .map((e) => skillName(path.join(folder, e.name, 'SKILL.md'), e.name));
    } catch {
        return [];
    }
}

/** Skills of the bot folder (project) and of the user. */
export function skillsFor(folder: string): string[] {
    const project = skillsIn(path.join(folder, '.claude', 'skills')).map((s) => t('files.projectSkill', { name: s }));
    const user = skillsIn(path.join(claudeConfigDir(), 'skills'));
    return [...project, ...user];
}

export function claudeMdExcerpt(folder: string): string {
    for (const name of ['CLAUDE.md', '.claude/CLAUDE.md']) {
        try {
            const text = fs.readFileSync(path.join(folder, name), 'utf8');
            return text.length > 2500 ? text.slice(0, 2500) + '\n…' : text;
        } catch {
            // next candidate
        }
    }
    return '';
}
