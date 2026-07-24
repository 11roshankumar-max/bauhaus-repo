const cheerio = require('cheerio');
const { storeRawEvent, getOrCreateCompany, upsertOpportunity, recordSignal, markSourceChecked, companyNeedsAddress, setCompanyAddress } = require('./lib.js');
const { fetchRegisteredAddress } = require('./reraCertificate.js');

const SOURCE_KEY = 'rera';
const SEARCH_URL = 'https://rera.karnataka.gov.in/projectViewDetails';

// Bengaluru-area districts only — this is the target market for now; add more
// districts here (they're a dropdown on the RERA site) to widen coverage.
// NB: the site's own <option value> for Rural has a double space — an exact
// match is required or the search silently returns zero rows.
const DISTRICTS = ['Bengaluru Urban', 'Bengaluru  Rural'];

// A RERA project registration isn't a news article to parse — it's already
// structured government data. The only "extraction" needed is a relevance
// filter, so we don't flood the CRM with thousands of ordinary residential
// registrations that a furniture company will never call.
const RELEVANT_KEYWORDS = ['hotel', 'resort', 'hospitality', 'mall', 'retail', 'club', 'restaurant', 'commercial'];

function isRelevant(projectType, projectName, promoterName) {
  const haystack = `${projectType} ${projectName} ${promoterName}`.toLowerCase();
  return RELEVANT_KEYWORDS.some((kw) => haystack.includes(kw));
}

// RERA's own status values don't map to the doc's construction-lifecycle
// stages, so this is a coarse heuristic, not a fact — good enough to sort a
// worklist, not precise enough to trust blindly.
function stageFromStatus(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('completion')) return 'fit-out';
  if (s.includes('approved')) return 'construction';
  if (s.includes('process') || s.includes('query') || s.includes('registration')) return 'planning';
  return null;
}

const SIGNAL_BY_STAGE = { planning: 'new_project', construction: 'construction_started', 'fit-out': 'fit_out_phase' };

async function fetchDistrict(district) {
  const body = new URLSearchParams({
    project: '', firm: '', appNo: '', regNo: '',
    district, subdistrict: '0', btn1: 'Search',
  });
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; BauhausEngine/1.0)',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`RERA fetch failed for ${district}: ${res.status}`);
  return res.text();
}

function parseRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table#approvedTable tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 10) return;
    const get = (i) => $(cells[i]).text().replace(/\s+/g, ' ').trim();
    rows.push({
      ack_no: get(1),
      reg_no: get(2),
      promoter_name: get(4),
      project_name: get(5),
      status: get(6),
      district: get(7),
      taluk: get(8),
      project_type: get(9),
      approved_on: get(10),
    });
  });
  return rows;
}

async function run() {
  const summary = { fetched: 0, stored: 0, opportunities: 0, addresses: 0, districts: DISTRICTS };
  for (const district of DISTRICTS) {
    const html = await fetchDistrict(district);
    const rows = parseRows(html);
    summary.fetched += rows.length;

    for (const row of rows) {
      if (!isRelevant(row.project_type, row.project_name, row.promoter_name)) continue;
      const externalId = row.reg_no || row.ack_no;
      if (!externalId) continue;

      const isNew = storeRawEvent({
        sourceKey: SOURCE_KEY,
        externalId,
        title: row.project_name,
        url: SEARCH_URL,
        payload: row,
      });
      if (isNew) summary.stored += 1;

      const stage = stageFromStatus(row.status);
      const companyId = getOrCreateCompany(row.promoter_name, { type: 'developer', city: row.district, country: 'India' });
      const { created, id: opportunityId } = upsertOpportunity(`rera:${externalId}`, {
        title: row.project_name || row.promoter_name,
        industry: 'Real Estate / Hospitality',
        company_id: companyId,
        location: `${row.taluk}, ${row.district}`.replace(/^, /, ''),
        stage,
        confidence: 0.75, // structured government source, but stage is a heuristic guess
      });
      if (created) summary.opportunities += 1;

      const signalType = SIGNAL_BY_STAGE[stage];
      if (signalType) {
        recordSignal(opportunityId, signalType, { source: 'rera', evidence: row.project_name, confidence: 0.75 });
      }

      // Only registered (reg_no-bearing) projects have a certificate to pull
      // from, and only companies we haven't already resolved an address for
      // — this is one extra fetch per company, not per project.
      if (row.reg_no && companyId && companyNeedsAddress(companyId)) {
        try {
          const address = await fetchRegisteredAddress(row.reg_no, row.promoter_name);
          if (address) {
            setCompanyAddress(companyId, address);
            summary.addresses += 1;
          }
        } catch {
          // certificate fetch/parse failing shouldn't break the ingestion run
        }
      }
    }
  }
  markSourceChecked(SEARCH_URL);
  return summary;
}

module.exports = { run };
