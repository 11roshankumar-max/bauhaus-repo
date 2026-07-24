const { PDFParse } = require('pdf-parse');

const UA = 'Mozilla/5.0 (compatible; BauhausEngine/1.0)';

// Every approved RERA project has a registration certificate (Form-C) at
// this URL, keyed by the same registration number we already store as
// external_id. It's a legally-mandated public disclosure of the promoter's
// registered office address — not a scrape of anything private.
async function fetchRegisteredAddress(regNo, promoterName) {
  if (!regNo) return null;
  const url = `https://rera.karnataka.gov.in/certificate?CER_NO=${encodeURIComponent(regNo)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 4).toString() !== '%PDF') return null; // not a valid certificate (e.g. an error page)

  let text;
  try {
    const parser = new PDFParse({ data: buf });
    text = (await parser.getText()).text;
  } catch {
    return null; // malformed/unexpected PDF — skip rather than crash the run
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const nameIdx = lines.findIndex((l) => l.toUpperCase() === promoterName.toUpperCase());
  if (nameIdx === -1) return null;

  const addressLines = [];
  for (let i = nameIdx + 1; i < lines.length; i++) {
    if (/^\d{2}-\d{2}-\d{4}/.test(lines[i]) || lines[i].startsWith('--')) break;
    addressLines.push(lines[i]);
  }
  return addressLines.join(' ') || null;
}

module.exports = { fetchRegisteredAddress };
