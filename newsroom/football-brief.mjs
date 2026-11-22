import { readBrief } from './draft.mjs';

function validScore(score) {
  return Array.isArray(score) && score.length === 2 &&
    score.every((goals) => Number.isSafeInteger(goals) && goals >= 0);
}

// Callers supply a finished match from a source approved for model use.
export function footballBrief({ home, away, halfTime, fullTime, sourceUrl, modelUseApproved } = {}) {
  if (modelUseApproved !== true) throw new Error('Football brief requires a source approved for model use.');
  if (typeof home !== 'string' || typeof away !== 'string' ||
      !home.trim() || !away.trim() || home.trim() === away.trim()) {
    throw new Error('Football brief requires two distinct teams.');
  }
  if (!validScore(halfTime) || !validScore(fullTime) ||
      halfTime.some((goals, side) => goals > fullTime[side])) {
    throw new Error('Football brief requires consistent half-time and full-time scores.');
  }
  const fixture = home + ' vs ' + away;
  const brief = {
    sport: 'Football',
    topic: 'What does the change in score after half-time tell us about ' + fixture + '? Discuss the limits of the scoreline.',
    modelUseApproved: true,
    evidence: [
      { fact: fixture + ' was ' + halfTime.join('–') + ' at half-time (home team first).', url: sourceUrl },
      { fact: fixture + ' ended ' + fullTime.join('–') + ' (home team first).', url: sourceUrl },
    ],
  };
  readBrief(JSON.stringify(brief));
  return brief;
}
