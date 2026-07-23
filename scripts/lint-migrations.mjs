#!/usr/bin/env node
// Doc-17 R4: fail CI on migrations that are out of order or skip the house
// idempotency guards (`if not exists` / `if exists`) so migrations stay safe
// to re-run. Gaps in the numbering are fine (0029 is reserved for Stage P) —
// only non-increasing or duplicate numbers are an error.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const NAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

const GUARD_CHECKS = [
  { label: 'create table', guard: 'if not exists', pattern: /create\s+table\s+(?!if\s+not\s+exists\b)/gi },
  {
    label: 'create index',
    guard: 'if not exists',
    pattern: /create\s+index\s+(?!if\s+not\s+exists\b|concurrently\s+if\s+not\s+exists\b)/gi,
  },
  { label: 'add column', guard: 'if not exists', pattern: /\badd\s+column\s+(?!if\s+not\s+exists\b)/gi },
  { label: 'drop table', guard: 'if exists', pattern: /\bdrop\s+table\s+(?!if\s+exists\b)/gi },
  { label: 'drop column', guard: 'if exists', pattern: /\bdrop\s+column\s+(?!if\s+exists\b)/gi },
];

const errors = [];
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

let lastNumber = -1;
const seenNumbers = new Set();

for (const file of files) {
  const match = file.match(NAME_PATTERN);
  if (!match) {
    errors.push(`${file}: filename must match NNNN_snake_case.sql`);
    continue;
  }

  const number = Number(match[1]);
  if (seenNumbers.has(number)) {
    errors.push(`${file}: duplicate migration number ${match[1]}`);
  }
  seenNumbers.add(number);
  if (number <= lastNumber) {
    errors.push(`${file}: migration number ${match[1]} is not strictly increasing`);
  }
  lastNumber = Math.max(lastNumber, number);

  const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  for (const { label, guard, pattern } of GUARD_CHECKS) {
    const matches = content.match(pattern);
    if (matches) {
      errors.push(`${file}: ${matches.length}x "${label}" without "${guard}"`);
    }
  }
}

if (errors.length > 0) {
  console.error('Migration lint failed:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${errors.length} issue(s) found.`);
  process.exit(1);
}

console.log(`Migration lint passed — ${files.length} files, numbers strictly increasing, guards present.`);
