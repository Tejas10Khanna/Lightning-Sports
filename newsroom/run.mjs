import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readSourceConfig } from './feeds.mjs';
import { decryptReport, encryptReport, readReportKey } from './report.mjs';
import { buildReview } from './review.mjs';

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
  const sources = readSourceConfig(env.NEWSROOM_SOURCES);
  const stateFile = env.NEWSROOM_STATE_FILE || 'newsroom/state/seen.json';
  const reportFile = env.NEWSROOM_REPORT_FILE || 'newsroom/state/review.enc';
  const articles = await readdir(new URL('../src/content/posts/', import.meta.url));
  const archiveSlugs = articles.filter((file) => file.endsWith('.md')).map((file) => file.slice(0, -3));
  const { report, seen } = await buildReview({
    sources, archiveSlugs, storedSeen: await readSeen(stateFile), key,
  });
  console.log('Newsroom review: %d candidates, %d/%d feed failures.',
    report.candidates.length, report.failedSources.length, sources.length);
  if (report.failedSources.length === sources.length) throw new Error('All configured feeds failed.');

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
  } else if (command === 'decrypt' && input && output) {
    const plaintext = decryptReport(await readFile(input), key);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, plaintext, { flag: 'wx', mode: 0o600 });
  } else {
    throw new Error('Use collect or decrypt <report.enc> <output.json>.');
  }
} catch (error) {
  const safe = /^(NEWSROOM_REPORT_KEY|Approved sources|Configure between|Invalid source configuration|All configured feeds failed|Use collect)/;
  console.error(safe.test(error.message) ? error.message : 'Newsroom command failed. Check configuration and file access.');
  process.exitCode = 1;
}
