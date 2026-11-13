export function analyzePage() {
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TEXTAREA', 'SVG', 'CANVAS']);
  const MAX_ELEMENTS = 10000;
  const BUDGET_MS = 800;

  const started = performance.now();
  const stacks = new Map();
  let counted = 0;
  let truncated = false;

  const root = document.body || document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  let element = walker.currentNode;
  while ((element = walker.nextNode())) {
    let text = '';
    for (const child of element.childNodes) {
      if (child.nodeType === 3 && child.nodeValue.trim()) text += child.nodeValue.trim();
    }
    if (!text) continue;

    let skip = false;
    for (let parent = element; parent; parent = parent.parentElement) {
      if (SKIP_TAGS.has(parent.tagName) || parent.hidden) {
        skip = true;
        break;
      }
      if (parent === root) break;
    }
    if (skip) continue;

    let style = null;
    if (typeof element.checkVisibility === 'function') {
      if (!element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })) continue;
    } else {
      style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible') continue;
    }

    counted++;
    if (counted > MAX_ELEMENTS || performance.now() - started > BUDGET_MS) {
      truncated = true;
      break;
    }

    style = style || getComputedStyle(element);
    const stack = style.fontFamily;
    let record = stacks.get(stack);
    if (!record) {
      record = { stack, elements: 0, chars: 0, byWeightStyle: {} };
      stacks.set(stack, record);
    }
    record.elements++;
    record.chars += text.length;
    const key = `${style.fontWeight}|${style.fontStyle}`;
    const variant = record.byWeightStyle[key] || (record.byWeightStyle[key] = { elements: 0, chars: 0 });
    variant.elements++;
    variant.chars += text.length;
  }

  const sheets = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const entry = { href: sheet.href || document.baseURI, cssText: null };
    try {
      entry.cssText = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
    } catch {
      entry.cssText = null;
    }
    sheets.push(entry);
  }

  const fontFaces = [];
  if (document.fonts) {
    for (const face of Array.from(document.fonts)) {
      fontFaces.push({ family: face.family, weight: face.weight, style: face.style, status: face.status });
    }
  }

  const resourceFonts = [];
  const seen = new Set();
  for (const entry of performance.getEntriesByType('resource')) {
    const name = entry.name.split('?')[0].split('#')[0];
    if (!/\.(woff2?|ttf|otf)$/i.test(name) || seen.has(entry.name)) continue;
    seen.add(entry.name);
    resourceFonts.push(entry.name);
  }

  return {
    url: location.href,
    title: document.title,
    used: Array.from(stacks.values()),
    sheets,
    fontFaces,
    resourceFonts,
    truncated,
  };
}
