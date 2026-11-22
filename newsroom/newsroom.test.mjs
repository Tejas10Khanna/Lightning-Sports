import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { collectFeed, parseFeed, readSourceConfig } from './feeds.mjs';
import { encryptReport, decryptReport, readReportKey } from './report.mjs';
import { buildReview } from './review.mjs';

const now = Date.parse('2026-11-22T08:00:00Z');
const time = 'Sun, 22 Nov 2026 07:45:00 GMT';
const key = randomBytes(32);
const rss = (...items) => '<rss version="2.0"><channel>' + items.join('') + '</channel></rss>';
const item = (title, url, date = time) =>
  '<item><title>' + title + '</title><link>' + url + '</link><pubDate>' + date + '</pubDate></item>';
const source = (id, sport, role, organization = id) => ({
  id, sport, role, organization,
  feedUrl: 'https://' + id + '.example/feed',
  articleHosts: [id + '.example'],
  permissionUrl: 'https://' + id + '.example/terms',
});

test('reads RSS and Atom without importing article body or unsafe XML', () => {
  assert.deepEqual(parseFeed(rss(item('A &amp; B', 'https://sport.example/article'))), [{
    title: 'A & B', link: 'https://sport.example/article', publishedAt: time,
  }]);
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry>' +
    '<title><![CDATA[Match report]]></title><updated>2026-11-22T07:45:00Z</updated>' +
    '<link rel="self" href="https://sport.example/feed"/><link href="https://sport.example/article"/>' +
    '<content>Story body</content></entry></feed>';
  assert.deepEqual(parseFeed(atom), [{
    title: 'Match report', link: 'https://sport.example/article', publishedAt: '2026-11-22T07:45:00Z',
  }]);
  assert.throws(() => parseFeed('<!DOCTYPE rss SYSTEM "https://sport.example/doc"><rss/>'), /document type/);
  assert.throws(() => parseFeed('<rss><channel></rss>'));
  assert.throws(() => collectSourceConfig([]), /approved sources/);
  assert.throws(() => collectSourceConfig([source('league', 'Cricket', 'primary'), source('league', 'Football', 'primary')]),
    /position 2/);
});

function collectSourceConfig(sources) {
  return readSourceConfig(JSON.stringify(sources));
}

test('polls only configured feeds and bounds the response', async () => {
  const configured = source('football', 'Football', 'primary');
  await assert.rejects(collectFeed(configured, async (url, options) => {
    assert.equal(url, configured.feedUrl);
    assert.equal(options.redirect, 'error');
    return new Response(new Uint8Array(1_000_001));
  }), /size limit/);
});

test('groups duplicate coverage, filters old and archived leads, ranks candidates, and reuses duplicate state', async () => {
  const sources = collectSourceConfig([
    source('league', 'Cricket', 'primary'), source('desk', 'Cricket', 'reporting'),
    source('football', 'Football', 'reporting'), source('failed', 'Football', 'reporting'),
  ]);
  const fetchFeed = async (url) => {
    switch (new URL(url).hostname) {
      case 'league.example':
        return new Response(rss(
          item('A tight Test final', 'https://league.example/test?utm_campaign=feed#article'),
          item('Final goes to the last over', 'https://league.example/test'),
          item('Already published', 'https://league.example/archive'),
          item('Stale news', 'https://league.example/stale', 'Thu, 19 Nov 2026 07:45:00 GMT'),
          item('Future news', 'https://league.example/future', 'Mon, 23 Nov 2026 07:45:00 GMT'),
          item('Wrong domain', 'https://different.example/news'),
        ));
      case 'desk.example':
        return new Response(rss(item('A tight Test final!', 'https://desk.example/final')));
      case 'football.example':
        return new Response(rss(item('League title decided', 'https://football.example/title')));
      default:
        return new Response(null, { status: 503 });
    }
  };
  const options = {
    sources, archiveSlugs: ['2026-11-22-already-published'], key, now, fetchFeed,
  };
  const first = await buildReview({ ...options, storedSeen: {} });
  assert.deepEqual(first.report.failedSources, ['failed']);
  assert.deepEqual(first.report.candidates.map((entry) => entry.sport), ['Cricket', 'Football']);
  const [lead] = first.report.candidates;
  assert.equal(lead.status, 'needs-human-verification');
  assert.equal(lead.primarySource, true);
  assert.equal(lead.organizations, 2);
  assert.deepEqual(lead.sources.map((entry) => entry.url), ['https://league.example/test', 'https://desk.example/final']);
  assert.equal(lead.sources[0].permissionUrl, 'https://league.example/terms');
  assert.ok(Object.keys(first.seen).every((digest) => /^[0-9a-f]{64}$/.test(digest)));
  const repeat = await buildReview({ ...options, now: now + 60_000, storedSeen: first.seen });
  assert.deepEqual(repeat.report.candidates, []);
});

test('authenticates encrypted reports and rejects tampering', () => {
  assert.deepEqual(readReportKey(key.toString('base64')), key);
  assert.throws(() => readReportKey('not-a-key'));
  const report = { candidates: [{ workingHeadline: 'Private lead' }] };
  const encrypted = encryptReport(report, key);
  assert.ok(!encrypted.includes(Buffer.from('Private lead')));
  assert.deepEqual(JSON.parse(decryptReport(encrypted, key)), report);
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptReport(encrypted, key));
});
