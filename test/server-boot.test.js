import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 18000 + (process.pid % 1000);

test('server opens a port and reaches READY state', { timeout: 12000 }, async () => {
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), RENDER_GIT_COMMIT: 'boot-test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  try {
    let body = null;

    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 150));

      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        body = await response.json();

        if (response.status === 200 && body?.bootState === 'READY') break;

        if (body?.bootState === 'FAILED') {
          assert.fail(`server boot failed: ${body.bootError}`);
        }
      } catch {}
    }

    assert.ok(body, `health endpoint never responded\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    assert.equal(body.bootState, 'READY', `server did not reach READY\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    assert.equal(body.releaseVersion, 'v0.5.1');
    assert.equal(body.releaseStatus, 'PROMOTED');
    assert.match(stdout, /port OPEN/);
    assert.match(stdout, /is READY/);
  } finally {
    child.kill('SIGTERM');
  }
});
