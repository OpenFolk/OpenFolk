// Microphone with a pasted image: both buttons visible, the voice message takes the image along.
export default async function ({ start, check }) {
    const h = await start({
        // test.local is no secure context: replace the microphone with a silent tone from the AudioContext
        before: () => {
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
    const visible = () => p.evaluate(() => ({ mic: !document.querySelector('[data-el=btn-mic]').hidden, send: !document.querySelector('[data-el=btn-send]').hidden }));
    await h.openChat('PDF');
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
    check('image with text: only send', !k.mic && k.send, k);
    await p.fill('[data-el=text]', '');
    await p.click('[data-el=btn-mic]');
    await h.wait(1500);
    await p.click('[data-el=rec-send]');
    await h.wait(800);
    const send = h.sent.find((f) => f.type === 'send');
    const kinds = send ? send.attachments.map((a) => a.type.split('/')[0]).join(',') : '';
    check('voice message with recording and image', kinds === 'audio,image', send && send.attachments.map((a) => a.name));
    check('attachment removed from the input area afterwards', await p.evaluate(() => document.querySelector('[data-el=attachments]').hidden));
}
