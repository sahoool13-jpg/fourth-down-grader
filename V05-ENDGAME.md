# 4TH DOWN v0.5 — Endgame Intelligence

## Why this release exists

The cleaned v0.4.1 audit showed that several of the largest genuine misses were not ordinary fourth-down calibration errors. They were terminal-game errors: the model sometimes treated three points, a punt, and retained possession too similarly when the clock made those outcomes radically different.

v0.5 adds a dedicated structural layer for the final five minutes.

## What the layer knows

- **Possession scarcity:** punting while trailing becomes more expensive as the opponent can consume the remaining clock.
- **Must-touchdown states:** a field goal that still leaves the offense behind is discounted late.
- **Go-ahead field goals:** a make that turns a deficit into a lead receives explicit terminal value.
- **Tying field goals:** a make that preserves overtime receives explicit value, but less than taking the lead.
- **Clock-kill conversions:** when leading late, short-yardage conversions can eliminate the opponent's next possession.

All corrections are smooth log-odds shifts, not hard-coded copies of nfl4th calls. The layer is dormant outside the final five minutes.

## Scientific test design

### Development

The automatic workflow loads **2021–2024 only**. It scores every state twice:

1. legacy core, endgame layer OFF
2. v0.5, endgame layer ON

This gives a true paired before/after experiment on identical states.

### Holdout

**2025 is not loaded by the development workflow at all.**

The separate `v0.5 holdout unlock` workflow is manual-only and requires the exact confirmation text:

`UNLOCK-2025`

Do not run it until the development result has been reviewed.

## Promotion gate

v0.5 receives PASS only if, on 2021–2024:

- final-five-minute mean reference regret improves
- final-five-minute strong-split rate does not materially worsen
- overall mean reference regret does not materially worsen
- overall decision-safe rate does not materially worsen
- beneficial decision flips are at least as numerous as harmful flips

A PASS means "safe to inspect the holdout", not "model proven correct".
