import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const entrypointScript = 'assets/js/main.js';
const appScripts = [
  'assets/js/utils/logger.js',
  'assets/js/utils/validators.js',
  'assets/js/state/app-state.js',
  'assets/js/domain/players.js',
  'assets/js/domain/tournaments.js',
  'assets/js/domain/timers.js',
  'assets/js/integrations/config.js',
  'assets/js/ui/stats-recalc.js',
  'assets/js/ui/players-controls.js',
  'assets/js/ui/roster-db-ui.js',
  'assets/js/ui/results-form.js',
  'assets/js/ui/tournament-form.js',
  'assets/js/ui/participants-modal.js',
  'assets/js/ui/tournament-details.js',
  'assets/js/registration.js',
  'assets/js/screens/core.js',
  'assets/js/screens/roster.js',
  'assets/js/screens/courts.js',
  'assets/js/screens/components.js',
  'assets/js/screens/svod.js',
  'assets/js/screens/players.js',
  'assets/js/screens/home.js',
  'assets/js/screens/stats.js',
  'assets/js/integrations/supabase.js',
  'assets/js/integrations/admin.js',
  'assets/js/integrations/google-sheets.js',
  'assets/js/integrations/export.js',
  'assets/js/ui/roster-auth.js',
  'assets/js/runtime.js',
];
const requiredFiles = [
  'index.html',
  'player-card.html',
  'manifest.webmanifest',
  'sw.js',
  'icon.svg',
  'README.md',
  'assets/app.css',
  entrypointScript,
  ...appScripts,
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function readFile(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(root, rel))) {
    fail(`Missing required file: ${rel}`);
  }
}

const indexHtml = readFile('index.html');
const playerCardHtml = readFile('player-card.html');
const mainJs = readFile(entrypointScript);
const swJs = readFile('sw.js');

for (const { source, label, refs } of [
  {
    source: indexHtml,
    label: 'index.html',
    refs: [
      'manifest.webmanifest',
      'icon.svg',
      'assets/app.css',
      entrypointScript,
    ],
  },
  {
    source: mainJs,
    label: entrypointScript,
    refs: ['sw.js', ...appScripts],
  },
  {
    source: swJs,
    label: 'sw.js',
    refs: [
      './index.html',
      './player-card.html',
      './manifest.webmanifest',
      './icon.svg',
      './assets/app.css',
      `./${entrypointScript}`,
      ...appScripts.map(rel => `./${rel}`),
    ],
  },
]) {
  for (const ref of refs) {
    if (!source.includes(ref)) {
      fail(`${label} does not reference ${ref}`);
    }
  }
}

let manifest;
try {
  manifest = JSON.parse(readFile('manifest.webmanifest'));
} catch (error) {
  fail(`manifest.webmanifest is not valid JSON: ${error.message}`);
}

if (!manifest?.icons?.length) {
  fail('manifest.webmanifest has no icons section');
} else {
  for (const icon of manifest.icons) {
    const iconPath = icon?.src?.replace(/^\.\//, '');
    if (!iconPath || !fs.existsSync(path.join(root, iconPath))) {
      fail(`Manifest icon is missing on disk: ${icon?.src || '<empty>'}`);
    }
  }
}

function validateInlineScripts(html, fileLabel) {
  const regex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;
  while ((match = regex.exec(html))) {
    const source = match[1].trim();
    if (!source) continue;
    index += 1;
    try {
      new vm.Script(source, { filename: `${fileLabel}#inline-${index}` });
    } catch (error) {
      fail(`Inline script syntax error in ${fileLabel} (#${index}): ${error.message}`);
    }
  }
}

function validateScriptFile(relPath) {
  try {
    const source = readFile(relPath);
    new vm.Script(source, { filename: relPath });
  } catch (error) {
    fail(`Script syntax error in ${relPath}: ${error.message}`);
  }
}

validateInlineScripts(indexHtml, 'index.html');
validateInlineScripts(playerCardHtml, 'player-card.html');

for (const rel of ['sw.js', entrypointScript, ...appScripts]) {
  validateScriptFile(rel);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('Static validation passed.');
