import { createHmac } from 'node:crypto';
import { canonicalArticleUrl, collectFeed } from './feeds.mjs';

const hour = 3_600_000;
const freshness = 36 * hour;
const futureTolerance = 5 * 60_000;
const maxCandidates = 8;
const maxStateEntries = 4000;

function normalizedTitle(value) {
  return value.normalize('NFKD').toLowerCase()
    .replace(/\p{M}/gu, '').replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function keyDigest(key, value) {
  return createHmac('sha256', key).update('newsroom-seen-v1\0').update(value).digest('hex');
}

function rank(groups, now) {
  return [...groups].map((group) => {
    const sorted = group.entries.toSorted((a, b) =>
      Number(b.role === 'primary') - Number(a.role === 'primary') ||
      b.publishedAt - a.publishedAt || a.url.localeCompare(b.url));
    const urls = new Set();
    const entries = sorted.filter((entry) => {
      if (urls.has(entry.url)) return false;
      urls.add(entry.url);
      return true;
    });
    const lead = entries[0];
    const newest = Math.max(...entries.map((entry) => entry.publishedAt));
    const organizations = new Set(entries.map((entry) => entry.organization)).size;
    const primarySource = lead.role === 'primary';
    const priority = (primarySource ? 4 : 0) + 2 * Math.min(organizations - 1, 3) +
      Math.max(0, 4 - Math.floor((now - newest) / (3 * hour)));
    return { group, entries, lead, newest, organizations, primarySource, priority };
  }).sort((a, b) =>
    b.priority - a.priority || b.newest - a.newest || a.lead.url.localeCompare(b.lead.url));
}

export async function buildReview({ sources, archiveSlugs, storedSeen, key, now = Date.now(), fetchFeed }) {
  const archived = new Set(archiveSlugs.map((slug) =>
    normalizedTitle(slug.replace(/^\d{4}-\d{2}-\d{2}-/, ''))));
  const seen = new Map(Object.entries(storedSeen).filter(([hash, timestamp]) =>
    /^[0-9a-f]{64}$/.test(hash) && Number.isFinite(timestamp) &&
    timestamp >= now - freshness - hour && timestamp <= now + futureTolerance));
  const polls = await Promise.allSettled(sources.map((source) => collectFeed(source, fetchFeed)));
  const failures = [];
  const groups = new Set();
  const byAlias = new Map();

  for (const [index, poll] of polls.entries()) {
    const { id, organization, sport, role, articleHosts, permissionUrl } = sources[index];
    if (poll.status === 'rejected') {
      failures.push(id);
      continue;
    }

    for (const entry of poll.value) {
      const url = canonicalArticleUrl(entry.link, articleHosts);
      const publishedAt = Date.parse(entry.publishedAt);
      const title = entry.title?.replace(/\s+/g, ' ').trim();
      if (!url || !title || title.length > 400 || !Number.isFinite(publishedAt) ||
          publishedAt < now - freshness || publishedAt > now + futureTolerance) continue;

      const titleKey = normalizedTitle(title);
      if (!titleKey || archived.has(titleKey)) continue;
      const aliases = [
        keyDigest(key, sport + '\0url\0' + url),
        keyDigest(key, sport + '\0title\0' + titleKey),
      ];
      const matches = [...new Set(aliases.map((alias) => byAlias.get(alias)).filter(Boolean))];
      const group = matches[0] ?? { entries: [], aliases: new Set() };
      for (const merged of matches.slice(1)) {
        group.entries.push(...merged.entries);
        for (const alias of merged.aliases) group.aliases.add(alias);
        groups.delete(merged);
      }
      for (const alias of aliases) group.aliases.add(alias);
      for (const alias of group.aliases) byAlias.set(alias, group);
      group.entries.push({ id, organization, sport, role, permissionUrl, url, title, publishedAt });
      groups.add(group);
    }
  }

  const pending = [...groups].filter((group) => ![...group.aliases].some((alias) => seen.has(alias)));
  const selected = rank(pending, now).slice(0, maxCandidates);
  for (const { group } of selected) {
    for (const alias of group.aliases) seen.set(alias, now);
  }

  return {
    report: {
      generatedAt: new Date(now).toISOString(),
      failedSources: failures,
      candidates: selected.map(({ entries, lead, organizations, primarySource, priority }) => ({
        leadId: keyDigest(key, 'lead\0' + lead.sport + '\0' + lead.url),
        sport: lead.sport,
        workingHeadline: lead.title,
        priority,
        primarySource,
        organizations,
        status: 'needs-human-verification',
        sources: entries.map((entry) => ({
          sourceId: entry.id,
          organization: entry.organization,
          role: entry.role,
          url: entry.url,
          permissionUrl: entry.permissionUrl,
          publishedAt: new Date(entry.publishedAt).toISOString(),
        })),
      })),
    },
    seen: Object.fromEntries([...seen].sort((a, b) => b[1] - a[1]).slice(0, maxStateEntries)),
  };
}

export function validateLeadBrief(report, leadId, brief) {
  const lead = Array.isArray(report?.candidates)
    ? report.candidates.find((candidate) => candidate?.leadId === leadId)
    : undefined;
  if (!/^[a-f0-9]{64}$/.test(leadId ?? '') || !lead || !Array.isArray(lead.sources)) {
    throw new Error('Newsroom lead was not found in the supplied report.');
  }
  const sourceUrls = new Set(lead.sources.map(({ url }) => url));
  if (lead.sport !== brief.sport || !brief.notes.some(({ url }) => sourceUrls.has(url))) {
    throw new Error('Newsroom lead requires a matching sport and at least one evidence note from its sources.');
  }
}
