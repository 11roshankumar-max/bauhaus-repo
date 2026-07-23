// Rebuilds public/index.html from the template + state data, and copies the
// India states/UTs GeoJSON (source of truth: data/geo/) into public/ so the
// live MapLibre map can fetch it. Run this after editing any source file in
// this folder, or after data/geo/india-states.geojson changes.
const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, 'index.template.html'), 'utf8');
const statedata = fs.readFileSync(path.join(__dirname, 'statedata.js'), 'utf8');

const html = template.replace('/*__STATE_DATA__*/', statedata);

const outPath = path.join(__dirname, '..', 'public', 'index.html');
fs.writeFileSync(outPath, html);
console.log('Built', outPath, '(' + html.length + ' bytes)');

const geoSrc = path.join(__dirname, '..', 'data', 'geo', 'india-states.geojson');
const geoOutDir = path.join(__dirname, '..', 'public', 'geo');
fs.mkdirSync(geoOutDir, { recursive: true });
fs.copyFileSync(geoSrc, path.join(geoOutDir, 'india-states.geojson'));
console.log('Copied india-states.geojson to public/geo/');

require('./generate-statedata-module.js');
