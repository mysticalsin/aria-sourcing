const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test('forge skip/xfail gate: the suite does not skip or xfail', () => {
  const dir = path.join(__dirname);
  const sources = fs.readdirSync(dir).filter((name) => name.endsWith('.spec.js'));
  const banned = /test\.skip|test\.fixme|test\.fail|describe\.skip|xit\(|xdescribe\(/;
  for (const name of sources) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    expect(text, name).not.toMatch(banned);
  }
});
