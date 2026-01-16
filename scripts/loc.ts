import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';

const ROOT = join(dirname(decodeURIComponent(new URL(import.meta.url).pathname)), '..');
const HISTORY_FILE = join(ROOT, 'scripts', 'loc-history.json');
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css']);
const IGNORE = new Set(['node_modules', '.git', 'dist', '.worktrees']);

type Entry = { date: string; loc: number };

function countLines(filePath: string): number {
  const content = readFileSync(filePath, 'utf-8');
  return content.split('\n').length;
}

function walkDir(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      total += walkDir(fullPath);
    } else if (EXTENSIONS.has(extname(entry))) {
      total += countLines(fullPath);
    }
  }
  return total;
}

function loadHistory(): Entry[] {
  if (!existsSync(HISTORY_FILE)) return [];
  return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
}

function saveHistory(history: Entry[]): void {
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');
}

const loc = walkDir(ROOT);
const history = loadHistory();
history.push({ date: new Date().toISOString(), loc });
saveHistory(history);

console.log(`${loc} lines of code`);
