4TH DOWN v0.5.1 — PRODUCTION PROMOTION PACKAGE

This package is intentionally boring in the most important place:
IT DOES NOT MODIFY THE FOOTBALL MODEL.

The release audit already said PROMOTE. Production promotion is now about:
- version consistency
- deployment identity
- API parity
- live-feed health
- immutable release tagging

FILES CHANGED
- package.json
- server.js
- public/index.html
- public/endgame-lab.html
- public/endgame-lab.js
- public/release.json
- start-windows.bat
- README.md
- ONLINE-DEPLOY.txt

FILES ADDED
- scripts/smoke-production.mjs
- test/release-metadata.test.js
- .github/workflows/v051-production-smoke.yml

FILES DELIBERATELY NOT INCLUDED
- lib/decision-engine.js
- lib/endgame.js
- lib/calibration.js
- lib/espn.js
- lib/benchmark.js

That is deliberate. Those are frozen.

GITHUB DESKTOP SUMMARY
Promote v0.5.1 production release

Then Push origin. Render is configured to auto-deploy commits.

After pushing, run:
GitHub > Actions > v0.5.1 production smoke + tag

Confirmation:
PROMOTE-V051

Do not call the release complete until that workflow is green and the v0.5.1 tag exists.
