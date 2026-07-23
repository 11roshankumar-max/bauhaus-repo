// Regenerates data/statedata.module.js from this directory's statedata.js
// (the frontend's craft content, keyed by region id) so the two never drift.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'statedata.js'), 'utf8');
const body = src.replace(/^const STATE_DATA = /, 'module.exports = ').replace(/;\s*$/, ';\n');

const outPath = path.join(__dirname, '..', 'data', 'statedata.module.js');
fs.writeFileSync(outPath, body);
console.log('Generated', outPath);
