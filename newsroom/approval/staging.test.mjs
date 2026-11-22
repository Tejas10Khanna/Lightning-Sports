import assert from 'node:assert/strict';
import test from 'node:test';
import { stagingPacket } from './staging-packet.mjs';
import { runStagingCheck } from './staging.mjs';

const revision = 'ab'.repeat(16);

test('uses an explicitly fictional packet tied to the requested workflow run', () => {
  const packet = stagingPacket('12345-1', 'timeout');
  assert.equal(packet.testOnly, true);
  assert.match(packet.headline, /STAGING ONLY.*12345-1/);
  assert.match(packet.dek, /five minutes/);
  assert.ok(packet.evidence.every((entry) => entry.url.startsWith('https://football.example/')));
  assert.equal(stagingPacket('arbitrary-input', 'approve'), null);
  assert.equal(stagingPacket('12345-1', 'toString'), null);
});

test('waits for the real recorded timeout rather than just counting elapsed time', async () => {
  let time = 0;
  let statusReads = 0;
  const result = await runStagingCheck({
    scenario: 'timeout', runKey: '12345-1', now: () => time,
    pause: async (duration) => { time += duration; }, log: () => {},
    service: async (path, payload) => {
      if (path === '/staging-reviews') {
        assert.deepEqual(payload, { runKey: '12345-1', scenario: 'timeout' });
        return { revision, status: 'awaiting-decision' };
      }
      assert.equal(path, '/reviews/' + revision);
      statusReads++;
      return {
        status: time >= 300_000 ? 'manual-review' : 'awaiting-decision',
        testOnly: true, deliveredAt: 1000, deadline: 301_000,
        expiredAt: time >= 300_000 ? 301_000 : undefined,
      };
    },
  });
  assert.equal(result, 'manual-review');
  assert.ok(statusReads > 1);
});

test('reports an early expiry, incorrect button press, or non-staging response as a failure', async () => {
  const run = (scenario, result) => runStagingCheck({
    scenario, runKey: '12345-1', log: () => {},
    service: async (path) => path === '/staging-reviews' ? { revision, status: 'awaiting-decision' } : result,
  });
  const state = { testOnly: true, deliveredAt: 1000, deadline: 301_000 };
  await assert.rejects(run('timeout', { ...state, status: 'manual-review', expiredAt: 300_999 }), /before its deadline/);
  await assert.rejects(run('approve', { ...state, status: 'rejected' }), /different outcome/);
  await assert.rejects(run('approve', { ...state, status: 'approved', testOnly: false }), /valid five-minute window/);
});
