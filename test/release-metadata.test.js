import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('production release metadata is internally consistent', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const rel = JSON.parse(fs.readFileSync('public/release.json', 'utf8'));
  const server = fs.readFileSync('server.js', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');

  assert.equal(pkg.version, '0.5.1');
  assert.equal(rel.releaseVersion, 'v0.5.1');
  assert.equal(rel.status, 'PROMOTED');
  assert.equal(rel.releaseAudit, 'PROMOTE');
  assert.equal(rel.evaluatedCandidateCommit, '8daaa8f75787e4f28d25af6462142518f4594e9a');
  assert.match(server, /const RELEASE_VERSION = 'v0\.5\.1'/);
  assert.match(server, /const RELEASE_STATUS = 'PROMOTED'/);
  assert.match(html, /MODEL v0\.5\.1/);
  assert.match(html, /PROMOTED/);
});
