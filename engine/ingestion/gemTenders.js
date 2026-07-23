const { storeRawEvent, getOrCreateCompany, upsertOpportunity, recordSignal, markSourceChecked } = require('./lib.js');

const SOURCE_KEY = 'gem_tender';
const BASE = 'https://bidplus.gem.gov.in';
const UA = 'Mozilla/5.0 (compatible; BauhausEngine/1.0)';

// Same public search box any GeM visitor uses (bidplus.gem.gov.in/all-bids) —
// these are the terms a furniture company's procurement tenders show up under.
const QUERIES = ['furniture', 'interior fit out', 'hotel furniture'];

function parseSetCookie(res) {
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function getSessionAndToken() {
  const res = await fetch(`${BASE}/all-bids`, { headers: { 'User-Agent': UA } });
  const cookie = parseSetCookie(res);
  const html = await res.text();
  const match = html.match(/csrf_bd_gem_nk['"]?\s*[:=]\s*['"]([a-f0-9]+)['"]/);
  if (!match) throw new Error('Could not find GeM CSRF token — page structure may have changed');
  return { cookie, csrf: match[1] };
}

async function searchBids(query, cookie, csrf) {
  const payload = JSON.stringify({
    param: { searchBid: query, searchType: 'fullText' },
    filter: { bidStatusType: 'ongoing_bids', byType: 'all', highBidValue: '', byEndDate: { from: '', to: '' }, sort: 'Bid-End-Date-Oldest' },
  });
  const body = new URLSearchParams({ payload, csrf_bd_gem_nk: csrf });
  const res = await fetch(`${BASE}/all-bids-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Cookie: cookie,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`GeM search failed for "${query}": ${res.status}`);
  const json = await res.json();
  return json?.response?.response?.docs || [];
}

async function run() {
  const summary = { fetched: 0, stored: 0, opportunities: 0, queries: QUERIES };
  const { cookie, csrf } = await getSessionAndToken();

  for (const query of QUERIES) {
    const docs = await searchBids(query, cookie, csrf);
    summary.fetched += docs.length;

    for (const doc of docs) {
      const bidNumber = doc.b_bid_number?.[0];
      if (!bidNumber) continue;

      const title = doc.bbt_title?.[0] || (doc.bd_category_name?.[0] || '').slice(0, 120);
      const dept = doc.ba_official_details_deptName?.[0] || doc.ba_official_details_minName?.[0] || 'Government Buyer';

      const isNew = storeRawEvent({
        sourceKey: SOURCE_KEY,
        externalId: bidNumber,
        title,
        url: `${BASE}/showbidDocument/${doc.b_id_parent?.[0] || ''}`,
        payload: doc,
      });
      if (isNew) summary.stored += 1;

      const companyId = getOrCreateCompany(dept, { type: 'government', country: 'India' });
      const { created, id: opportunityId } = upsertOpportunity(`gem:${bidNumber}`, {
        title,
        industry: 'Government / Institutional',
        company_id: companyId,
        stage: 'procurement',
        confidence: 0.65, // keyword match on a tender listing, not a confirmed fit
      });
      if (created) summary.opportunities += 1;
      recordSignal(opportunityId, 'tender_published', { source: 'gem_tender', evidence: title, confidence: 0.65 });
    }
  }
  markSourceChecked(`${BASE}/all-bids-data`);
  return summary;
}

module.exports = { run };
