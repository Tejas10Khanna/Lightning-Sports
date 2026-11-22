const site = 'https://www.lightningsports.tech';
const api = 'https://api.github.com/repos/Tejas10Khanna/Lightning-Sports/contents/';

function inline(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\[\]()*_#~!|]/g, '\\$&').replace(/\s+/g, ' ').trim();
}

export function prepareArticle(packet, revision, time) {
  if (!/^[0-9a-f]{32}$/.test(revision)) throw new Error('Invalid publication revision.');
  const date = new Date(time).toISOString();
  const headlineSlug = packet.headline.normalize('NFKD').toLowerCase()
    .replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-')
    .slice(0, 85).replace(/^-+|-+$/g, '') || 'editorial';
  const slug = date.slice(0, 10) + '-' + headlineSlug + '-' + revision.slice(0, 12);
  const sources = new Map(packet.evidence.map(({ id, url }) => {
    const source = new URL(url);
    if (source.protocol !== 'https:' || source.username || source.password || /[<>\s]/.test(source.href)) {
      throw new Error('Invalid publication source URL.');
    }
    return [id, source.href];
  }));
  const paragraphs = packet.paragraphs.map(({ kind, text, evidenceIds }) => {
    const label = kind === 'analysis' ? '**Analysis.** ' :
      kind === 'counterargument' ? '**Counterargument.** ' : '';
    const links = [...new Set(evidenceIds)].map((id) => {
      if (!sources.has(id) || !/^E\d{1,2}$/.test(id)) throw new Error('Missing publication citation.');
      return '[' + id + '](<' + sources.get(id) + '>)';
    });
    if (!links.length) throw new Error('Missing publication citation.');
    // A leading number or hyphen can accidentally start a Markdown list.
    const paragraph = inline(text).replace(/^(\d+)([.)]) /, '$1\\$2 ').replace(/^([-+]) /, '\\$1 ');
    return label + paragraph + ' ' + links.join(' ');
  });
  const frontmatter = [
    '---',
    'title: ' + JSON.stringify(packet.headline),
    'date: ' + JSON.stringify(date),
    'mainSport: ' + JSON.stringify([packet.sport]),
    'author: "Lightning Sports Desk"',
    'aiAssisted: true',
    'dek: ' + JSON.stringify(packet.dek),
    '---',
  ];
  return {
    path: 'src/content/posts/' + slug + '.md',
    url: site + '/posts/' + slug,
    markdown: frontmatter.join('\n') + '\n\n' + paragraphs.join('\n\n') + '\n',
  };
}

export async function commitArticle(article, token, request = fetch) {
  if (!token) throw new Error('GitHub publisher credential is missing.');
  if (!/^src\/content\/posts\/[a-z0-9-]+\.md$/.test(article.path)) {
    throw new Error('Invalid publication path.');
  }
  const url = api + article.path;
  const bytes = new TextEncoder().encode(article.markdown);
  const content = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + token,
    'content-type': 'application/json',
    'user-agent': 'lightning-sports-editorial-publisher',
  };
  async function existing() {
    const response = await request(url + '?ref=main', {
      headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('GitHub publication lookup failed.');
    }
    const file = await response.json();
    if (file.encoding !== 'base64' || typeof file.content !== 'string' ||
        file.content.replace(/\s+/g, '') !== content) {
      throw new Error('Publication path already contains different content.');
    }
    return { existing: true };
  }

  const prior = await existing();
  if (prior) return prior;
  const response = await request(url, {
    method: 'PUT', headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ message: 'Publish Lightning Sports editorial', content, branch: 'main' }),
  });
  if (response.status === 201) {
    const result = await response.json();
    if (!result.commit?.sha) throw new Error('GitHub did not confirm a publication commit.');
    return { commit: result.commit.sha };
  }
  await response.body?.cancel();
  // Another delivery may have completed the same create request.
  if ([409, 422].includes(response.status)) {
    const current = await existing();
    if (current) return current;
  }
  throw new Error('GitHub did not confirm publication.');
}

export async function checkLiveArticle(url, request = fetch) {
  if (!url.startsWith(site + '/posts/')) throw new Error('Unexpected public article URL.');
  const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(12_000) });
  await response.body?.cancel();
  return response.status === 200 && response.headers.get('content-type')?.includes('text/html');
}
