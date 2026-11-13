import { getActiveTab } from './lib/browser.js';
import { analyzeTab } from './lib/pipeline.js';

const status = document.getElementById('status');

async function init() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('NO_TAB');
    const { model } = await analyzeTab(tab.id);
    const count = model.families.length;
    status.textContent = `${count} ${count === 1 ? 'Familie' : 'Familien'} gefunden`;
  } catch (error) {
    console.error(error);
    status.textContent = 'Auf dieser Seite nicht verfügbar.';
  }
}

init();
