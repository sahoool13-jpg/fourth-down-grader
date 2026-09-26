4TH DOWN v0.5.1 — GATED ENDGAME INTELLIGENCE

The 2021–2024 v0.5 development audit improved exact agreement but worsened
mean regret and the severity of some mistakes.

The harmful tape showed three recurring patterns:
1. long / low-probability FGs treated as terminal solutions
2. tying FGs overboosted when GO retained strong win value
3. punts penalized too broadly with 3–5 minutes remaining

v0.5.1 therefore:
- concentrates strong possession-scarcity logic inside 2:00
- requires credible make probability AND reasonable distance for go-ahead FG boosts
- blocks tying-FG boosts on short yardage
- heavily caps adjustments from 2:00–5:00
- leaves 2025 completely locked

INSTALL
1. Extract this ZIP.
2. Copy everything inside into Documents\GitHub\fourth-down-grader
3. Replace matching files.
4. Do NOT deploy to Render.
5. Double-click TEST-V051.bat.
6. If all tests pass, GitHub Desktop Summary:
   Refine gated endgame intelligence v0.5.1
7. Commit to main and Push origin.
8. Wait for:
   v0.5.1 gated endgame development audit
9. Do NOT run any 2025 holdout workflow.

The old automatic v0.5 development workflow is archived by this package so
lib/endgame.js changes do not create a mislabeled v0.5 audit.

Promotion gate requires positive net regret saved, improved endgame mean regret,
no meaningful strong-split deterioration, and no new >=10 pp harmful regression.
