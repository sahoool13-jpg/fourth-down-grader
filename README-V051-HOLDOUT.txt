4TH DOWN v0.5.1 — 2025 HOLDOUT UNLOCK

WHAT THIS PACKAGE DOES
- Adds a new manual GitHub Actions workflow:
    v0.5.1 holdout unlock
- Archives the obsolete v0.5 holdout workflow.
- Does NOT change the decision model.
- Does NOT change v0.5.1 coefficients or endgame rules.
- Does NOT deploy anything to Render.

SAFETY CHECKS
Before touching 2025, the workflow verifies:
1. v051-development.json exists
2. candidate is v0.5.1
3. phase is development
4. promotion gate is PASS
5. development data contains no 2025 season

Then it:
1. runs the full unit-test suite
2. exports nfl4th reference data for 2025 only
3. verifies strict 2025-only isolation
4. scores frozen v0.5.1 vs the legacy core
5. verifies the output is v0.5.1 + holdout + 2025-only
6. commits v051-holdout*.json

INSTALL
1. Extract this ZIP.
2. Copy the .github folder into:
   Documents\GitHub\fourth-down-grader
3. Choose Replace files in destination.
4. GitHub Desktop Summary:
   Add locked v0.5.1 2025 holdout workflow
5. Commit to main and Push origin.
6. Do NOT deploy to Render.

RUN THE HOLDOUT
1. GitHub -> Actions.
2. Select "v0.5.1 holdout unlock".
3. Click "Run workflow".
4. In the confirmation field type exactly:
      UNLOCK-2025
5. Run it once.
6. Wait for the green check.
7. Send the completed Actions screen back to ChatGPT.

DO NOT
- change lib/endgame.js before running this
- change decision-engine coefficients before running this
- run the archived v0.5 holdout workflow
- deploy to Render yet

Treat the 2025 result as evaluation, not a tuning dataset.
