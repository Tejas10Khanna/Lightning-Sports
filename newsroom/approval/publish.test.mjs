import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLiveArticle, commitArticle, prepareArticle } from './publish.mjs';

const revision = '1234567890abcdef1234567890abcdef';
const date = Date.parse('2026-11-22T06:00:00.000Z');
const packet = {
  sport: 'Cricket',
  headline: 'A score of 50: what changed?',
  dek: 'A fictional editorial.',
  evidence: [{ id: 'E1', url: 'https://cricket.example/score?team=a&season=1', fact: 'Private evidence note' }],
  paragraphs: [
    { kind: 'reporting', text: 'The batting side scored 50 & lost no wickets.', evidenceIds: ['E1'] },
    { kind: 'analysis', text: '![hidden](evil.png) <div> should be plain.', evidenceIds: ['E1'] },
    { kind: 'counterargument', text: 'A small sample limits the conclusion.', evidenceIds: ['E1'] },
  ],
};

test('generates stable Astro article Markdown while keeping evidence out of the article', () => {
  const article = prepareArticle(packet, revision, date);
  assert.equal(article.path, 'src/content/posts/2026-11-22-a-score-of-50-what-changed-1234567890ab.md');
  assert.match(article.markdown, /mainSport: \["Cricket"\]/);
  assert.match(article.markdown, /aiAssisted: true/);
  assert.doesNotMatch(article.markdown, /\[E1\]|cricket\.example/);
  assert.match(article.markdown, /\\!\\\[hidden\\\]/);
  assert.doesNotMatch(article.markdown, /<div>|Private evidence note/);
  assert.equal(prepareArticle(packet, revision, date).markdown, article.markdown);
  const wrongCitation = { ...packet, evidence: [] };
  assert.throws(() => prepareArticle(wrongCitation, revision, date), /Missing publication citation/);
});

test('creates a new file on main and reconciles repeat requests without overwriting', async () => {
  const article = prepareArticle(packet, revision, date);
  let created;
  let writes = 0;
  const request = async (url, options) => {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/Tejas10Khanna\/Lightning-Sports\/contents\/src\/content\/posts\//);
    assert.equal(options.headers.authorization, 'Bearer mock-github-key');
    if (options.method === 'PUT') {
      writes++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.branch, 'main');
      assert.equal(payload.sha, undefined);
      created = payload.content;
      return Response.json({ commit: { sha: 'example-commit' } }, { status: 201 });
    }
    if (!created) return new Response(null, { status: 404 });
    return Response.json({ encoding: 'base64', content: created });
  };
  assert.deepEqual(await commitArticle(article, 'mock-github-key', request), { commit: 'example-commit' });
  assert.deepEqual(await commitArticle(article, 'mock-github-key', request), { existing: true });
  await assert.rejects(commitArticle({ ...article, markdown: 'Changed document' }, 'mock-github-key', request),
    /already contains different content/);
  assert.equal(writes, 1);
});

test('requires a direct 200 HTML response to consider an article live', async () => {
  const article = prepareArticle(packet, revision, date);
  assert.equal(await checkLiveArticle(article.url, async (_, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: '/404' } });
  }), false);
  assert.equal(await checkLiveArticle(article.url, async () =>
    new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })), true);
});
