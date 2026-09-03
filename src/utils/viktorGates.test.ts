import * as fs from 'fs';
import * as path from 'path';
import pluginJson from '../plugin.json';

const ROOT = path.resolve(__dirname, '../..');
const BANNED_WITH_RESOLVERS = ['Promise', 'withResolvers'].join('.');
const BANNED_INTERNAL_ID = ['lesley', 'murfin', '-dotai-app'].join('');

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return acc;
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'coverage') {
      continue;
    }
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(p, acc);
    } else if (/\.(ts|tsx|js|jsx|go)$/.test(ent.name)) {
      acc.push(p);
    }
  }
  return acc;
}

describe('Viktor review gates', () => {
  test('item 1: Promise withResolvers is gone from src/ and tests/', () => {
    const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'tests'))];
    const hits: string[] = [];
    for (const f of files) {
      if (path.resolve(f) === path.resolve(__filename)) {
        continue;
      }
      const text = fs.readFileSync(f, 'utf8');
      if (text.includes(BANNED_WITH_RESOLVERS)) {
        hits.push(path.relative(ROOT, f));
      }
    }
    expect(hits).toEqual([]);
  });

  test('plugin id on this PR is DevOps Toolkit, not the internal id', () => {
    expect(pluginJson.id).toBe('devopstoolkit-dotai-app');
    const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'tests'))];
    const hits: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      if (text.includes(BANNED_INTERNAL_ID)) {
        hits.push(path.relative(ROOT, f));
      }
    }
    expect(hits).toEqual([]);
  });
});
