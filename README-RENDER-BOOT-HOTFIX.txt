4TH DOWN v0.5.1 — RENDER BOOT HOTFIX

WHY THIS EXISTS
Render successfully built commit 61156f0 and launched "node server.js", but then
reported:

  Port scan timeout reached, no open ports detected.

The previous server used static top-level imports for the ESPN adapter,
decision engine and benchmark adapter. If module initialization stalls on the
Render runtime, Node never reaches server.listen(), so Render sees no port.

THIS HOTFIX
1. Pins production Node to the tested Node 22 line:
     "node": ">=22 <23"
2. Opens the HTTP port BEFORE loading application modules.
3. Loads ESPN / decision / benchmark modules asynchronously after the socket is open.
4. Makes /api/health expose:
   - bootState
   - bootError
   - nodeVersion
   - port
   - deploy commit
5. Returns HTTP 503 while modules are loading and HTTP 500 with the actual stack
   if module boot fails.
6. Adds a test that starts the real server, hits /api/health, and requires READY.

WHAT THIS DOES NOT CHANGE
- no decision coefficients
- no v0.5.1 endgame logic
- no calibration logic
- no ESPN parser logic
- no nfl4th benchmark logic
- no release-audit evidence

INSTALL
1. Extract ZIP.
2. Copy package.json, server.js and test/ into:
   Documents\GitHub\fourth-down-grader
3. Replace matching files.
4. GitHub Desktop summary:
     Fix Render startup for v0.5.1
5. Commit to main.
6. Push origin.

THEN
Render still appears to be configured for manual deploys in the dashboard.

Go to Render:
  Manual Deploy -> Deploy latest commit

Wait for the logs to show:
  4TH DOWN v0.5.1 port OPEN on 0.0.0.0:10000
  [boot] application modules loaded; v0.5.1 is READY.

Then open:
  https://fourth-down-grader.onrender.com/api/health

Expected:
  "ok": true
  "bootState": "READY"
  "releaseVersion": "v0.5.1"
  "releaseStatus": "PROMOTED"

Only then return to GitHub Actions and rerun:
  v0.5.1 production smoke + tag

Do not retune or change the football model.
