import assert from 'node:assert/strict';
import test from 'node:test';
import { footballBrief } from './football-brief.mjs';

const match = {
  home: 'Chelsea',
  away: 'Leeds United',
  halfTime: [1, 1],
  fullTime: [1, 4],
  sourceUrl: 'https://example.test/scorecard',
  modelUseApproved: true,
};

test('keeps the home and away score order in a brief with a private source link', () => {
  const brief = footballBrief(match);
  assert.equal(brief.sport, 'Football');
  assert.match(brief.evidence[0].fact, /1–1 at half-time/);
  assert.match(brief.evidence[1].fact, /ended 1–4/);
  assert.equal(brief.evidence[1].url, match.sourceUrl);
});

test('rejects unapproved, missing, and inconsistent match evidence', () => {
  assert.throws(() => footballBrief({ ...match, modelUseApproved: false }), /approved for model use/);
  assert.throws(() => footballBrief({ ...match, fullTime: [null, 4] }), /consistent/);
  assert.throws(() => footballBrief({ ...match, halfTime: [2, 1] }), /consistent/);
});
