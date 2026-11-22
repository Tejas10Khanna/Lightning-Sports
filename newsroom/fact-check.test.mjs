import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDraft } from './fact-check.mjs';

const draft = {
  status: 'needs-human-verification',
  headline: 'The timing of the winning goal mattered',
  dek: 'The goal came in the 75th minute.',
  paragraphs: [
    { kind: 'reporting', text: 'One goal decided the match.', evidenceIds: ['E1'] },
    { kind: 'analysis', text: 'A 75th-minute goal leaves less time to respond than an early goal.', evidenceIds: ['E2'] },
  ],
  evidence: [
    { id: 'E1', fact: 'The final score was 1–0.', url: 'https://football.example/score' },
    { id: 'E2', fact: 'The winning goal came in the 75th minute.', url: 'https://football.example/timeline' },
  ],
};

function checkUnits(input, risk = 'routine') {
  const { units } = JSON.parse(input);
  return {
    risk,
    checks: units.map(({ id, evidenceIds }) => ({
      unitId: id, verdict: 'supported', explanation: 'Supported by the supplied note.', evidenceIds,
    })),
  };
}

test('audits headline, dek, and each paragraph while keeping the packet for human verification', async () => {
  const result = await checkDraft(draft, async ({ input }) => {
    assert.doesNotMatch(input, /football\.example/);
    return checkUnits(input);
  });
  assert.deepEqual(result.factCheck.checks.map(({ unitId }) => unitId),
    ['headline', 'dek', 'paragraph-1', 'paragraph-2']);
  assert.equal(result.factCheck.scope, 'supplied-evidence');
  assert.equal(result.status, 'needs-human-verification');
});

test('holds a draft with a contradiction or sensitive material', async () => {
  const contradicted = await checkDraft(draft, async ({ input }) => {
    const result = checkUnits(input);
    result.checks[1].verdict = 'contradicted';
    return result;
  });
  assert.equal(contradicted.status, 'held-for-editorial-review');
  const sensitive = await checkDraft(draft, async ({ input }) => checkUnits(input, 'sensitive'));
  assert.equal(sensitive.status, 'held-for-editorial-review');
});

test('rejects duplicate check IDs and evidence outside a paragraph’s cited notes', async () => {
  await assert.rejects(checkDraft(draft, async ({ input }) => {
    const result = checkUnits(input);
    result.checks[0].unitId = 'dek';
    return result;
  }), /missing unit/);
  await assert.rejects(checkDraft(draft, async ({ input }) => {
    const result = checkUnits(input);
    result.checks[2].evidenceIds = ['E2'];
    return result;
  }), /invalid evidence reference/);
});

test('skips the model call for a writer hold', async () => {
  const held = { status: 'insufficient-evidence', gaps: ['Need a scorecard.'] };
  assert.equal(await checkDraft(held, async () => assert.fail('Unexpected model call')), held);
});
