import { rankSources } from './select.js';

export function planExport(model, format) {
  const plans = [];
  const target = format === 'woff' ? 'woff' : 'native';

  for (const family of model.families || []) {
    if (!family.available) continue;
    for (const variant of family.variants || []) {
      const sources = rankSources(variant);
      if (!sources.length) continue;
      plans.push({ family, variant, sources, target });
    }
  }

  return plans;
}
