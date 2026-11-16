import { analyzePage } from './analyze.js';
import { buildModel, collectRules } from './resolve.js';
import { runInTab } from './browser.js';

export async function buildPipeline({ analyze, loadCss }) {
  const analysis = await analyze();
  if (!analysis) throw new Error('ANALYSIS_FAILED');

  const { rules, failed } = await collectRules(analysis.sheets || [], loadCss);
  const model = buildModel(analysis, rules, {
    includeUnused: true,
    sheetsTotal: (analysis.sheets || []).length,
    sheetsFailed: failed,
  });

  return { model, analysis };
}

export async function analyzeTab(tabId) {
  return buildPipeline({
    analyze: () => runInTab(tabId, analyzePage),
    loadCss: async (url) => {
      const res = await fetch(url, { credentials: 'omit' });
      return res.ok ? res.text() : null;
    },
  });
}
