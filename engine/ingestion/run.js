const rera = require('./rera.js');
const gemTenders = require('./gemTenders.js');
const news = require('./news.js');
const { scanForMerges } = require('../entity/resolve.js');
const { scoreAll } = require('../scoring/score.js');
const { recommendAll } = require('../recommendation/recommend.js');

const CONNECTORS = { rera, gem_tender: gemTenders, news };

// Full pipeline per the architecture doc: ingest → entity resolution →
// scoring → recommendation. Signal detection is folded into each connector
// (recordSignal() calls in rera.js/gemTenders.js/news.js) rather than being
// a separate pass, since the signal type is already known at extraction time.
//
// Each stage runs independently — one source breaking (a site redesign, a
// network blip) shouldn't block the other two connectors, or block
// resolution/scoring/recommendation from running on whatever did come in.
async function runAll() {
  const results = {};
  for (const [key, connector] of Object.entries(CONNECTORS)) {
    try {
      results[key] = await connector.run();
    } catch (err) {
      results[key] = { error: err.message };
    }
  }
  try {
    results.entity_resolution = scanForMerges();
  } catch (err) {
    results.entity_resolution = { error: err.message };
  }
  try {
    results.scoring = scoreAll();
  } catch (err) {
    results.scoring = { error: err.message };
  }
  try {
    results.recommendation = recommendAll();
  } catch (err) {
    results.recommendation = { error: err.message };
  }
  return results;
}

module.exports = { runAll };
