4TH DOWN v0.5.1 — HOLDOUT RESULT RECOVERY

WHAT HAPPENED
The first 2025 workflow did NOT fail in the model or in nfl4th scoring.

It successfully completed:
- v0.5.1 development-gate verification
- unit tests
- 2025 nfl4th reference export
- strict 2025-only source isolation
- frozen v0.5.1 scoring

It failed AFTER scoring, in the post-score "Verify holdout result" step.

The original verifier redundantly expected optional report metadata to contain a
specific seasons array even though the workflow had already proved season
isolation directly from the raw reference rows.

WHAT THIS RECOVERY DOES
- changes NO model code
- changes NO decision coefficients
- changes NO endgame rules
- uses the same frozen v0.5.1 scorer
- uses 2025 only
- proves season isolation directly from source rows
- saves an explicit isolation provenance JSON
- uploads the holdout output as a GitHub artifact BEFORE post-score checks
- validates only stable report fields afterward
- commits the recovered evaluation result

IMPORTANT
2025 has now been opened because the original scoring step ran successfully.
This recovery is therefore a reproduction/persistence run of the SAME frozen
evaluation, not a fresh unseen holdout and not a tuning pass.

INSTALL
1. Extract the ZIP.
2. Copy the .github folder into:
   Documents\GitHub\fourth-down-grader
3. Choose Replace files in destination.
4. GitHub Desktop Summary:
   Fix v0.5.1 holdout result persistence
5. Commit to main and Push origin.
6. Do NOT deploy to Render.

RUN
1. GitHub -> Actions.
2. Select "v0.5.1 holdout result recovery".
3. Click Run workflow.
4. Type exactly:
      RECOVER-2025
5. Run once.
6. Wait for the green check.
7. Send the completed screen to ChatGPT.

DO NOT
- modify lib/endgame.js
- tune any coefficients
- deploy to Render
- use the archived "v0.5.1 holdout unlock" workflow
