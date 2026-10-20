// Rules the web app repeats from the backend, so it can act before the backend answers: which machine runs a bot,
// and the title of a new conversation. Same inputs, same results, or the UI drifts from what the backends do.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default async function ({ start, check }) {
    process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'openfolk-rules-'));
    const { responsibleMachine, titleFrom } = await import('../../local/src/agent.ts');
    const h = await start({});
    const p = h.page;

    const bots = [{ machine: '' }, { machine: 'desk' }, { machine: 'laptop' }];
    const onlines = [[], ['desk'], ['laptop'], ['laptop', 'desk'], ['zeta', 'alpha']];
    const machineCases = bots.flatMap((b) => onlines.map((online) => ({ b, online })));
    const app = await p.evaluate((cases) => cases.map(({ b, online }) => responsibleMachine(b, online)), machineCases);
    const backend = machineCases.map(({ b, online }) => responsibleMachine(b, online));
    const machineDiff = machineCases.filter((_, i) => app[i] !== backend[i]).map((c, i) => ({ ...c, app: app[i], backend: backend[i] }));
    check(`responsibleMachine: app and backend agree (${machineCases.length} cases)`, machineDiff.length === 0, machineDiff);

    const texts = [
        '', 'Short title', 'A title that is exactly forty chars long', 'A much longer first line that goes well beyond forty characters in total',
        '\n\n  Leading blank lines\nsecond line', 'Ends with punctuation, and goes on for quite a while longer than forty, really',
        'Averyveryverylongwordwithoutanyspacesatallthatkeepsgoing', '🎤 Voice message (0:12)\nPlease check the release notes',
        'Line with – dash near the cut, more and more words here',
    ];
    const appTitles = await p.evaluate((list) => list.map((t) => titleFrom(t)), texts);
    const titleDiff = texts.map((t, i) => ({ text: t, app: appTitles[i], backend: titleFrom(t) })).filter((x) => x.app !== x.backend);
    check(`titleFrom: app and backend agree (${texts.length} cases)`, titleDiff.length === 0, titleDiff);
    await h.close();
}
