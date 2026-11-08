/* OpenFolk web app: the bar above a code block in a message: language, copy this block, wrap lines or scroll. */
import { t } from './i18n.js';
import { node, storage } from './core.js';

const WRAP_KEY = 'openfolk-code-wrap';
/** Lines wrap unless the user switched it off; the choice is the same for all blocks. */
const wrapOn = () => storage.get(WRAP_KEY) !== 'off';

const ICONS = {
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4m0 0l2-2m-2 2l2 2M4 18h5"/>',
};

function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name];
    return s;
}

function barButton(name, label) {
    const k = node('button', 'code-button');
    k.type = 'button';
    k.title = label;
    k.setAttribute('aria-label', label);
    k.appendChild(icon(name));
    return k;
}

/** All blocks follow the choice: the ones on the page now, and every block drawn later. */
function showWrap() {
    const on = wrapOn();
    for (const block of document.querySelectorAll('.code-block')) {
        block.classList.toggle('nowrap', !on);
        const k = block.querySelector('.code-wrap');
        if (k) k.setAttribute('aria-pressed', String(on));
    }
}

/**
 * Puts a bar above every code block in `content` (rendered Markdown). The language comes from the `lang` attribute
 * that the sanitizer in core.js keeps from the fence's info string. Called again after every render of a running
 * answer, which replaces the blocks; nothing but the shared wrap choice has to survive that.
 * @param {HTMLElement} content
 */
export function codeBlocks(content) {
    for (const pre of content.querySelectorAll('pre')) {
        const code = pre.querySelector('code');
        if (!code || pre.parentElement.classList.contains('code-block')) continue;
        const block = node('div', 'code-block');
        const bar = node('div', 'code-bar');
        bar.appendChild(node('span', 'code-lang', code.getAttribute('lang') || ''));
        const copy = barButton('copy', t('code.copy'));
        copy.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // only this block's code, not the ▶ button of a command that sits in the pre
            if (!navigator.clipboard) return;
            navigator.clipboard.writeText(code.textContent).then(() => {
                copy.replaceChildren(icon('check'));
                copy.title = t('code.copied');
                copy.setAttribute('aria-label', t('code.copied'));
                setTimeout(() => {
                    copy.replaceChildren(icon('copy'));
                    copy.title = t('code.copy');
                    copy.setAttribute('aria-label', t('code.copy'));
                }, 1500);
            }, () => undefined);
        });
        const wrap = barButton('wrap', t('code.wrap'));
        wrap.classList.add('code-wrap');
        wrap.addEventListener('click', (ev) => {
            ev.stopPropagation();
            storage.set(WRAP_KEY, wrapOn() ? 'off' : 'on');
            showWrap();
        });
        bar.append(copy, wrap);
        pre.replaceWith(block);
        block.append(bar, pre);
        block.classList.toggle('nowrap', !wrapOn());
        wrap.setAttribute('aria-pressed', String(wrapOn()));
    }
}
