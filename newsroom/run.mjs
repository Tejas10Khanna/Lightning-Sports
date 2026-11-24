import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sendForReview } from './approval/submit.mjs';
import { groqWriter, readBrief } from './draft.mjs';
import { draftWithEvidenceReview } from './fact-check.mjs';
import { readSourceConfig } from './feeds.mjs';
import { decryptReport, encryptReport, readReportKey } from './report.mjs';
import { buildReview, validateLeadBrief } from './review.mjs';

async function readSeen(path) {
  try {
    const raw = await readFile(path, 'utf8');
    if (raw.length <= 500_000) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return {};
}

async function collect(key, env) {
  const gdelt = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  gdelt.search = new URLSearchParams({
    query: '(domain:premierleague.com OR domain:thefa.com) sourcelang:english',
    mode: 'artlist', format: 'rss', timespan: '24h', maxrecords: '40', sort: 'datedesc',
  });
  const sources = readSourceConfig(env.NEWSROOM_SOURCES || JSON.stringify([{
    id: 'gdelt-football', organization: 'gdelt-index', sport: 'Football', role: 'reporting',
    feedUrl: gdelt.href,
    articleHosts: ['www.premierleague.com', 'www.thefa.com', 'premierleague.com', 'thefa.com'],
    permissionUrl: 'https://www.gdeltproject.org/about.html',
  }]));
  const stateFile = env.NEWSROOM_STATE_FILE || 'newsroom/state/seen.json';
  const reportFile = env.NEWSROOM_REPORT_FILE || 'newsroom/state/review.enc';
  const articles = await readdir(new URL('../src/content/posts/', import.meta.url));
  const archiveSlugs = articles.filter((file) => file.endsWith('.md')).map((file) => file.slice(0, -3));
  const { report, seen } = await buildReview({
    sources, archiveSlugs, storedSeen: await readSeen(stateFile), key,
  });
  console.log('Newsroom review: %d candidates, %d/%d feed failures.',
    report.candidates.length, report.failedSources.length, sources.length);
  if (report.failedSources.length === sources.length) {
    if (env.NEWSROOM_SOURCES) throw new Error('All configured feeds failed.');
    console.warn('::warning::GDELT discovery unavailable. This report contains no candidates.');
  }

  await mkdir(dirname(stateFile), { recursive: true });
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, encryptReport(report, key), { mode: 0o600 });
  await writeFile(stateFile, JSON.stringify(seen), { mode: 0o600 });
}

try {
  const [command, input, output] = process.argv.slice(2);
  const key = readReportKey(process.env.NEWSROOM_REPORT_KEY);
  if (command === 'collect') {
    await collect(key, process.env);
  } else if (command === 'draft' || command === 'draft-from-lead') {
    const briefJson = process.env.NEWSROOM_PUBLIC_BRIEF?.trim() || process.env.NEWSROOM_WRITER_BRIEF;
    const brief = readBrief(briefJson);
    if (command === 'draft-from-lead') {
      if (!input || !output) throw new Error('Use draft-from-lead <review.enc> <lead-id>.');
      validateLeadBrief(JSON.parse(decryptReport(await readFile(input), key)), output, brief);
    }
    const generate = groqWriter(process.env.NEWSROOM_GROQ_API_KEY);
    const packet = await draftWithEvidenceReview(brief, generate);
    const path = process.env.NEWSROOM_REPORT_FILE || 'newsroom/state/draft.enc';
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encryptReport(packet, key), { flag: 'wx', mode: 0o600 });
    console.log('Editorial packet saved with status %s.', packet.status);
  } else if (command === 'send-for-review' && input) {
    const packet = JSON.parse(decryptReport(await readFile(input), key));
    if (process.env.NEWSROOM_REVIEW_ONLY === 'true' && packet.status === 'needs-human-verification') {
      packet.status = 'held-for-editorial-review';
    }
    const status = await sendForReview(packet, {
      url: process.env.NEWSROOM_APPROVAL_URL, token: process.env.NEWSROOM_INTAKE_TOKEN,
    });
    console.log('Telegram review status %s.', status);
  } else if (command === 'decrypt' && input && output) {
    const plaintext = decryptReport(await readFile(input), key);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, plaintext, { flag: 'wx', mode: 0o600 });
  } else {
    throw new Error('Use collect, draft, send-for-review <draft.enc> or decrypt <report.enc> <output.json>.');
  }
} catch (error) {
  const safe = /^(NEWSROOM_(REPORT_KEY|GROQ_API_KEY)|Approved sources|Configure between|Invalid source configuration|All configured feeds failed|Use collect|Use draft-from-lead|Provide a valid NEWSROOM_WRITER_BRIEF|Writer |Fact check |Newsroom lead |Telegram review service )/;
  console.error(safe.test(error.message) ? error.message : 'Newsroom command failed. Check configuration and file access.');
  process.exitCode = 1;
}
