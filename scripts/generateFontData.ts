import * as fs from 'fs';
import * as path from 'path';

const regularPath = path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf');
const boldPath = path.join(__dirname, '../assets/fonts/NotoSans-Bold.ttf');
const outDir = path.join(__dirname, '../lib/printEngine/fonts');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const regB64 = fs.readFileSync(regularPath).toString('base64');
const boldB64 = fs.readFileSync(boldPath).toString('base64');

const fileContent = `// Auto-generated font bundle for Noto Sans Regular & Bold
// Provides embedded TrueType font data for @pdf-lib/fontkit without platform-specific I/O.

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binaryString = typeof globalThis.atob === 'function' ? globalThis.atob(base64) : '';
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

let cachedRegular: Uint8Array | null = null;
let cachedBold: Uint8Array | null = null;

const NOTO_SANS_REGULAR_B64 = ${JSON.stringify(regB64)};
const NOTO_SANS_BOLD_B64 = ${JSON.stringify(boldB64)};

export function getNotoSansRegularBytes(): Uint8Array {
  if (!cachedRegular) {
    cachedRegular = base64ToUint8Array(NOTO_SANS_REGULAR_B64);
  }
  return cachedRegular;
}

export function getNotoSansBoldBytes(): Uint8Array {
  if (!cachedBold) {
    cachedBold = base64ToUint8Array(NOTO_SANS_BOLD_B64);
  }
  return cachedBold;
}
`;

fs.writeFileSync(path.join(outDir, 'notoSansFonts.ts'), fileContent, 'utf-8');
console.log('Successfully generated lib/printEngine/fonts/notoSansFonts.ts');
