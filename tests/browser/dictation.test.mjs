// Dictation (#59, a setting of the device; off, the microphone sends voice messages): it records next to the text field, which stays usable; X discards, the checkmark asks
// the bot's machine for the text and puts it where the cursor was. The message goes out only with the send button,
// as text, with a pasted image but without the recording. An older backend that does not know the frame says so.
export default async function ({ start, check }) {
    const h = await start({
        // test.local is no secure context: replace the microphone with a silent tone from the AudioContext
        before: () => {
            localStorage.setItem('openfolk-dictation', 'on');
            Object.defineProperty(window, 'isSecureContext', { get: () => true });
            Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
                const ctx = new AudioContext();
                const tone = ctx.createOscillator();
                const target = ctx.createMediaStreamDestination();
                tone.connect(target);
                tone.start();
                return target.stream;
            } } });
        },
    });
    const p = h.page;
    const shown = (name) => p.evaluate((name) => !document.querySelector(`[data-el=${name}]`).hidden, name);
    const visible = async () => ({ mic: await shown('btn-mic'), send: await shown('btn-send') });
    const field = () => p.inputValue('[data-el=text]');
    const transcribes = () => h.sent.filter((f) => f.type === 'transcribe');
    const dictate = async () => {
        await p.click('[data-el=btn-mic]');
        await h.wait(900);
        await p.click('[data-el=rec-done]');
        await h.wait(600);
        return transcribes().at(-1);
    };
    await h.openChat('PDF');
    check('the microphone says "Dictate"', (await p.getAttribute('[data-el=btn-mic]', 'title')) === 'Dictate');
    let k = await visible();
    check('empty field: only the microphone', k.mic && !k.send, k);
    await p.setInputFiles('[data-el=file-input]', { name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await h.wait(400);
    k = await visible();
    check('image without text: microphone and send', k.mic && k.send, k);
    const view = () => p.evaluate(() => { const o = document.getElementById('image-view'); return o && !o.hidden ? o.querySelector('img').src.slice(0, 5) : ''; });
    await p.click('[data-el=attachments] .upload img');
    await h.wait(200);
    check('a tap on the preview shows the image large', (await view()) === 'blob:', await view());
    await p.click('#image-view');
    await h.wait(200);
    check('a tap on the large view closes it, the attachment stays', (await view()) === '' && (await p.locator('[data-el=attachments] .upload').count()) === 1);
    await p.fill('[data-el=text]', 'What is this?');
    k = await visible();
    check('image with text: microphone to dictate more, and send', k.mic && k.send, k);

    // recording: the field stays, X and the checkmark next to each other, no pause and no voice message
    await p.click('[data-el=btn-mic]');
    await h.wait(300);
    const during = { text: await shown('text'), attach: await shown('btn-attach'), recording: await shown('recording') };
    check('while recording the field and the attach button stay', during.text && during.attach && during.recording, during);
    const usable = await p.locator('[data-el=recording] button').evaluateAll((l) => l.filter((b) => !b.hidden).map((b) => b.dataset.el));
    check('exactly X and the checkmark, next to each other', usable.join() === 'rec-discard,rec-done' && await p.evaluate(() => {
        const x = document.querySelector('[data-el=rec-discard]').getBoundingClientRect();
        const done = document.querySelector('[data-el=rec-done]').getBoundingClientRect();
        return done.left > x.left && done.left - x.right < 20;
    }), usable);
    await p.fill('[data-el=text]', 'What is this? Typed meanwhile.');
    await p.click('[data-el=rec-discard]');
    await h.wait(300);
    check('X: nothing transcribed, the typed text stays', transcribes().length === 0 && (await field()) === 'What is this? Typed meanwhile.', await field());

    // the checkmark: the recording goes to the bot's machine as a transcribe frame, nothing is sent
    await p.fill('[data-el=text]', 'Look at  please');
    await p.evaluate(() => { const t = /** @type {HTMLTextAreaElement} */ (document.querySelector('[data-el=text]')); t.focus(); t.setSelectionRange(8, 8); t.blur(); });
    const asked = await dictate();
    check('the checkmark asks the machine for the text', asked && asked.chatId === 'pdf' && asked.machine === 'desk' && asked.audio.type.startsWith('audio/') && asked.audio.data.length > 0, asked && { ...asked, audio: asked.audio.type });
    check('nothing sent yet', !h.sent.some((f) => f.type === 'send'));
    check('the microphone waits for the text', await p.isDisabled('[data-el=btn-mic]'));
    await h.push({ type: 'transcribed', machine: 'desk', id: asked.id, ok: true, text: 'the chart' });
    await h.wait(100);
    check('the text goes where the cursor was', (await field()) === 'Look at the chart please', await field());
    check('the microphone is free again', !(await p.isDisabled('[data-el=btn-mic]')));

    // a second dictation goes to the cursor too, here the end
    await p.evaluate(() => { const t = /** @type {HTMLTextAreaElement} */ (document.querySelector('[data-el=text]')); t.focus(); t.setSelectionRange(t.value.length, t.value.length); t.blur(); });
    const second = await dictate();
    await h.push({ type: 'transcribed', machine: 'desk', id: second.id, ok: true, text: 'Thanks.' });
    await h.wait(100);
    check('dictating more appends at the end', (await field()) === 'Look at the chart please Thanks.', await field());

    // sending: text and image, no recording, nothing to read aloud
    await p.click('[data-el=btn-send]');
    await h.wait(300);
    const sent = h.sent.find((f) => f.type === 'send');
    check('sent as text with the image, without the recording', sent && sent.text === 'Look at the chart please Thanks.' && sent.attachments.map((a) => a.type.split('/')[0]).join() === 'image', sent && { text: sent.text, a: sent.attachments.map((a) => a.type) });
    check('attachment removed from the input area afterwards', await p.evaluate(() => document.querySelector('[data-el=attachments]').hidden));

    // Escape in the field ends a recording without text
    await p.click('[data-el=btn-mic]');
    await h.wait(300);
    await p.focus('[data-el=text]');
    await p.keyboard.press('Escape');
    await h.wait(300);
    check('Escape discards the recording', !(await shown('recording')) && transcribes().length === 2 && await p.evaluate(() => !window.rec.recorder));

    // nothing understood, a failure, an older backend
    const quiet = await dictate();
    await h.push({ type: 'transcribed', machine: 'desk', id: quiet.id, ok: true, text: '' });
    await h.wait(100);
    check('nothing understood: the field stays empty, a note in the chat', (await field()) === '' && (await p.textContent('[data-el=messages]')).includes('Nothing was understood'));
    // the app's own notice: its text, then OK
    const notice = () => p.evaluate(() => { const d = document.querySelector('.overlay.ask'); const text = d ? d.textContent : ''; if (d) d.querySelector('button.primary').click(); return text; });
    const failed = await dictate();
    await h.push({ type: 'transcribed', machine: 'desk', id: failed.id, ok: false, message: 'Voice messages are not set up on DESK.' });
    await h.wait(200);
    const said = await notice();
    check('a failure is said', said.includes('not set up on DESK'), said);
    await h.wait(200);
    await dictate();
    await h.push({ type: 'error', machine: 'desk', request: 'transcribe', message: 'Unknown request' });
    await h.wait(200);
    const old = await notice();
    check('an older backend: update it', old.includes('too old for dictation'), old);
    // the setting: shown in the settings, off brings the voice message back
    await p.evaluate(() => { const box = /** @type {HTMLInputElement} */ (document.getElementById('settings-dictation')); box.checked = false; box.dispatchEvent(new Event('change')); });
    await p.click('[data-el=btn-mic]');
    await h.wait(300);
    const voiceMode = { send: await shown('rec-send'), done: await shown('rec-done'), text: await shown('text') };
    check('dictation off: voice message as before (send, no checkmark, no field)', voiceMode.send && !voiceMode.done && !voiceMode.text, voiceMode);
    await p.click('[data-el=rec-discard]');
    check('no errors', h.errors.length === 0, h.errors);
}
