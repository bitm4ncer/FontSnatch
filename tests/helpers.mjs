import { readFileSync, existsSync } from 'node:fs';

const CANDIDATES = ['arial.ttf', 'segoeui.ttf', 'calibri.ttf', 'AGENCYR.TTF'];

export function systemSfnt() {
  for (const name of CANDIDATES) {
    const p = `C:/Windows/Fonts/${name}`;
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

export function systemCff() {
  const p = 'C:/Windows/Fonts/ABCDiatypeRounded-Black.otf';
  return existsSync(p) ? readFileSync(p) : null;
}
