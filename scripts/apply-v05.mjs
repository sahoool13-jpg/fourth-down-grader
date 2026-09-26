import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const enginePath = path.join(root, 'lib', 'decision-engine.js');
const endgamePath = path.join(root, 'lib', 'endgame.js');
const serverPath = path.join(root, 'server.js');
const appPath = path.join(root, 'public', 'app.js');

function requireReplace(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Could not find patch marker: ${label}`);
  return text.replace(from, to);
}

if (!fs.existsSync(enginePath)) throw new Error(`Missing ${enginePath}`);
if (!fs.existsSync(endgamePath)) throw new Error(`Missing ${endgamePath}. Copy the full v0.5 package into the repo before running this patch.`);
let engine = fs.readFileSync(enginePath, 'utf8');

if (!engine.includes("from './endgame.js'")) {
  engine = `import { applyEndgameIntelligence } from './endgame.js';\n\n${engine}`;

  engine = requireReplace(
    engine,
    ' * Fourth Down Decision Engine v0.3',
    ' * Fourth Down Decision Engine v0.5',
    'engine version comment'
  );

  engine = requireReplace(
    engine,
    "    maxFgDistance: clamp(Number(input.maxFgDistance ?? 68), 50, 75),\n    baselineWp:",
    "    maxFgDistance: clamp(Number(input.maxFgDistance ?? 68), 50, 75),\n    endgameEnabled: input.endgameEnabled !== false,\n    baselineWp:",
    'normalizeInput endgame flag'
  );

  const anchorBlock = `  const goWp = anchorWp(rawBase, rawGoWp, s.baselineWp);\n  const puntWp = anchorWp(rawBase, rawPuntWp, s.baselineWp);\n  const fgWp = fgAvailable ? anchorWp(rawBase, rawFgWp, s.baselineWp) : null;`;

  const endgameBlock = `  const endgame = applyEndgameIntelligence(s, {\n    pConvert,\n    pFg,\n    kickDistance,\n    fgAvailable,\n    options: {\n      GO: rawGoWp,\n      FG: fgAvailable ? rawFgWp : null,\n      PUNT: rawPuntWp\n    }\n  });\n\n  const rawGoFinal = endgame.options.GO ?? rawGoWp;\n  const rawPuntFinal = endgame.options.PUNT ?? rawPuntWp;\n  const rawFgFinal = fgAvailable ? (endgame.options.FG ?? rawFgWp) : null;\n\n  const goWp = anchorWp(rawBase, rawGoFinal, s.baselineWp);\n  const puntWp = anchorWp(rawBase, rawPuntFinal, s.baselineWp);\n  const fgWp = fgAvailable ? anchorWp(rawBase, rawFgFinal, s.baselineWp) : null;`;
  engine = requireReplace(engine, anchorBlock, endgameBlock, 'endgame option integration');

  engine = requireReplace(
    engine,
    '    opponentYardline100,\n    wpSuccess:',
    '    opponentYardline100,\n    endgame,\n    wpSuccess:',
    'endgame return diagnostics'
  );

  engine = requireReplace(
    engine,
    'function buildDrivers(s, r, optimal, sensitivity) {\n  const drivers = [];',
    'function buildDrivers(s, r, optimal, sensitivity) {\n  const drivers = [];\n  if (r.endgame?.active) drivers.push(...(r.endgame.drivers || []));',
    'endgame explanation drivers'
  );

  engine = requireReplace(
    engine,
    "    modelVersion: 'v0.3-anchored-counterfactual',\n    modelStatus: s.baselineWp != null ? 'live-wp-anchored' : 'structural-unanchored',",
    "    modelVersion: 'v0.5-endgame-intelligence',\n    modelStatus: `${s.baselineWp != null ? 'live-wp-anchored' : 'structural-unanchored'}${s.endgameEnabled ? '+endgame' : '+legacy-endgame-off'}`,",
    'model version'
  );

  engine = requireReplace(
    engine,
    '      expectedOpponentYardlineAfterPunt: core.opponentYardline100,\n      liveAnchorUsed:',
    `      expectedOpponentYardlineAfterPunt: core.opponentYardline100,\n      endgame: {\n        active: Boolean(core.endgame?.active),\n        tags: core.endgame?.tags || [],\n        logitShifts: core.endgame?.shifts || { GO: 0, FG: 0, PUNT: 0 },\n        context: core.endgame?.context || null\n      },\n      liveAnchorUsed:`,
    'public endgame diagnostics'
  );

  fs.writeFileSync(enginePath, engine);
  console.log('Patched lib/decision-engine.js -> v0.5 Endgame Intelligence');
} else {
  console.log('lib/decision-engine.js already contains v0.5 endgame integration; skipping');
}

if (fs.existsSync(serverPath)) {
  let server = fs.readFileSync(serverPath, 'utf8');
  server = server.replace("modelVersion: 'v0.3.2-benchmark-mapping'", "modelVersion: 'v0.5-endgame-intelligence'");
  server = server.replace('4TH DOWN v0.3.2 running', '4TH DOWN v0.5 running');
  fs.writeFileSync(serverPath, server);
  console.log('Updated server health/version label');
}


if (fs.existsSync(appPath)) {
  let app = fs.readFileSync(appPath, 'utf8');
  if (!app.includes('ENDGAME •')) {
    const oldPill = '        <div class="anchorPill">${ev.diagnostics?.liveAnchorUsed ? \'LIVE WP ANCHORED\' : \'STRUCTURAL MODE\'}</div>';
    const newPill = '        <div class="anchorPill">${ev.diagnostics?.liveAnchorUsed ? \'LIVE WP ANCHORED\' : \'STRUCTURAL MODE\'}</div>\\n        ${ev.diagnostics?.endgame?.active ? `<div class="anchorPill">ENDGAME • ${esc((ev.diagnostics.endgame.tags || []).join(\' • \') || \'TERMINAL WINDOW\')}</div>` : \'\'}';
    if (app.includes(oldPill)) {
      app = app.replace(oldPill, newPill);
      fs.writeFileSync(appPath, app);
      console.log('Updated public/app.js with endgame audit badge');
    } else {
      console.warn('public/app.js endgame badge marker not found; core model patch is still valid');
    }
  }
}

console.log('\nV0.5 patch applied successfully. Run: npm test');
