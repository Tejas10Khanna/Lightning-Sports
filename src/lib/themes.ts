// src/lib/themes.ts
//
// The color-psychology engine of Lightning Sports.
// Every sport / event gets its own palette + typographic mood + texture profile.
// BaseLayout reads this and injects CSS variables at the <html> level so every
// downstream component adapts automatically — no per-page duplication.
//
// Add a new sport? Drop it in below with a palette and it themes across the
// entire site instantly.

export type ThemeKey =
  | 'global'
  | 'cricket'
  | 'football'
  | 'tennis'
  | 'formula-1'
  | 'olympics'
  | 'paralympics'
  | 'winter-olympics'
  | 'commonwealth-games'
  | 'asian-games'
  | 'basketball'
  | 'more-sports'
  | 'announcement';

export interface SportTheme {
  key: ThemeKey;
  label: string;
  bg: string;
  surface: string;
  line: string;
  ink: string;
  inkMuted: string;
  accent: string;
  accent2: string;
  pop: string;
  motto: string;
  gradient: string;
  grain: number;
  headlineWeight: 400 | 500 | 600 | 700;
  headlineTracking: string;
  kicker: string;
}

export const THEMES: Record<ThemeKey, SportTheme> = {
  global: {
    key: 'global',
    label: 'Lightning Sports',
    bg: '#0D111A',       // FIX: Lightened from #05070E
    surface: '#151926',  // FIX: Lightened from #0C0F1A
    line: '#2A2F45',
    ink: '#F6F3E8',
    inkMuted: '#9BA4B5',
    accent: '#FFB627',
    accent2: '#3EE08C',
    pop: '#FF3B3B',
    motto: 'Every field. Every score.',
    gradient:
      'radial-gradient(ellipse 900px 500px at 12% -20%, rgba(255,182,39,.18), transparent 62%), radial-gradient(ellipse 700px 500px at 108% 20%, rgba(255,59,59,.16), transparent 60%)',
    grain: 0.35,
    headlineWeight: 400,
    headlineTracking: '0.005em',
    kicker: 'Broadcast desk',
  },

  cricket: {
    key: 'cricket',
    label: 'Cricket',
    bg: '#04160C',
    surface: '#0A2A18',
    line: '#194432',
    ink: '#F1EED8',
    inkMuted: '#8AA394',
    accent: '#D4A017',
    accent2: '#E8DFA9',
    pop: '#E63946',
    motto: 'Five days. Five sessions. One story.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 15% -10%, rgba(212,160,23,.16), transparent 60%), radial-gradient(ellipse 700px 500px at 100% 10%, rgba(10,80,45,.55), transparent 60%)',
    grain: 0.32,
    headlineWeight: 400,
    headlineTracking: '-0.005em',
    kicker: 'The gentleman\u2019s war',
  },

  football: {
    key: 'football',
    label: 'Football',
    bg: '#08120A',
    surface: '#0F1F13',
    line: '#1E3A25',
    ink: '#F5F7F0',
    inkMuted: '#8CA391',
    accent: '#E63946',
    accent2: '#39FF14',
    pop: '#FFB627',
    motto: '90 minutes. Nothing between.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 88% -10%, rgba(230,57,70,.22), transparent 58%), radial-gradient(ellipse 700px 500px at 5% 20%, rgba(57,255,20,.10), transparent 60%)',
    grain: 0.4,
    headlineWeight: 400,
    headlineTracking: '0em',
    kicker: 'The beautiful roar',
  },

  tennis: {
    key: 'tennis',
    label: 'Tennis',
    bg: '#0C0A08',
    surface: '#181410',
    line: '#302820',
    ink: '#F7F3EA',
    inkMuted: '#A99880',
    accent: '#B85C38',
    accent2: '#8AA88A',
    pop: '#FFE156',
    motto: 'Silence. Then serve.',
    gradient:
      'radial-gradient(ellipse 900px 500px at 20% -10%, rgba(184,92,56,.18), transparent 60%), radial-gradient(ellipse 700px 460px at 100% 30%, rgba(138,168,138,.14), transparent 60%)',
    grain: 0.28,
    headlineWeight: 400,
    headlineTracking: '0.01em',
    kicker: 'Clay. Grass. Hard.',
  },

  'formula-1': {
    key: 'formula-1',
    label: 'Formula 1',
    bg: '#050505',
    surface: '#0D0D0F',
    line: '#212127',
    ink: '#F2F2F5',
    inkMuted: '#9A9CA6',
    accent: '#FF0044',
    accent2: '#C7CBD1',
    pop: '#00E5FF',
    motto: 'To finish first, first you must finish.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 88% -10%, rgba(255,0,68,.22), transparent 55%), radial-gradient(ellipse 700px 460px at 5% 30%, rgba(0,229,255,.10), transparent 60%)',
    grain: 0.45,
    headlineWeight: 500,
    headlineTracking: '-0.01em',
    kicker: 'Lights out',
  },

  olympics: {
    key: 'olympics',
    label: 'Olympics',
    bg: '#050B1F',
    surface: '#0A163A',
    line: '#1E2C58',
    ink: '#F5F1E0',
    inkMuted: '#8FA0C8',
    accent: '#FFD34E',
    accent2: '#3D7DFF',
    pop: '#E63946',
    motto: 'Citius. Altius. Fortius. Communiter.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 15% -10%, rgba(255,211,78,.16), transparent 60%), radial-gradient(ellipse 700px 500px at 100% 10%, rgba(61,125,255,.20), transparent 60%)',
    grain: 0.3,
    headlineWeight: 400,
    headlineTracking: '0.005em',
    kicker: 'The world, on one field',
  },

  paralympics: {
    key: 'paralympics',
    label: 'Paralympics',
    bg: '#0C0620',
    surface: '#1B0F3B',
    line: '#31226A',
    ink: '#F4EFE3',
    inkMuted: '#B6A6E0',
    accent: '#FFCC33',
    accent2: '#8B5CF6',
    pop: '#FF3B7A',
    motto: 'Spirit in motion.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 20% -10%, rgba(255,204,51,.16), transparent 60%), radial-gradient(ellipse 700px 500px at 100% 20%, rgba(139,92,246,.28), transparent 60%)',
    grain: 0.3,
    headlineWeight: 400,
    headlineTracking: '0.008em',
    kicker: 'Every barrier, broken',
  },

  'winter-olympics': {
    key: 'winter-olympics',
    label: 'Winter Olympics',
    bg: '#040A17',
    surface: '#0B1A2E',
    line: '#1E3350',
    ink: '#F0F6FF',
    inkMuted: '#89A5C4',
    accent: '#7EE8FA',
    accent2: '#D6E4FF',
    pop: '#FF7A5A',
    motto: 'Powder. Blade. Nerve.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 15% -10%, rgba(126,232,250,.16), transparent 60%), radial-gradient(ellipse 700px 500px at 100% 10%, rgba(214,228,255,.10), transparent 60%)',
    grain: 0.25,
    headlineWeight: 400,
    headlineTracking: '0.01em',
    kicker: 'Ice under fire',
  },

  'commonwealth-games': {
    key: 'commonwealth-games',
    label: 'Commonwealth Games',
    bg: '#04141A',
    surface: '#082530',
    line: '#154354',
    ink: '#F1EFE1',
    inkMuted: '#82A6B2',
    accent: '#CD7F32',
    accent2: '#FFD79E',
    pop: '#E63946',
    motto: 'One family. Every four years.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 15% -10%, rgba(205,127,50,.16), transparent 60%), radial-gradient(ellipse 700px 500px at 100% 10%, rgba(30,90,110,.35), transparent 60%)',
    grain: 0.3,
    headlineWeight: 400,
    headlineTracking: '0.005em',
    kicker: 'Kin on the field',
  },

  // FIXED: removed the invalid `asian: false as unknown as SportTheme` placeholder
  // and the trailing `delete (THEMES as any).asian;` hack that were here before —
  // 'asian' was never a valid ThemeKey to begin with. This is the only entry needed.
  'asian-games': {
    key: 'asian-games',
    label: 'Asian Games',
    bg: '#170610',
    surface: '#2A0E1F',
    line: '#4E1E37',
    ink: '#FFF1E8',
    inkMuted: '#D3A3BE',
    accent: '#FFB627',
    accent2: '#E63946',
    pop: '#7EE8FA',
    motto: 'A continent, in ten sports.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 20% -10%, rgba(255,182,39,.16), transparent 60%), radial-gradient(ellipse 700px 500px at 100% 10%, rgba(230,57,70,.20), transparent 60%)',
    grain: 0.3,
    headlineWeight: 400,
    headlineTracking: '0.005em',
    kicker: 'East meets fastest',
  },

  basketball: {
    key: 'basketball',
    label: 'Basketball',
    bg: '#1A0A05',
    surface: '#2A140A',
    line: '#4A2814',
    ink: '#F8EEE0',
    inkMuted: '#C6A184',
    accent: '#FF6B1A',
    accent2: '#FFD79E',
    pop: '#00E5FF',
    motto: 'Forty-eight minutes of fast.',
    gradient:
      'radial-gradient(ellipse 900px 520px at 88% -10%, rgba(255,107,26,.24), transparent 55%), radial-gradient(ellipse 700px 460px at 5% 30%, rgba(0,229,255,.10), transparent 60%)',
    grain: 0.35,
    headlineWeight: 500,
    headlineTracking: '-0.005em',
    kicker: 'The hardwood',
  },

  'more-sports': {
    key: 'more-sports',
    label: 'More Sports',
    bg: '#05070E',
    surface: '#0C0F1A',
    line: '#1B2033',
    ink: '#F6F3E8',
    inkMuted: '#8892A6',
    accent: '#FFB627',
    accent2: '#3EE08C',
    pop: '#FF3B3B',
    motto: 'Every corner of the map.',
    gradient:
      'radial-gradient(ellipse 900px 500px at 12% -20%, rgba(255,182,39,.18), transparent 62%), radial-gradient(ellipse 700px 500px at 108% 20%, rgba(62,224,140,.12), transparent 60%)',
    grain: 0.3,
    headlineWeight: 400,
    headlineTracking: '0.005em',
    kicker: 'Beyond the majors',
  },

  announcement: {
    key: 'announcement',
    label: 'Announcement',
    bg: '#05070E',
    surface: '#0C0F1A',
    line: '#1B2033',
    ink: '#F6F3E8',
    inkMuted: '#8892A6',
    accent: '#3EE08C',
    accent2: '#FFB627',
    pop: '#FF3B3B',
    motto: 'From the newsroom.',
    gradient:
      'radial-gradient(ellipse 900px 500px at 12% -20%, rgba(62,224,140,.16), transparent 62%)',
    grain: 0.25,
    headlineWeight: 400,
    headlineTracking: '0.005em',
    kicker: 'Newsroom bulletin',
  },
};

/**
 * Normalize an arbitrary category/sport label into a theme key.
 * Case-insensitive, space/hyphen tolerant.
 */
export function themeFor(input: string | undefined | null): SportTheme {
  if (!input) return THEMES.global;
  const slug = input
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/&/g, 'and');

  if ((THEMES as Record<string, SportTheme>)[slug]) {
    return (THEMES as Record<string, SportTheme>)[slug];
  }
  if (slug.includes('f1') || slug.includes('formula')) return THEMES['formula-1'];
  if (slug.includes('paralymp')) return THEMES.paralympics;
  if (slug.includes('winter')) return THEMES['winter-olympics'];
  if (slug.includes('olymp')) return THEMES.olympics;
  if (slug.includes('common')) return THEMES['commonwealth-games'];
  if (slug.includes('asian')) return THEMES['asian-games'];
  if (slug.includes('crick')) return THEMES.cricket;
  if (slug.includes('foot') || slug.includes('soccer')) return THEMES.football;
  if (slug.includes('tenn')) return THEMES.tennis;
  if (slug.includes('basket')) return THEMES.basketball;
  return THEMES['more-sports'];
}

/**
 * Serializes a theme into inline :root CSS custom properties.
 * Injected once at the top of every page — everything downstream reads them.
 */
export function themeToCss(t: SportTheme): string {
  return `
:root {
  --t-bg: ${t.bg};
  --t-surface: ${t.surface};
  --t-line: ${t.line};
  --t-ink: ${t.ink};
  --t-ink-muted: ${t.inkMuted};
  --t-accent: ${t.accent};
  --t-accent-2: ${t.accent2};
  --t-pop: ${t.pop};
  --t-gradient: ${t.gradient};
  --t-grain: ${t.grain};
  --t-h-weight: ${t.headlineWeight};
  --t-h-tracking: ${t.headlineTracking};
  /* Legacy aliases so any un-migrated CSS still resolves */
  --ink: var(--t-bg);
  --ink-2: var(--t-surface);
  --inkline: var(--t-line);
  --pitch: var(--t-surface);
  --pitch-line: var(--t-line);
  --chalk: var(--t-ink);
  --chalk-2: var(--t-ink);
  --volt: var(--t-accent);
  --scarlet: var(--t-pop);
  --slate: var(--t-ink-muted);
  --ink-soft: var(--t-bg);
}`.trim();
}