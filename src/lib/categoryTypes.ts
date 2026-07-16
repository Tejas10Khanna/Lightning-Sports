// src/lib/categoryTypes.ts
//
// The single place that defines: is this category a SPORT (Cricket, Football...)
// or a multi-sport EVENT (Olympics, Commonwealth Games...)?
// Add new categories here as you cover them — everything downstream
// (/sports page grouping, category page sub-sections) reads from this.

export const EVENT_CATEGORIES = new Set([
  'Olympics',
  'Winter Olympics',
  'Paralympics',
  'Commonwealth Games',
  'Asian Games',
]);

export function categoryType(category: string): 'sport' | 'event' {
  return EVENT_CATEGORIES.has(category) ? 'event' : 'sport';
}

export function slugify(label: string) {
  return label.toLowerCase().trim().replace(/\s+/g, '-');
}
