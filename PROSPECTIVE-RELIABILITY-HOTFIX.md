# 4TH DOWN v0.5.1 — Prospective Reliability Hotfix

This patch changes **monitoring infrastructure only**. It does not alter the v0.5.1 football model, its coefficients, release tag, or production decision logic.

## What changed

1. **Primary archive first**
   - The workflow now runs the collector in `capture` mode first.
   - It archives new v0.5.1 decisions and pushes them to `main` before any nfl4th benchmark request is attempted.

2. **Reference enrichment is secondary**
   - nfl4th enrichment runs only after the primary archive is safe.
   - If nfl4th is unavailable, the workflow keeps the primary record and marks reference status for later retry.
   - Reference-enrichment failure no longer threatens the primary 2026 archive.

3. **Bounded concurrency**
   - Benchmark requests run with a concurrency limit of 3 rather than serially across an entire NFL slate.
   - Benchmark requests have bounded retries/timeouts.

4. **Faster optional legacy comparison**
   - Legacy comparison is still stored at capture time, but it has a strict one-attempt/10-second ceiling per request and runs concurrently.
   - Failure does not prevent the v0.5.1 primary record from being sealed.

5. **Archive write-back preflight**
   - Every workflow run performs an authenticated `git push --dry-run origin HEAD:main` before games are collected.
   - The actual primary push remains a hard requirement with three retry attempts.

6. **Stable runner environment**
   - Workflow runner is pinned to `ubuntu-24.04` rather than `ubuntu-latest`.
   - GitHub checkout/setup actions use the current Node-24-runtime generation while project scripts still run on Node 22.

7. **Failure-injection test**
   - New integration test proves that a real primary record is written before reference enrichment.
   - It then deliberately makes the benchmark endpoint return HTTP 503 and verifies:
     - the collector still exits safely,
     - the archived decision remains,
     - its frozen snapshot hash is unchanged,
     - the reference pipeline is marked `PIPELINE_ERROR` for retry.

## Install

Copy these files into the matching paths in your local `fourth-down-grader` repository:

- `.github/workflows/prospective-2026.yml`
- `scripts/prospective-collector.mjs`
- `test/prospective-reliability.test.js`

GitHub Desktop summary:

`Harden 2026 prospective monitor reliability`

Then:

1. Commit to `main`
2. Push origin
3. GitHub → Actions → **2026 prospective monitor** → **Run workflow**
4. Leave `force = false`

## What a good run should show

The job should pass these stages in order:

- Verify frozen production tag
- Prospective monitor tests
- Verify authenticated archive write-back path
- Capture primary v0.5.1 decisions
- Commit primary archive before enrichment
- Enrich archived decisions with nfl4th
- Commit reference enrichment

If there are no eligible decisions yet, both commit steps can correctly say there was nothing to write.

## Render

**No Render redeploy is required for this hotfix.**

It changes the GitHub collector/workflow/test harness only. The production v0.5.1 grader and prospective dashboard stay untouched.
