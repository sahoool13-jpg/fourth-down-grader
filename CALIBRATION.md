# v0.4.1 Calibration Integrity

v0.4.1 fixes an important validation bug in the v0.4 historical calibration.

## Root cause

The JavaScript calibration helper previously used `Number(x)` to test reference values. In JavaScript, `Number(null) === 0`, so an nfl4th `NA` exported as JSON `null` was incorrectly treated as a real 0% win probability.

That produced fake ~100 percentage-point regret cases when nfl4th simply had not priced an option. The most visible examples involved punts in deep opponent territory. nfl4th's punt-data support is built only for `yardline_100 > 30`, so a missing punt reference there must remain unavailable rather than become `0.0`.

## Integrity rules

- `null`, `undefined`, and empty reference values are unavailable.
- A genuine numeric `0` remains a valid 0% WP.
- Reference regret is computed only if nfl4th priced the primary model's chosen action.
- Unsupported primary choices are reported as **REFERENCE GAPS**, not model failures.
- Clean split-rate, regret, exact-call, and decision-safe metrics use comparable rows only.
- Full three-option coverage and primary-call coverage are displayed separately.
- The latest completed season remains the holdout and is not a tuning target.

## New outputs

The calibration report now includes:

- comparable row count and reference coverage rate
- full 3-option reference coverage rate
- reference-gap count
- genuine numeric-zero count
- clean exact-call agreement
- clean decision-safe rate
- clean strong-split rate
- separate clean failure tape and reference-gap tape

The workflow verifies that reference-gap rows never leak into the clean failure tape.
