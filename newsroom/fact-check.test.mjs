import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDraft, draftWithEvidenceReview } from './fact-check.mjs';

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

test('rechecks one routine revision and preserves the hold if it cannot be cleared', async () => {
  const brief = { sport: 'Football', topic: 'The winning goal', notes: draft.evidence };
  const original = {
    decision: 'draft', headline: draft.headline, dek: draft.dek, gaps: [],
    paragraphs: [
      { kind: 'reporting', text: 'One goal decided the match.', primaryEvidenceId: 'E1', evidenceIds: [] },
      { kind: 'analysis', text: 'The late goal mattered.', primaryEvidenceId: 'E2', evidenceIds: [] },
      { kind: 'counterargument', text: 'The score alone says little about the chances.', primaryEvidenceId: 'E1', evidenceIds: [] },
      { kind: 'analysis', text: 'The timing limited the response.', primaryEvidenceId: 'E2', evidenceIds: [] },
    ],
  };
  for (const risk of ['routine', 'sensitive']) {
    for (const revisionPasses of [true, false]) {
      let calls = 0;
      const revised = { ...original, headline: 'The late winner left little time to reply' };
      const result = await draftWithEvidenceReview(brief, async ({ input }) => {
        calls++;
        if (calls === 1) return original;
        if (calls === 3) {
          assert.equal(JSON.parse(input).revision.checks[0].unitId, 'headline');
          return revised;
        }
        const verdict = checkUnits(input, risk);
        if (calls === 2 || !revisionPasses) verdict.checks[0].verdict = 'unsupported';
        return verdict;
      });
      const accepted = risk === 'routine' && revisionPasses;
      assert.equal(calls, risk === 'routine' ? 4 : 2);
      assert.equal(result.headline, accepted ? revised.headline : original.headline);
      assert.equal(result.status, accepted ? 'needs-human-verification' : 'held-for-editorial-review');
    }
  }
});
