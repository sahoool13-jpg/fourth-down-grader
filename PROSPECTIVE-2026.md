4TH DOWN v0.5.1 — 2026 PROSPECTIVE MONITOR
================================================

PURPOSE
The production model is now frozen. This package begins true forward monitoring.

The key idea:
- observe 2026
- archive every eligible fourth-down decision
- compare coaches against v0.5.1 outcome-blind
- attach nfl4th later/when available
- do NOT tune v0.5.1
- preregister what would be enough evidence to justify v0.6 research

PROSPECTIVE BOUNDARY
The v0.5.1 production tag was created at:

2026-09-27T09:57:27Z

Only games whose scheduled kickoff is at or after that timestamp are eligible.

This is intentionally strict. A game already underway before the production tag does not enter the prospective sample.

WHAT IS STORED
For each decision:
- event + play ID
- possession and opponent
- exact pre-snap state
- score / clock / field position / yards to go / timeouts
- v0.5.1 GO / FG / PUNT snapshot
- v0.5.1 optimal call, certainty, grade and WPA burn
- legacy/pre-endgame snapshot for frozen comparison
- actual coach call
- play result text stored separately
- source-integrity fields
- nfl4th match when available
- immutable SHA-256 snapshot fingerprint

The collector never rewrites the original pre-snap/model snapshot after capture.
Reference data may be added later.

AUTOMATION
GitHub Action:
  2026 prospective monitor

Runs at minute 07 and 37 of every hour.

During Mar-Jul the scheduled collector no-ops before contacting production.
Manual runs can force collection.

The collector commits ONLY:
  data/prospective/2026/

It refuses to continue if the v0.5.1 tag moves or production is not the promoted frozen candidate.

V0.6 PREREGISTERED GUARDRAILS
No model tuning eligibility until:
- 500 gradable decisions
- 250 nfl4th-comparable decisions
- 75 endgame nfl4th-comparable decisions

Research triggers after maturity:
- exact agreement < 72%
- decision-safe rate < 84%
- mean reference regret > 0.405 pp
- strong split rate > 7.5%
- v0.5.1 loses net reference regret to legacy across at least 20 flips
- same diagnostic tag produces >=8 harmful flips AND >=12 pp cumulative harm

Immediate review trigger:
- any single >=8 pp reference-regret miss

An immediate review is NOT permission to tune from one play.

DASHBOARD
After deployment:
  https://fourth-down-grader.onrender.com/prospective.html

The dashboard reads the live archive directly from GitHub raw data, so data updates do not require a Render redeploy.

INSTALL
1. Extract this ZIP.
2. Copy everything inside into:
   Documents\GitHub\fourth-down-grader
3. Replace matching files if asked.
4. GitHub Desktop summary:
   Add 2026 prospective monitor
5. Commit to main.
6. Push origin.

FIRST RUN
Go to:
GitHub -> Actions -> 2026 prospective monitor

Click Run workflow.
Leave force = false.
Run it.

At the current release time, it is completely acceptable for this first run to archive zero decisions. The strict boundary is doing its job.

DEPLOY DASHBOARD
Render is currently manual-deploying this service.

After the GitHub push:
Render -> Manual Deploy -> Deploy latest commit

This deploy only adds the prospective dashboard. It does not change football-model logic.

Then open:
https://fourth-down-grader.onrender.com/prospective.html

DO NOT
- modify v0.5.1 coefficients
- move the v0.5.1 tag
- backfill games that kicked off before the prospective boundary
- treat a coach outcome as evidence that the pre-snap decision was right
- treat missing nfl4th actions as 0% WP
