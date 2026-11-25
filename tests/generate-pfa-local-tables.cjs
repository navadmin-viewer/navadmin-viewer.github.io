const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const directory = path.join(__dirname, '..', 'pfa-calculator', 'data');
const files = {
  current: 'bca-2026-cycle-2.json',
  historical: 'bca-2025.json',
  prt: 'prt-standards.json',
  bike: 'bike-profiles.json'
};

const entries = Object.entries(files).map(([name, filename]) => {
  const json = readFileSync(path.join(directory, filename), 'utf8').trim();
  JSON.parse(json);
  const source = json.replace(/\r?\n/g, '\n  ').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `  ${name}: ${source}`;
});

const header = '// Generated from the scoring JSON by node tests/generate-pfa-local-tables.cjs.\n';
const bundle = `window.PfaLocalTables = {\n${entries.join(',\n')}\n};\n`;
writeFileSync(path.join(directory, 'local-tables.js'), header + bundle, 'utf8');
