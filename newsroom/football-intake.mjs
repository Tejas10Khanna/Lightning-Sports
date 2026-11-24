import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { footballBrief } from './football-brief.mjs';

const endpoint = 'https://api.openligadb.de/getmatchdata/';
const day = 86_400_000;

export function selectFootballBrief(matches, seen, now) {
  return matches.flatMap((match) => {
    const fixtureId = match?.matchID;
    const kickoff = Date.parse(match?.matchDateTimeUTC);
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0 || seen.has(String(fixtureId)) ||
        match.matchIsFinished !== true || !(kickoff <= now && kickoff >= now - 4 * day) ||
        !Array.isArray(match.matchResults)) return [];
    const score = (kind) => {
      const rows = match.matchResults.filter((row) => row?.resultTypeKind === kind);
      return rows.length === 1 ? [rows[0].pointsTeam1, rows[0].pointsTeam2] : undefined;
    };
    try {
      const brief = footballBrief({
        home: match.team1?.teamName, away: match.team2?.teamName,
        halfTime: score('HalfTime'), fullTime: score('After90Minutes'),
        sourceUrl: endpoint + fixtureId, modelUseApproved: true,
      });
      return [{ fixtureId, kickoff, brief }];
    } catch {
      return [];
    }
  }).sort((left, right) => right.kickoff - left.kickoff || left.fixtureId - right.fixtureId)[0];
}

async function main([seenPath, briefPath, idPath]) {
  const seen = new Set(existsSync(seenPath) ? (await readFile(seenPath, 'utf8')).split(/\r?\n/) : []);
  const response = await fetch(endpoint + 'bl1', { redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('OpenLigaDB returned HTTP ' + response.status);
  const matches = await response.json();
  if (!Array.isArray(matches) || matches.length > 30) throw new Error('Unexpected OpenLigaDB matchday response.');
  const selected = selectFootballBrief(matches, seen, Date.now());
  if (!selected) {
    console.log('No new finished Bundesliga match with supported scores.');
    return;
  }
  await writeFile(briefPath, JSON.stringify(selected.brief), { mode: 0o600 });
  await writeFile(idPath, String(selected.fixtureId), { mode: 0o600 });
  console.log('Selected a finished Bundesliga match with half-time and full-time scores.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
