// src/data/events.ts
//
// Plain, hand-editable list of tournament/event milestones per sport.
// No external sports API is wired up yet — this is the honest, zero-cost
// way to show "latest/upcoming events" until (if ever) you add a live feed.
// Add, edit, or remove entries any time; no other code needs to change.

export interface SportEvent {
  category: string;      // must match a post's `category` value
  name: string;
  date: string;           // ISO date, e.g. "2026-09-01"
  status: 'upcoming' | 'live' | 'completed';
  note?: string;
}

export const events: SportEvent[] = [
  { category: 'cricket', name: 'ICC T20 World Cup', date: '2026-02-07', status: 'upcoming', note: 'India & Sri Lanka' },
  { category: 'cricket', name: 'IPL 2026', date: '2026-03-20', status: 'upcoming' },
  { category: 'football', name: 'UEFA Champions League Round of 16', date: '2026-02-17', status: 'upcoming' },
  { category: 'tennis', name: 'Wimbledon 2026', date: '2026-06-29', status: 'upcoming' },
  { category: 'olympics', name: 'Winter Olympics — Milano Cortina 2026', date: '2026-02-06', status: 'upcoming' },
];

export function getEventsForCategory(category: string) {
  return events
    .filter((e) => e.category === category)
    .sort((a, b) => new Date(a.date).valueOf() - new Date(b.date).valueOf());
}
