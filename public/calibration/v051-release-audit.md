# 4TH DOWN v0.5.1 Release Audit

**Verdict: PROMOTE**

Generated: 2026-09-26T20:41:53.603Z

## Integrity
- 2025-only reference rows: **3,946**
- Recomputed comparable states: **3,946**
- Saved holdout reproduction: **PASS**
- nfl4th version: **1.0.7**
- Bootstrap: **10,000 paired resamples**, deterministic seed 5102025

## Holdout performance
| Metric | Legacy | v0.5.1 | Direction |
|---|---:|---:|---|
| Exact agreement | 74.58% | 74.94% | better |
| Decision-safe | 87.35% | 87.56% | better |
| Mean regret | 0.317 pp | 0.305 pp | better |
| Strong splits | 5.47% | 5.35% | better |
| Worst regret | 15.239 pp | 8.190 pp | better |
| Endgame mean regret | 0.439 pp | 0.336 pp | better |
| Final-two mean regret | 0.522 pp | 0.337 pp | better |

## Paired bootstrap
Positive values favor v0.5.1.

| Slice | Mean regret saved, pp | 95% bootstrap CI | P(improvement > 0) |
|---|---:|---:|---:|
| Overall | 0.0128 | 0.0034 to 0.0249 | 99.95% |
| Final 5 min | 0.1029 | 0.0291 to 0.1998 | 99.91% |
| Final 2 min | 0.1854 | 0.0380 to 0.3770 | 99.86% |
| Final 60 sec | 0.3937 | 0.0453 to 0.8642 | 99.10% |

## Flip audit
- Total flips: **22**
- Beneficial: **17**
- Harmful: **3**
- Neutral: **2**
- Net reference regret saved: **50.43 pp**
- Worst new harm: **2.62 pp**

### Harmful flips
1. **2025_12_BUF_HOU** — BUF, Q4 0:51, 4th & 27, y100 70, diff -4. PUNT → GO; reference PUNT; damage **2.62 pp**. Tags: TRAILING_PUNT_SCARCITY.
2. **2025_07_IND_LAC** — LAC, Q4 3:36, 4th & 27, y100 45, diff -14. FG → GO; reference FG; damage **0.16 pp**. Tags: FG_DOES_NOT_TIE_OR_LEAD.
3. **2025_01_CAR_JAX** — JAX, Q4 2:00, 4th & 3, y100 10, diff 13. FG → GO; reference FG; damage **0.05 pp**. Tags: CONVERSION_CAN_SEAL.

## Release gate
- ✅ frozenResultReproduced
- ✅ overallMeanRegretImproves
- ✅ overallRegretBootstrap95AboveZero
- ✅ endgameMeanRegretImproves
- ✅ endgameRegretBootstrap95AboveZero
- ✅ finalTwoMeanRegretImproves
- ✅ finalTwoRegretBootstrap95AboveZero
- ✅ decisionSafeDoesNotWorsen
- ✅ strongSplitsDoNotWorsen
- ✅ beneficialFlipsOutnumberHarmful
- ✅ positiveNetRegretSaved
- ✅ noFivePointNewHarm
- ✅ tailRiskImproves

## Decision
**PROMOTE**

The frozen v0.5.1 candidate cleared the release audit. Promote this exact candidate to production, then monitor prospectively without retuning it.
