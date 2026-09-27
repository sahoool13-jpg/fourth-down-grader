import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const COLLECTOR = path.join(REPO, 'scripts', 'prospective-collector.mjs');
const POLICY = path.join(REPO, 'data', 'prospective', '2026', 'policy.json');

function runCollector(cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COLLECTOR], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function startMockServer() {
  let benchmarkRequests = 0;
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.url === '/api/health') {
      return send(200, {
        ok: true,
        releaseVersion: 'v0.5.1',
        releaseStatus: 'PROMOTED',
        releaseAudit: 'PROMOTE',
        evaluatedCandidateCommit: '8daaa8f75787e4f28d25af6462142518f4594e9a',
        deployCommit: 'test-deploy',
        bootState: 'READY'
      });
    }

    if (req.url === '/api/live') {
      return send(200, {
        games: [{
          id: 'event-1',
          date: '2026-09-27T17:00:00Z',
          name: 'AAA @ BBB',
          state: 'in'
        }],
        ledger: [{
          eventId: 'event-1',
          id: 'play-44',
          gameName: 'AAA @ BBB',
          actualDecision: 'PUNT',
          offense: { id: '1', abbreviation: 'AAA', name: 'Alpha' },
          defense: { id: '2', abbreviation: 'BBB', name: 'Beta' },
          quarter: 2,
          clock: '8:21',
          secondsRemaining: 2301,
          ydstogo: 4,
          yardline100: 44,
          fieldPositionText: 'BBB 44',
          scoreDiff: 0,
          scoreText: 'AAA 7-7 BBB',
          timeouts: 3,
          opponentTimeouts: 3,
          baselineWp: 0.51,
          indoor: false,
          optimal: 'GO',
          certainty: 'CLEAR',
          edge: 0.018,
          options: { GO: 0.538, FG: 0.505, PUNT: 0.520 },
          grade: 'C',
          wpRegret: 0.018,
          sensitivity: { robustness: 0.91 },
          diagnostics: { endgame: { active: false, tags: [] }, liveAnchorUsed: true },
          verifiedState: true,
          possessionSource: 'PLAY_TEXT',
          fieldPositionSource: 'START_DOWN_DISTANCE_TEXT',
          description: 'A.Punter punts 44 yards to BBB 0, touchback.'
        }]
      });
    }

    if (req.url === '/api/evaluate' && req.method === 'POST') {
      for await (const _ of req) {}
      return send(200, {
        optimal: 'PUNT',
        certainty: 'TOSS-UP',
        edge: 0.001,
        baselineWp: 0.51,
        options: { GO: 0.518, FG: 0.500, PUNT: 0.519 },
        grade: 'A+',
        wpRegret: 0,
        sensitivity: { robustness: 0.67 },
        diagnostics: { endgame: { active: false, tags: [] }, liveAnchorUsed: true }
      });
    }

    if (req.url === '/api/benchmark/event-1') {
      benchmarkRequests++;
      return send(503, { error: 'reference temporarily unavailable' });
    }

    return send(404, { error: 'not found' });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    getBenchmarkRequests: () => benchmarkRequests,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

test('primary capture is committed to disk before optional reference enrichment can fail', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fourth-down-prospective-'));
  const dataDir = path.join(tmp, 'data', 'prospective', '2026');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.copyFile(POLICY, path.join(dataDir, 'policy.json'));
  await fs.writeFile(path.join(dataDir, 'decisions.json'), JSON.stringify({
    schemaVersion: 1,
    season: 2026,
    monitorStartAt: '2026-09-27T09:57:27Z',
    releaseTag: 'v0.5.1',
    evaluatedCandidateCommit: '8daaa8f75787e4f28d25af6462142518f4594e9a',
    records: []
  }, null, 2));

  const mock = await startMockServer();
  try {
    const common = {
      PRODUCTION_BASE_URL: mock.baseUrl,
      PROSPECTIVE_FORCE: 'true'
    };

    const capture = await runCollector(tmp, { ...common, PROSPECTIVE_PHASE: 'capture' });
    assert.equal(capture.code, 0, capture.stderr || capture.stdout);
    assert.equal(mock.getBenchmarkRequests(), 0, 'capture phase must not contact benchmark endpoint');

    const afterCapture = JSON.parse(await fs.readFile(path.join(dataDir, 'decisions.json'), 'utf8'));
    assert.equal(afterCapture.records.length, 1);
    assert.equal(afterCapture.records[0].id, 'event-1:play-44');
    assert.equal(afterCapture.records[0].model.v051.optimal, 'GO');
    assert.equal(afterCapture.records[0].decision.actual, 'PUNT');
    assert.equal(afterCapture.records[0].referencePipeline.code, 'PENDING');
    const sealedHash = afterCapture.records[0].snapshotHash;
    assert.ok(sealedHash);

    const enrich = await runCollector(tmp, { ...common, PROSPECTIVE_PHASE: 'enrich' });
    assert.equal(enrich.code, 0, enrich.stderr || enrich.stdout);
    assert.ok(mock.getBenchmarkRequests() >= 1);

    const afterEnrich = JSON.parse(await fs.readFile(path.join(dataDir, 'decisions.json'), 'utf8'));
    assert.equal(afterEnrich.records.length, 1, 'reference failure must never delete primary archive');
    assert.equal(afterEnrich.records[0].snapshotHash, sealedHash, 'reference enrichment must not rewrite frozen primary snapshot');
    assert.equal(afterEnrich.records[0].reference, null);
    assert.equal(afterEnrich.records[0].referencePipeline.code, 'PIPELINE_ERROR');
  } finally {
    await mock.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
