import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const enginePath = path.join(root, 'lib', 'decision-engine.js');
const applyPath = path.join(root, 'scripts', 'apply-v05.mjs');

const bad = "    modelStatus: `${s.baselineWp != null ? 'live-wp-anchored' : 'structural-unanchored'}${s.endgameEnabled ? '+endgame' : '+legacy-endgame-off'}`,";
const good = "    modelStatus: `${s.baselineWp != null ? 'live-wp-anchored' : 'structural-unanchored'}${core.endgame?.active ? '+endgame' : ''}${s.endgameEnabled === false ? '+legacy-endgame-off' : ''}`,";

function patchFile(file) {
  if (!fs.existsSync(file)) return false;
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes(good)) {
    console.log(`Already fixed: ${path.relative(root, file)}`);
    return true;
  }
  if (!text.includes(bad)) {
    console.error(`Could not find the v0.5 modelStatus line in ${path.relative(root, file)}`);
    return false;
  }
  text = text.replace(bad, good);
  fs.writeFileSync(file, text);
  console.log(`Fixed: ${path.relative(root, file)}`);
  return true;
}

const engineOk = patchFile(enginePath);

// Keep the installer clean too, so a future fresh v0.5 application won't reintroduce the issue.
if (fs.existsSync(applyPath)) {
  let text = fs.readFileSync(applyPath, 'utf8');
  const escapedBad = `"    modelVersion: 'v0.5-endgame-intelligence',\\n    modelStatus: \\\`${s.baselineWp != null ? 'live-wp-anchored' : 'structural-unanchored'}${s.endgameEnabled ? '+endgame' : '+legacy-endgame-off'}\\\`,"`;
  const escapedGood = `"    modelVersion: 'v0.5-endgame-intelligence',\\n    modelStatus: \\\`${s.baselineWp != null ? 'live-wp-anchored' : 'structural-unanchored'}${core.endgame?.active ? '+endgame' : ''}${s.endgameEnabled === false ? '+legacy-endgame-off' : ''}\\\`,"`;
  if (text.includes(escapedBad)) {
    text = text.replace(escapedBad, escapedGood);
    fs.writeFileSync(applyPath, text);
    console.log('Fixed installer: scripts/apply-v05.mjs');
  } else {
    console.log('Installer did not need a change or uses a different layout.');
  }
}

if (!engineOk) process.exit(1);

console.log('\nModel-status hotfix applied.');
console.log('Non-endgame plays now keep the legacy status label.');
console.log('Actual terminal-window plays still receive +endgame.');
