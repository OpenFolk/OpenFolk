// Globals of the classic scripts loaded before the modules (vendor/marked.umd.js, vendor/purify.min.js, vendor/qrcode.js).
declare const marked: { parse(text: string): string; setOptions(options: Record<string, unknown>): void };
declare const DOMPurify: {
    sanitize(html: string, config?: Record<string, unknown>): string;
    addHook(name: string, hook: (node: Element) => void): void;
};
declare function qrcode(typeNumber: number, errorCorrection: 'L' | 'M' | 'Q' | 'H'): {
    addData(text: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
};

// boot.js reloads the page while the app has not started; js/start.js sets this once it has
interface Window { openfolkStarted?: boolean }
