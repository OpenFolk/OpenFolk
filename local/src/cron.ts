// Minimal cron parser: 5 fields (minute hour day month weekday), local time.
// Supports *, lists (1,15), ranges (1-5), steps (*/10, 8-18/2). Weekday 0 and 7 = Sunday.

interface Field {
    min: number;
    max: number;
}

const FIELDS: Field[] = [
    { min: 0, max: 59 },
    { min: 0, max: 23 },
    { min: 1, max: 31 },
    { min: 1, max: 12 },
    { min: 0, max: 7 },
];

function parseField(text: string, field: Field): Set<number> {
    const values = new Set<number>();
    for (const part of text.split(',')) {
        const [range, stepText] = part.split('/');
        const step = stepText ? Number(stepText) : 1;
        if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step: ${part}`);
        let from: number;
        let to: number;
        if (range === '*') {
            from = field.min;
            to = field.max;
        } else if (range.includes('-')) {
            [from, to] = range.split('-').map(Number);
        } else {
            from = Number(range);
            to = stepText ? field.max : from;
        }
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < field.min || to > field.max || from > to) {
            throw new Error(`Invalid value: ${part}`);
        }
        for (let v = from; v <= to; v += step) values.add(v);
    }
    return values;
}

export interface Schedule {
    matches(d: Date): boolean;
}

export function parseCron(expression: string): Schedule {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Cron needs 5 fields: minute hour day month weekday');
    const [min, hour, day, month, wday] = parts.map((t, i) => parseField(t, FIELDS[i]));
    if (wday.has(7)) wday.add(0);
    const dayAny = parts[2] === '*';
    const wdayAny = parts[4] === '*';
    return {
        matches(d: Date): boolean {
            if (!min.has(d.getMinutes()) || !hour.has(d.getHours()) || !month.has(d.getMonth() + 1)) return false;
            const dayOk = day.has(d.getDate());
            const wdayOk = wday.has(d.getDay());
            // As in classic cron: if both day and weekday are restricted, one of them is enough
            if (dayAny && wdayAny) return true;
            if (dayAny) return wdayOk;
            if (wdayAny) return dayOk;
            return dayOk || wdayOk;
        },
    };
}

/** All times after `from` up to and including `to`, at most `max`. */
export function runs(expression: string, from: Date, to: Date, max = 100): Date[] {
    const schedule = parseCron(expression);
    const d = new Date(from);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    const list: Date[] = [];
    while (d <= to && list.length < max) {
        if (schedule.matches(d)) list.push(new Date(d));
        d.setMinutes(d.getMinutes() + 1);
    }
    return list;
}

/** Next time (to the minute) from now, at most 366 days ahead. */
export function nextRun(expression: string, from = new Date()): Date | null {
    const schedule = parseCron(expression);
    const d = new Date(from);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 366 * 24 * 60; i++) {
        if (schedule.matches(d)) return d;
        d.setMinutes(d.getMinutes() + 1);
    }
    return null;
}
