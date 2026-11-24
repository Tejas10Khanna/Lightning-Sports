import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { footballBrief } from './football-brief.mjs';

const endpoint = 'https://api.openligadb.de/getmatchdata/';
const day = 86_400_000;

function goalSequence(goals, finalScore) {
  if (!Array.isArray(goals) || goals.length === 0 || goals.length > 10) return [];
  const sequence = [...goals].sort((left, right) =>
    (left?.scoreTeam1 + left?.scoreTeam2) - (right?.scoreTeam1 + right?.scoreTeam2));
  let previous = [0, 0];
  let minute = 0;
  for (const goal of sequence) {
    const next = [goal?.scoreTeam1, goal?.scoreTeam2];
    if (!next.every(Number.isSafeInteger) || !Number.isSafeInteger(goal.matchMinute) ||
        goal.matchMinute < Math.max(minute, 1) || goal.matchMinute > 120 ||
        next.some((count, index) => count < previous[index] || count > finalScore[index]) ||
        next[0] + next[1] !== previous[0] + previous[1] + 1) return [];
    previous = next;
    minute = goal.matchMinute;
  }
  return previous.every((count, index) => count === finalScore[index]) ? sequence : [];
}

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
      const fullTime = score('After90Minutes');
      const sourceUrl = endpoint + fixtureId;
      const brief = footballBrief({
        home: match.team1?.teamName, away: match.team2?.teamName,
        halfTime: score('HalfTime'), fullTime, sourceUrl, modelUseApproved: true,
      });
      const timeline = goalSequence(match.goals, fullTime);
      if (!timeline.length) return [];
      brief.topic = 'Analyze the documented scoring sequence and what the score at each goal meant for the match. Do not suggest tactical, personnel, fatigue, or other reasons for the goals without evidence.';
      for (const { matchMinute, scoreTeam1, scoreTeam2 } of timeline) {
        brief.evidence.push({
          fact: `OpenLigaDB records the score changing to ${scoreTeam1}–${scoreTeam2} in minute ${matchMinute} (home team first).`,
          url: sourceUrl,
        });
      }
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
    console.log('No new finished Bundesliga match with a complete scoring timeline.');
    return;
  }
  await writeFile(briefPath, JSON.stringify(selected.brief), { mode: 0o600 });
  await writeFile(idPath, String(selected.fixtureId), { mode: 0o600 });
  console.log('Selected a finished Bundesliga match with a complete scoring timeline.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
