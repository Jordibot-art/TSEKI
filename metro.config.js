const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const { execFile } = require('node:child_process');
const { getDefaultConfig } = require('expo/metro-config');

// 1. Load Windows System Root CA certificates into Node 24+ at runtime
// so `npx expo start --localhost` never crashes with `TypeError: fetch failed`.
try {
  if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
    const defaultCerts = tls.getCACertificates('default');
    const systemCerts = tls.getCACertificates('system');
    tls.setDefaultCACertificates(Array.from(new Set([...defaultCerts, ...systemCerts])));
  }
} catch {
  // Ignore if unsupported by the current Node runtime
}

// 2. Ensure `adb` is discoverable by Expo CLI for `--localhost` USB port forwarding (`adb reverse`)
try {
  const sdkPlatformToolsDir = path.join(
    process.env.LOCALAPPDATA || '',
    'Android',
    'Sdk',
    'platform-tools'
  );
  const xdlAdbDir = path.join(
    process.env.APPDATA || '',
    'npm',
    'node_modules',
    'expo-cli',
    'node_modules',
    'xdl',
    'binaries',
    'windows',
    'adb'
  );
  const candidateDirs = [sdkPlatformToolsDir, xdlAdbDir];
  const resolvedAdbDir = candidateDirs.find((dir) => fs.existsSync(path.join(dir, 'adb.exe')));

  if (resolvedAdbDir) {
    const resolvedAdbExe = path.join(resolvedAdbDir, 'adb.exe');
    const currentPath = process.env.PATH || process.env.Path || '';
    if (!currentPath.toLowerCase().includes(resolvedAdbDir.toLowerCase())) {
      process.env.PATH = `${resolvedAdbDir}${path.delimiter}${currentPath}`;
      process.env.Path = process.env.PATH;
    }

    // Patch Expo CLI's ADBServer so it never fails if %LOCALAPPDATA%\Android\Sdk is missing platform-tools
    try {
      const expoDir = path.dirname(require.resolve('expo/package.json'));
      const adbServerPath = require.resolve(
        '@expo/cli/build/src/start/platforms/android/ADBServer',
        { paths: [expoDir] }
      );
      const { ADBServer } = require(adbServerPath);
      ADBServer.prototype.getAdbExecutablePath = function () {
        return resolvedAdbExe;
      };
    } catch {
      // Ignore if internal module layout changes
    }

    execFile(resolvedAdbExe, ['reverse', 'tcp:8081', 'tcp:8081'], { timeout: 5000 }, () => {});
  }
} catch {
  // Ignore if adb is unavailable
}

// 3. Give ngrok tunnel extra startup headroom on Windows when `--tunnel` is used
try {
  const expoDir = path.dirname(require.resolve('expo/package.json'));
  const asyncNgrokPath = require.resolve('@expo/cli/build/src/start/server/AsyncNgrok', {
    paths: [expoDir],
  });
  const { AsyncNgrok } = require(asyncNgrokPath);
  const originalStartAsync = AsyncNgrok.prototype.startAsync;
  if (!originalStartAsync.__patched) {
    const patchedStartAsync = function startAsyncWithTimeout(options = {}) {
      return originalStartAsync.call(this, {
        timeout: 60_000,
        ...options,
      });
    };
    patchedStartAsync.__patched = true;
    AsyncNgrok.prototype.startAsync = patchedStartAsync;
  }
} catch {
  // Ignore if internal module layout changes
}

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const existingBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : config.resolver.blockList
  ? [config.resolver.blockList]
  : [];

const excludedDirs = ['admin-web', 'teacher-web', 'supabase', 'scratch'].map((dir) => {
  const fullPath = escapeRegex(path.join(__dirname, dir));
  return new RegExp(`^${fullPath}[/\\\\].*`);
});

config.resolver.blockList = [...existingBlockList, ...excludedDirs];

module.exports = config;
