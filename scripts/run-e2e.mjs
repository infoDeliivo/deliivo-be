#!/usr/bin/env node
/**
 * run-e2e.mjs — Cross-platform E2E test runner (Windows / macOS / Linux)
 *
 * Usage:
 *   node scripts/run-e2e.mjs [options]
 *
 * Options:
 *   -t, --filter <pattern>   Run only tests whose name matches <pattern>
 *   -s, --suite  <name>      Run only a specific spec file (e.g. 14-admin)
 *   -b, --bail               Stop on first test failure
 *       --open               Open the HTML report in a browser after the run
 *       --no-server-check    Skip the pre-run server health check
 *       --env-file <file>    Load env vars from a custom file
 *   -h, --help               Show this help
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Colours ──────────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  reset:  isTTY ? '\x1b[0m'  : '',
  bold:   isTTY ? '\x1b[1m'  : '',
  dim:    isTTY ? '\x1b[2m'  : '',
  green:  isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  red:    isTTY ? '\x1b[31m' : '',
  cyan:   isTTY ? '\x1b[36m' : '',
};
const log  = (...a) => console.log(`${c.bold}[e2e]${c.reset}`, ...a);
const ok   = (...a) => console.log(`${c.green}${c.bold}[e2e]${c.reset}${c.green}`, ...a, c.reset);
const warn = (...a) => console.warn(`${c.yellow}${c.bold}[e2e]${c.reset}${c.yellow}`, ...a, c.reset);
const err  = (...a) => console.error(`${c.red}${c.bold}[e2e]${c.reset}${c.red}`, ...a, c.reset);

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let filter = '', suite = '', bail = false, openReport = false,
    serverCheck = true, envFile = '';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-t': case '--filter':        filter = args[++i]; break;
    case '-s': case '--suite':         suite  = args[++i]; break;
    case '-b': case '--bail':          bail = true; break;
    case '--open':                     openReport = true; break;
    case '--no-server-check':          serverCheck = false; break;
    case '--env-file':                 envFile = args[++i]; break;
    case '-h': case '--help':
      console.log(`
  Usage: node scripts/run-e2e.mjs [options]

  -t, --filter <pattern>   Run only tests matching <pattern>
  -s, --suite  <name>      Run only a specific spec file (e.g. 14-admin)
  -b, --bail               Stop on first failure
      --open               Open HTML report in browser after run
      --no-server-check    Skip server health check
      --env-file <file>    Load env vars from a custom file
  -h, --help               Show this help

  Examples:
    npm run test:e2e
    npm run test:e2e -- --open
    npm run test:e2e -- --suite 14-admin --open
    npm run test:e2e -- -t "TC-AUTH" --bail
      `);
      process.exit(0);
  }
}

// ── Load env file ─────────────────────────────────────────────────────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Don't override vars already set in the environment
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

if (envFile) {
  const resolved = path.resolve(ROOT, envFile);
  if (loadEnvFile(resolved)) log(`Loaded env from ${c.cyan}${envFile}${c.reset}`);
  else { err(`Env file not found: ${envFile}`); process.exit(1); }
} else if (loadEnvFile(path.join(ROOT, '.env.test'))) {
  log(`Loaded env from ${c.cyan}.env.test${c.reset}`);
} else if (loadEnvFile(path.join(ROOT, '.env'))) {
  log(`Loaded env from ${c.cyan}.env${c.reset}`);
} else {
  warn('No .env.test or .env found — relying on shell environment');
}

// ── Enforce EXPOSE_OTP_IN_RESPONSE=true ───────────────────────────────────────
if (process.env.EXPOSE_OTP_IN_RESPONSE !== 'true') {
  warn("EXPOSE_OTP_IN_RESPONSE is not 'true' — forcing it on for this run.");
}
process.env.EXPOSE_OTP_IN_RESPONSE = 'true';

// ── Require DATABASE_URL ──────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  err('DATABASE_URL is not set. Add it to .env.test (or .env).');
  process.exit(1);
}

// ── Server health check ───────────────────────────────────────────────────────
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
process.env.E2E_BASE_URL = BASE_URL;

function httpGet(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => resolve(res.statusCode));
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

if (serverCheck) {
  log(`Checking server health at ${c.cyan}${BASE_URL}/health${c.reset} ...`);
  const status = await httpGet(`${BASE_URL}/health`);
  if (status === 200) {
    ok('Server is up (HTTP 200)');
  } else {
    err(`Server health check failed (HTTP ${status}).`);
    err('Start the server first:');
    console.log(`\n  ${c.dim}npm run dev:server${c.reset}\n`);
    err('Or skip this check with:  --no-server-check');
    process.exit(1);
  }
}

// ── Print banner ──────────────────────────────────────────────────────────────
const dbSafe = (process.env.DATABASE_URL || '').replace(/:\/\/[^@]+@/, '://<credentials>@');
console.log('');
console.log(`${c.bold}╔══════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}║       Carpooling — E2E Test Suite                ║${c.reset}`);
console.log(`${c.bold}╚══════════════════════════════════════════════════╝${c.reset}`);
console.log(`  ${c.dim}Server :${c.reset} ${BASE_URL}`);
console.log(`  ${c.dim}DB     :${c.reset} ${dbSafe}`);
if (suite)  console.log(`  ${c.dim}Suite  :${c.reset} ${suite}`);
if (filter) console.log(`  ${c.dim}Filter :${c.reset} ${filter}`);
if (bail)   console.log(`  ${c.dim}Bail   :${c.reset} on first failure`);
console.log('');

// ── Build Jest args ───────────────────────────────────────────────────────────
const jestArgs = [
  '--config', 'jest.e2e.config.js',
  '--runInBand',
  '--forceExit',
];
if (bail)   jestArgs.push('--bail', '1');
if (filter) jestArgs.push('--testNamePattern', filter);
if (suite)  jestArgs.push('--testPathPattern', suite);

// ── Run Jest ──────────────────────────────────────────────────────────────────
const start = Date.now();

// Resolve npx path — on Windows npx.cmd is needed
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(npx, ['jest', ...jestArgs], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const exitCode = result.status ?? 1;

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
if (exitCode === 0) {
  ok(`All tests passed  (${elapsed}s)`);
} else {
  err(`Test run FAILED   (${elapsed}s, exit code ${exitCode})`);
}

// ── HTML report ───────────────────────────────────────────────────────────────
const reportPath = path.join(ROOT, 'tests', 'e2e', 'report.html');
if (fs.existsSync(reportPath)) {
  console.log('');
  console.log(`  ${c.cyan}${c.bold}HTML report:${c.reset}  ${c.dim}${reportPath}${c.reset}`);

  if (openReport) {
    const opener =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', reportPath]] :
      process.platform === 'darwin' ? ['open', [reportPath]] :
      ['xdg-open', [reportPath]];
    spawnSync(opener[0], opener[1], { shell: process.platform === 'win32' });
  } else {
    console.log(`  ${c.dim}Run with --open to launch it automatically.${c.reset}`);
  }
}

console.log('');
process.exit(exitCode);
