// lib/printEngine/__tests__/nodeIO.ts
//
// NODE-ONLY setup for CLI tests and scripts (run via tsx).
// Registers file-system hooks on globalThis so the Print Engine can load fonts
// and write temp files without the app code ever importing Node built-ins.
//
// NEVER import this file from app/, components/, or lib/ runtime code —
// Metro cannot bundle `fs` / `path` / `os` for Android, iOS, or Web.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const fontsDir = path.resolve(__dirname, '../../../assets/fonts');

(globalThis as any).__TSEKI_NODE_FONT_LOADER__ = () => {
    const regularBuf = fs.readFileSync(path.join(fontsDir, 'NotoSans-Regular.ttf'));
    const boldBuf = fs.readFileSync(path.join(fontsDir, 'NotoSans-Bold.ttf'));
    return {
        regularBytes: new Uint8Array(regularBuf.buffer, regularBuf.byteOffset, regularBuf.byteLength),
        boldBytes: new Uint8Array(boldBuf.buffer, boldBuf.byteOffset, boldBuf.byteLength),
    };
};

(globalThis as any).__TSEKI_NODE_TMP_WRITER__ = (fileName: string, base64Data: string) => {
    fs.writeFileSync(path.join(os.tmpdir(), fileName), Buffer.from(base64Data, 'base64'));
};
