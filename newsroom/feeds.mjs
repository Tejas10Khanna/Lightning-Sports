import sax from 'sax';

const maxFeedBytes = 1_000_000;
const maxEntries = 100;
const sports = new Set(['Cricket', 'Football']);
const roles = new Set(['primary', 'reporting']);

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port) return url;
  } catch {
    // Malformed URLs are ineligible.
  }
  return null;
}

export function readSourceConfig(json) {
  let sources;
  try {
    sources = JSON.parse(json || '[]');
  } catch {
    throw new Error('Approved sources must be valid JSON.');
  }
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 20) {
    throw new Error('Configure between 1 and 20 approved sources.');
  }

  const ids = new Set();
  return sources.map((source, index) => {
    const { id, organization, sport, role, feedUrl, articleHosts, permissionUrl } = source ?? {};
    const feed = httpsUrl(feedUrl);
    const permission = httpsUrl(permissionUrl);
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id) || ids.has(id) ||
        typeof organization !== 'string' || !/^[a-z0-9-]{1,60}$/.test(organization) ||
        !sports.has(sport) || !roles.has(role) || !feed || !permission ||
        !Array.isArray(articleHosts) || !articleHosts.length ||
        articleHosts.some((host) => typeof host !== 'string' ||
          !/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/.test(host))) {
      throw new Error('Invalid source configuration at position ' + (index + 1) + '.');
    }
    ids.add(id);
    return { id, organization, sport, role, feedUrl: feed.href, articleHosts, permissionUrl: permission.href };
  });
}

export function canonicalArticleUrl(value, allowedHosts) {
  const url = httpsUrl(value);
  if (!url || !allowedHosts.includes(url.hostname)) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid$|fbclid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

export function parseFeed(xml) {
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  const entries = [];
  let item;
  let field;
  let root;
  let depth = 0;

  parser.ondoctype = () => { throw new Error('Feed contains a document type declaration.'); };
  parser.onopentag = (tag) => {
    depth++;
    if (depth > 48) throw new Error('Feed nesting limit exceeded.');
    const name = tag.local;
    if (depth === 1) {
      root = name;
      if (root !== 'rss' && root !== 'feed') throw new Error('Expected RSS 2.0 or Atom.');
    }
    if (entries.length >= maxEntries) return;

    if ((root === 'rss' && name === 'item' && depth === 3) ||
        (root === 'feed' && name === 'entry' && depth === 2)) {
      item = { depth };
      return;
    }
    if (!item || depth !== item.depth + 1) return;
    if (name === 'link' && root === 'feed') {
      const { href, rel } = tag.attributes;
      if (href && (!rel || rel.value === 'alternate')) item.link ??= href.value;
      return;
    }
    if (['title', 'link', 'pubDate', 'published', 'updated', 'date'].includes(name)) {
      field = { name, depth, value: '' };
    }
  };
  const append = (value) => {
    if (field && field.value.length < 4096) field.value += value.slice(0, 4096 - field.value.length);
  };
  parser.ontext = append;
  parser.oncdata = append;
  parser.onclosetag = () => {
    if (field?.depth === depth) {
      item[field.name] ??= field.value.trim();
      field = undefined;
    }
    if (item?.depth === depth) {
      entries.push({
        title: item.title,
        link: item.link,
        publishedAt: item.published ?? item.pubDate ?? item.date ?? item.updated,
      });
      item = undefined;
    }
    depth--;
  };
  parser.write(xml).close();
  if (!root) throw new Error('Empty feed.');
  return entries;
}

export async function collectFeed(source, fetchFeed = fetch) {
  const response = await fetchFeed(source.feedUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('Feed request failed.');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxFeedBytes) throw new Error('Feed size limit exceeded.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }

  return parseFeed(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
