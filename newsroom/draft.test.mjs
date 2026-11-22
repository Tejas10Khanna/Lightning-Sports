import assert from 'node:assert/strict';
import test from 'node:test';
import { geminiWriter, readBrief, writeDraft } from './draft.mjs';

const briefInput = {
  sport: 'Cricket',
  topic: 'How the middle overs changed the final',
  modelUseApproved: true,
  evidence: [
    { fact: 'The batting side was 50 for 0 after six overs.', url: 'https://cup.example/scorecard' },
    { fact: 'Spin bowlers took three wickets in the next four overs.', url: 'https://cup.example/scorecard' },
  ],
};
const brief = readBrief(JSON.stringify(briefInput));
const answer = {
  decision: 'draft',
  headline: 'The final turned in the middle overs',
  dek: 'Three wickets changed the shape of a promising start.',
  paragraphs: [
    { kind: 'reporting', text: 'The batting side reached 50 without loss in six overs.', evidenceIds: ['E1'] },
    { kind: 'analysis', text: 'Three wickets through spin suggest the chase lost its foundation in the middle overs.', evidenceIds: ['E1', 'E2'] },
    { kind: 'counterargument', text: 'Four overs alone give us little basis for a claim about either side’s long-term strategy.', evidenceIds: ['E2'] },
    { kind: 'analysis', text: 'The change is an argument for examining the transition out of the powerplay.', evidenceIds: ['E1', 'E2'] },
  ],
  gaps: [],
};

test('routes to sport-specific editorial instructions and retains source URLs locally', async () => {
  const cricket = await writeDraft(brief, async ({ instruction, input }) => {
    assert.match(instruction, /bowling matchups/);
    const payload = JSON.parse(input);
    assert.equal(payload.evidence[0].id, 'E1');
    assert.ok(!input.includes('cup.example'));
    return answer;
  });
  assert.equal(cricket.status, 'needs-human-verification');
  assert.equal(cricket.aiAssisted, true);
  assert.equal(cricket.author, 'Lightning Sports Desk');
  assert.equal(cricket.evidence[0].url, 'https://cup.example/scorecard');
  const football = readBrief(JSON.stringify({ ...briefInput, sport: 'Football' }));
  await writeDraft(football, async ({ instruction }) => {
    assert.match(instruction, /positioning, transitions/);
    return { decision: 'hold', gaps: ['Need a verified match timeline.'] };
  });
});

test('rejects unapproved evidence and blocks drafts with unknown citations or missing editorial elements', async () => {
  assert.throws(() => readBrief(JSON.stringify({ ...briefInput, modelUseApproved: false })), /approved for model use/);
  assert.throws(() => readBrief(JSON.stringify({ ...briefInput, sport: ['Cricket'] })));
  const invalid = structuredClone(answer);
  invalid.paragraphs[0].evidenceIds = ['E3'];
  await assert.rejects(writeDraft(brief, async () => invalid), /invalid paragraph or evidence reference/);
  invalid.paragraphs[0].evidenceIds = ['E1'];
  invalid.paragraphs[2].kind = 'analysis';
  await assert.rejects(writeDraft(brief, async () => invalid), /counterargument/);
  const hold = await writeDraft(brief, async () => ({ decision: 'hold', gaps: ['Need a verified scorecard.'] }));
  assert.equal(hold.status, 'insufficient-evidence');
  assert.equal(hold.paragraphs, undefined);
});

test('Gemini request uses structured JSON and treats incomplete output as a failure', async () => {
  const request = async (url, options) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    assert.ok(!url.includes('fake-test-key'));
    assert.equal(options.headers['x-goog-api-key'], 'fake-test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseJsonSchema.type, 'object');
    assert.equal(body.tools, undefined);
    return Response.json({ candidates: [{
      finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] },
    }] });
  };
  const draft = await writeDraft(brief, geminiWriter('fake-test-key', request));
  assert.equal(draft.headline, answer.headline);
  const incomplete = async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] });
  await assert.rejects(writeDraft(brief, geminiWriter('fake-test-key', incomplete)), /incomplete response/);
});
