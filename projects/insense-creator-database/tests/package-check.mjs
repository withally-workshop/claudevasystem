import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

assert.equal(pkg.type, 'module');
assert.ok(pkg.scripts.test);
assert.ok(pkg.scripts.review);
assert.ok(pkg.scripts.send);
