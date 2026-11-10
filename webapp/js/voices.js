/* OpenFolk web app: the voices of the backend's providers a bot can choose in the editor. The same list as
   VOICE_CATALOG in shared/protocol.ts, which the backend checks against (local/src/voices.test.ts keeps both equal):
   id at the provider, the kind it reads as ('' = neither), for Piper its language. */

/** @type {Record<'openai' | 'gemini' | 'local', { id: string, kind: '' | 'female' | 'male', lang?: 'en' | 'de' }[]>} */
export const VOICE_CATALOG = {
    openai: [
        { id: 'marin', kind: 'female' }, { id: 'cedar', kind: 'male' }, { id: 'coral', kind: 'female' }, { id: 'nova', kind: 'female' },
        { id: 'sage', kind: 'female' }, { id: 'shimmer', kind: 'female' }, { id: 'ash', kind: 'male' }, { id: 'ballad', kind: 'male' },
        { id: 'echo', kind: 'male' }, { id: 'fable', kind: 'male' }, { id: 'onyx', kind: 'male' }, { id: 'verse', kind: 'male' },
        { id: 'alloy', kind: '' },
    ],
    gemini: [
        { id: 'Kore', kind: 'female' }, { id: 'Zephyr', kind: 'female' }, { id: 'Leda', kind: 'female' }, { id: 'Aoede', kind: 'female' },
        { id: 'Callirrhoe', kind: 'female' }, { id: 'Autonoe', kind: 'female' }, { id: 'Despina', kind: 'female' }, { id: 'Erinome', kind: 'female' },
        { id: 'Laomedeia', kind: 'female' }, { id: 'Achernar', kind: 'female' }, { id: 'Gacrux', kind: 'female' }, { id: 'Pulcherrima', kind: 'female' },
        { id: 'Vindemiatrix', kind: 'female' }, { id: 'Sulafat', kind: 'female' },
        { id: 'Charon', kind: 'male' }, { id: 'Puck', kind: 'male' }, { id: 'Fenrir', kind: 'male' }, { id: 'Orus', kind: 'male' },
        { id: 'Enceladus', kind: 'male' }, { id: 'Iapetus', kind: 'male' }, { id: 'Umbriel', kind: 'male' }, { id: 'Algieba', kind: 'male' },
        { id: 'Algenib', kind: 'male' }, { id: 'Rasalgethi', kind: 'male' }, { id: 'Alnilam', kind: 'male' }, { id: 'Schedar', kind: 'male' },
        { id: 'Achird', kind: 'male' }, { id: 'Zubenelgenubi', kind: 'male' }, { id: 'Sadachbia', kind: 'male' }, { id: 'Sadaltager', kind: 'male' },
    ],
    local: [
        { id: 'de_DE-kerstin-medium', kind: 'female', lang: 'de' }, { id: 'de_DE-ramona-low', kind: 'female', lang: 'de' },
        { id: 'de_DE-eva_k-x_low', kind: 'female', lang: 'de' }, { id: 'de_DE-thorsten-high', kind: 'male', lang: 'de' },
        { id: 'de_DE-karlsson-low', kind: 'male', lang: 'de' }, { id: 'de_DE-pavoque-low', kind: 'male', lang: 'de' },
        { id: 'en_US-lessac-high', kind: 'female', lang: 'en' }, { id: 'en_US-amy-medium', kind: 'female', lang: 'en' },
        { id: 'en_US-kristin-medium', kind: 'female', lang: 'en' }, { id: 'en_GB-cori-high', kind: 'female', lang: 'en' },
        { id: 'en_US-ryan-high', kind: 'male', lang: 'en' }, { id: 'en_US-joe-medium', kind: 'male', lang: 'en' },
        { id: 'en_US-john-medium', kind: 'male', lang: 'en' }, { id: 'en_GB-alan-medium', kind: 'male', lang: 'en' },
    ],
};
