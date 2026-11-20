const path = require('node:path');

// Allow extra headroom on Windows while Metro & React Compiler boot concurrently with ngrok
const TUNNEL_TIMEOUT_MS = 60_000;

try {
  const expoDir = path.dirname(require.resolve('expo/package.json'));
  const asyncNgrokPath = require.resolve('@expo/cli/build/src/start/server/AsyncNgrok', {
    paths: [expoDir],
  });
  const { AsyncNgrok } = require(asyncNgrokPath);
  const originalStartAsync = AsyncNgrok.prototype.startAsync;
  AsyncNgrok.prototype.startAsync = function startAsyncWithTimeout(options = {}) {
    return originalStartAsync.call(this, {
      timeout: TUNNEL_TIMEOUT_MS,
      ...options,
    });
  };
} catch {
  // Proceed with Expo CLI defaults if internal module layout changes in future SDK versions
}

const extraArgs = process.argv.slice(2);
const hasTunnelFlag = extraArgs.some((arg) => arg === '--tunnel' || arg.startsWith('--host'));
const cliArgs = ['start', ...(hasTunnelFlag ? [] : ['--tunnel']), ...extraArgs];

process.argv = [process.argv[0], require.resolve('expo/bin/cli'), ...cliArgs];
require('expo/bin/cli');
