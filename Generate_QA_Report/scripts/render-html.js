// Builds <slug>.html from the run's .jsonl using the constant report-template.html (head + script verbatim).
const fs = require('fs'), path = require('path');
const slug = process.argv[2];
const repo = path.resolve(__dirname, '../../../..'); // repo root, derived from this script's location
const dir = process.env.QA_LOG_DIR ? path.resolve(process.env.QA_LOG_DIR) : repo + '/NDC_Integration/Artifacts/Logs'; // QA_LOG_DIR: another project's Logs folder
const tpl = fs.readFileSync(path.join(__dirname, '../references/report-template.html'), 'utf8');
const L = fs.readFileSync(path.join(dir, slug + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rs = L.find(x => x.type === 'run_start');
const tcs = L.filter(x => x.type === 'test_case');
const PTM = require('./project-type'), PT = PTM.classify(L), { evidenceShots, shotList } = PTM;
PT.mismatches.forEach(m => console.warn(`WARNING type mismatch: ${m.tc_id} declared ${m.declared}, data says ${m.detected} - rendered as ${m.detected}`));

// ---- head + script, verbatim from template ----
const headStart = tpl.indexOf('<!DOCTYPE html>');
const headEnd = tpl.indexOf('<!-- DATA: header');
const head = tpl.slice(headStart, headEnd);
const scriptStart = tpl.indexOf('<script>', tpl.indexOf('<!-- GENERIC SCRIPT'));
const script = tpl.slice(scriptStart);

// ---- CSV rows for "View Test Case" ----
function parseCsv(t) { const rows = []; let r = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; } else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else if (c !== '\r') f += c; } if (f || r.length) { r.push(f); rows.push(r); } return rows; }
let csv = []; try { csv = parseCsv(fs.readFileSync((process.env.QA_TESTCASES_DIR ? path.resolve(process.env.QA_TESTCASES_DIR) : repo + '/NDC_Integration/TestCases') + '/' + ((L.find(x => x.type === 'run_start') || {}).csv_file || 'SeatMap_TestCases.csv'), 'utf8')); } catch (e) { /* a UI/manual run may have no CSV: "View Test Case" then falls back to the log line */ }
const hdr = csv[0] || []; const csvRow = id => { const r = csv.find(x => x[0] === id); const o = {}; if (r) hdr.forEach((h, i) => o[h] = r[i]); return o; };

// ---- plain-language rows ----
const PL = {
 'TC-SEATMAP-POS-02': { e: 'Confirm the seat-map step hands a usable reference to the booking step, and that booking accepts it', q: 'Searched a one-way flight from Bahrain to Riyadh for one adult, opened the seat map, then tried to book using the seat map\'s own reference (no seat chosen) &mdash; three separate times', s: 'The seat map opened every time with a valid reference; every booking attempt ended in an error after about 35 seconds and returned no booking reference', x: 'The booking should be accepted and return its booking reference and ticket details', a: 'Could not be judged. The system did create real tickets each time (booking references RIPLBZ, TVQBBV and RCEVKA were found inside the error messages) but never told the caller. This is the already-known BUG-16 pattern and it blocks this check' },
 'TC-SEATMAP-VAL-03': { e: 'Confirm the seat code copied from the seat map is accepted when booking a specific seat', q: 'Tried to book seat 12C using the exact seat code copied from that offer\'s seat map', s: 'Rejected with an error saying the booking had already been created; no seat details came back', x: 'The booking should accept the seat code and attach that seat, showing it in the confirmation', a: 'Could not be judged: that offer had already been booked by the first test above (BUG-16), and a new booking cannot show its seat while every booking call ends in an error. Not repeated this round; earlier rounds confirmed the seat code works' },
 'TC-SEATMAP-VAL-04': { e: 'Confirm a seat code taken from one flight offer is refused when used on a different offer', q: 'Opened seat maps for two separate offers, then tried to book on the second offer with seat 12B but using the seat code copied from the first offer\'s seat 12C', s: 'After about 48 seconds the booking call ended in the general error (BUG-16), but the error message contains a real booking confirmation: reference REGOSM, ticket 722136996975, total 1053 SAR', x: 'The booking should have been refused straight away, because the seat code belongs to another offer', a: '<b>BUG-07, 8th confirmed occurrence (not new)</b> &mdash; the foreign seat code was not rejected; a real ticketed booking was created with the 60 SAR seat added to the price (993 + 60 = 1053 SAR), and the seat then disappeared from the seat maps' },
 'TC-SEATMAP-VAL-07': { e: 'Confirm each seat\'s window, aisle, extra-legroom and exit-row attributes can be worked out from the seat map data', q: 'Opened the seat map for one adult on Bahrain to Riyadh (1 July 2027) and checked all 176 seats', s: 'The seat map returned 176 seats in 30 rows; every seat carries descriptive text but none carries a standard airline seat-characteristic code', x: 'Window, aisle, legroom and exit-row attributes should be derivable and never contradict a seat\'s column position', a: 'All 176 seats are consistent: 59 window, 59 aisle, 58 middle, 24 exit-row seats (rows 18&ndash;21) and 16 extra-legroom seats. The attributes can only be read from the description text, because the standard codes are all "Unknown" for this airline' },
 'TC-SEATMAP-VAL-08': { e: 'Confirm only bookable seats carry prices', q: 'Used the same seat map and grouped every seat by availability', s: '176 bookable (paid) seats, all with prices; 34 other cells (walkways and unavailable seats) with no seat details', x: 'Every bookable seat should have a full price breakdown; unavailable seats should have none', a: 'Confirmed: all 176 paid seats have a complete price (120, 60 or 40 SAR, no taxes) and no other cell has a price. The "blocked/occupied" half could not be exercised, because this airline hides taken seats instead of labelling them' },
 'TC-SEATMAP-VAL-09': { e: 'Confirm no two seats on the flight share the same seat code', q: 'Used the same seat map and compared every seat code on the flight', s: '176 seats with 176 different codes', x: 'Every seat code should be unique within the flight', a: 'No duplicates found (rows 8 to 38, seats A to F)' },
 'TC-SEATMAP-VAL-10': { e: 'Confirm the seat map\'s rows, cabin sections and columns are structured sensibly', q: 'Used the same seat map and checked its rows, cabin sections and seat columns', s: 'One deck, one cabin section, 30 rows numbered 8 to 38, seat columns A&ndash;F with an aisle gap', x: 'Row numbers and section names should be unique, seat columns only A&ndash;F, and empty columns only for aisle gaps', a: 'All four rules hold: 30 unique rows, 1 unique section, columns A&ndash;F only, and the 30 aisle gaps are the only cells without a column. The 4 already-taken seats appear as empty cells' },
 'TC-SEATMAP-BIZ-03': { e: 'Confirm each passenger\'s own seat availability and pricing agree with each other', q: 'Opened the seat map for a family of three (two adults and one child) on Bahrain to Riyadh', s: '176 seats, each priced for all three passengers, and each passenger has a list of 176 seats they may pick', x: 'A passenger shown a price for a seat should also be allowed to pick that seat; it is fine if not every passenger is listed', a: 'Fully consistent: 528 price entries, none for a seat outside that passenger\'s list and none missing. Side note: the child is offered all 24 exit-row seats (already-known BUG-09)' },
 'TC-SEATMAP-BIZ-04': { e: 'Confirm the seat map shows live seat availability rather than a stored copy', q: 'Opened the seat map (seat 12B available), then seat 12B was taken by a booking, then opened the same offer\'s seat map again and a brand-new offer\'s seat map', s: 'Before: 12B available for 60 SAR. After: 12B is gone (shown as an empty cell) on both the same offer and the new offer; 176 seats became 175', x: 'Unknown &mdash; if a seat can be taken in between, the map should change, proving it is live', a: 'Confirmed live: the change showed up immediately on both offers. The booking that took the seat reported an error (BUG-16) but still went through. A taken seat is shown as an empty "no seat" cell, not as "Occupied"' },
 'TC-SEATMAP-SEC-01': { e: 'Confirm the seat-map request is refused for a wrong key, a wrong client name, or another tenant\'s credentials', q: 'Sent the seat-map request four ways: wrong access key, wrong client name, a different airline system, and the same airline with another country\'s credentials (UAE instead of KSA) &mdash; plus three extra checks', s: 'Wrong key: refused. Wrong client name: refused. Different airline system: refused. Same airline with UAE credentials: accepted &mdash; the full seat map came back', x: 'All three kinds of request should be refused', a: '<b>BUG-17, 2nd confirmed occurrence (not new)</b> &mdash; switching only the credentials country is not checked, so an offer created under one tenant (KSA) can be read through another (UAE)' },
 'TC-SEATMAP-SEC-02': { e: 'Record that the airline-side login security and the logging cannot be checked through this API', q: 'No API call &mdash; a documentation check of the project specification and requirements', s: 'Not applicable', x: 'Note that these two requirements need a backend configuration audit and a log review, not API tests', a: 'Documented; the specification still says the same. These two acceptance criteria must not be marked as covered by API tests' },
};

// ---- panels ----
const dots = '&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;(redacted)';
function hdrLines(h) { return Object.keys(h).map(k => { const v = h[k]; if (k === 'x-api-key') return `<div class="rr-h-line">x-api-key: <span class="rr-redacted">${String(v).startsWith('[REDACTED -') ? esc(v) : dots}</span></div>`; return `<div class="rr-h-line">${esc(k)}: ${esc(v)}</div>`; }).join('\n'); }
function pre(o) { return `<div class="rr-box rr-body-box"><pre>${esc(typeof o === 'string' ? o : JSON.stringify(o, null, 4))}</pre></div>`; }
function shotLinks(list, verdict) { return evidenceShots(list, verdict).map(s => `<div><a href="${esc(s.path)}">${esc(s.label || s.path)}</a></div>`).join(''); }
function pair(rq, rp, title1, title2) {
  const trunc = /__omitted__|\.\.\.\[truncated\]/.test(JSON.stringify(rq.body) + JSON.stringify(rp.body));
  let h = `<div class="rr-title">${title1 || 'Request'}</div>\n<div class="rr-line">POST to ${esc(rq.url)}</div>\n<div class="rr-label">HEADERS</div>\n<div class="rr-box rr-headers-box">\n${hdrLines(rq.headers)}\n</div>\n<div class="rr-label">BODY</div>\n${pre(rq.body)}\n`;
  h += `<div class="rr-title" style="margin-top:18px;">${title2 || 'Response'}</div>\n<div class="rr-line">Status code ${rp.status}</div>\n`;
  if (rp.headers && Object.keys(rp.headers).length) h += `<div class="rr-label">HEADERS</div>\n<div class="rr-box rr-headers-box">\n${Object.keys(rp.headers).map(k => `<div class="rr-h-line">${esc(k)}: ${esc(rp.headers[k])}</div>`).join('\n')}\n</div>\n`;
  h += `<div class="rr-label">BODY</div>\n${pre(rp.body)}\n`;
  if (trunc) h += `<div class="rr-note">Large arrays, objects and long opaque tokens are truncated for report length (marked "__omitted__" / "[truncated]"); the full payload was inspected live. Raw supplier payloads are redacted per SPEC.md &sect;7.14.</div>\n`;
  return h;
}

// ---- category handling ----
const slugCat = c => c.toLowerCase().replace(/[^a-z]+/g, '-');
const ICON = { Positive: '&#9989;', Negative: '&#10060;', Validation: '&#9745;&#65039;', Boundary: '&#128207;', 'Business Rule': '&#9878;&#65039;', Regression: '&#128257;', Security: '&#128274;', Integration: '&#128279;', Documentation: '&#128196;', Flow: '&#128256;', 'Flow - Positive': '&#128256;', 'Flow - Negative': '&#128256;' };
const cats = []; tcs.forEach(t => { if (!cats.includes(t.category)) cats.push(t.category); });
const cnt = (arr, v) => arr.filter(t => t.verdict === v).length;

function card(t) {
  const ui = PT.kinds[t.tc_id] === 'ui';
  const p = t.plain || PL[t.tc_id] || { e: esc(t.endpoint_or_flow), q: esc(t.request_summary), s: esc(t.response_summary), x: esc(t.expected), a: esc(t.actual) }, csvr = csvRow(t.tc_id);
  const title = esc(t.title.replace(/^\[[^\]]*\]\[[^\]]*\]\s*/, ''));
  let h = `<details class="tc ${t.verdict}">\n<summary class="tc-head"><span><span class="chev"></span><span class="mono">${t.tc_id}</span> - ${title}</span><span class="badge ${t.verdict}">${t.verdict}</span></summary>\n`;
  const L3 = ui ? ['Feature', 'Steps performed', 'Observed'] : ['Endpoint Name', 'Request', 'Response'];
  h += `<div class="row"><b>${L3[0]}:</b> ${p.e}</div>\n<div class="row"><b>${L3[1]}:</b> ${p.q}</div>\n<div class="row"><b>${L3[2]}:</b> ${p.s}</div>\n<div class="row"><b>Expected:</b> ${p.x}</div>\n<div class="row"><b>Actual:</b> ${p.a}</div>\n`;
  const single = !ui && !t.hops && (t.request_full || t.attempts);
  h += single ? `<div class="row tc-status-row"><b>Status:</b> <span class="badge ${t.verdict}">${t.verdict}</span><span class="tc-reqres-anchor"></span></div>\n` : `<div class="row"><b>Status:</b> <span class="badge ${t.verdict}">${t.verdict}</span></div>\n`;
  const uiShots = ui ? [t].concat(t.attempts || []).map(c => shotLinks(shotList(c), t.verdict)).join('') : '';
  h += `<details class="evidence"><summary>Evidence</summary><div class="ev-body">${esc(t.evidence)}${uiShots}</div></details>\n`;
  if (ui) {
    if (t.hops) {
      h += `<details class="hops"><summary>Steps (${t.hops.length})</summary>\n`;
      t.hops.forEach((x, i) => {
        h += `<div class="hop ui-step"><span class="badge ${x.verdict}">${x.verdict}</span> <span class="hop-endpoint">${i + 1}. ${esc(x.step || x.endpoint)}</span>\n<div class="hd"><b>Observed:</b> ${esc(x.observed || x.actual)}</div>\n<div class="hd"><b>Expected:</b> ${esc(x.expected)}</div>\n<div class="hd"><b>Evidence:</b> ${esc(x.evidence)}${shotLinks(shotList(x), x.verdict)}</div>\n</div>\n`;
      });
      h += `</details>\n`;
    }
  } else if (t.hops) {
    h += `<details class="hops"><summary>Hops (${t.hops.length})</summary>\n`;
    t.hops.forEach((x, i) => {
      h += `<div class="hop"><span class="badge ${x.verdict}">${x.verdict}</span> <span class="hop-endpoint">${i + 1}. ${esc(x.endpoint)}</span>\n<div class="hd"><b>Request:</b> ${esc(x.request_summary)}</div>\n<div class="hd"><b>Response:</b> ${esc(x.response_summary)}</div>\n<div class="hd"><b>Expected:</b> ${esc(x.expected)}</div>\n<div class="hd"><b>Actual:</b> ${esc(x.actual)}</div>\n<div class="hd"><b>Evidence:</b> ${esc(x.evidence)}</div>\n`;
      if (x.request_full) h += `<div class="hop-reqres-panel">\n${pair(x.request_full, x.response_full)}</div>\n`;
      h += `</div>\n`;
    });
    h += `</details>\n`;
  } else if (t.attempts) {
    h += `<div class="tc-reqres-panel">\n` + t.attempts.map(a => `<div class="rr-attempt-label">${esc(a.label)}</div>\n${pair(a.request_full, a.response_full)}`).join('') + `</div>\n`;
  } else if (t.request_full) {
    h += `<div class="tc-reqres-panel">\n${pair(t.request_full, t.response_full)}</div>\n`;
  }
  const steps = csvr['Steps / Endpoint Chain'] || t.request_summary;
  h += `<div class="view-tc-wrap"><details class="view-tc"><summary>View Test Case</summary><div class="view-tc-body"><div class="vtc-h">Preconditions</div><div class="vtc-p">${esc(csvr['Preconditions'])}</div><div class="vtc-h">Steps</div><ol class="vtc-steps">${(/^1\.\s/.test(steps) ? steps.split(/\s+(?=\d+\.\s)/).map(x => x.replace(/^\d+\.\s*/, '')) : [steps]).map(x => `<li>${esc(x)}</li>`).join('')}</ol><div class="vtc-h">Expected Result</div><div class="vtc-p">${esc(csvr['Expected Result'] || t.expected)}</div><div class="vtc-h">Actual Result</div><div class="vtc-p">${esc(t.actual)}</div></div></details></div>\n</details>\n`;
  return h;
}

// ---- timing ----
const tsAll = []; L.forEach(x => ['started_at', 'ended_at', 'at', 'reporting_ended_at', 'timestamp'].forEach(k => { if (x[k]) tsAll.push(Date.parse(x[k])); }));
const startMs = Date.parse(rs.started_at), maxTs = Math.max(...tsAll);
const fmtDur = ms => { const s = Math.round(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + r + 's'; };
const utc = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const hasTiming = tcs.some(t => t.started_at);

// ---- body ----
const P = tcs.filter(t => t.verdict === 'PASS').length, F = tcs.filter(t => t.verdict === 'FAIL').length, B = tcs.filter(t => t.verdict === 'BLOCKED').length, N = tcs.length;
const pp = P / N * 100, fp = F / N * 100;
const stops = [`var(--good) 0% ${pp.toFixed(2)}%`]; if (F) stops.push(`var(--critical) ${pp.toFixed(2)}% ${(pp + fp).toFixed(2)}%`); if (B) stops.push(`var(--serious) ${(pp + fp).toFixed(2)}% 100%`);
let b = '';
b += `<div class="header"><div class="header-main">\n<h1>QA Execution Report</h1>\n</div></div>\n\n`;
b += `<div class="meta-card dashboard-card">\n<div class="fields">\n<div class="field"><span class="k">Scope</span><span class="v">${rs.scope_text || (`${tcs.length} test cases from SeatMap_TestCases.csv: ${tcs.map(t => t.tc_id).join(', ')}`)}</span></div>\n<div class="field-row">\n<div class="field"><span class="k">Coverage</span><span class="v">${rs.coverage_text || (`${tcs.length} of ${rs.total_test_cases_planned} planned test cases`)}</span></div>\n<div class="field"><span class="k">Description</span><span class="v">${rs.description_text || ''}</span></div>\n</div>\n</div>\n<div class="fields run-meta">\n<div class="field-row">\n${rs.supplier === false ? '' : `<div class="field"><span class="k">Supplier</span><span class="v">${rs.supplier || 'GulfAir'}</span></div>\n<div class="field"><span class="k">Credentials Selector</span><span class="v">${rs.credentials_selector || 'KSA'}</span></div>\n`}<div class="field"><span class="k">Environment</span><span class="v">${rs.environment_text || 'staging (ndc-integration-stg-ne-3)'} &middot; ${rs.baseUrl}</span></div>\n<div class="field"><span class="k">Project Type</span><span class="v">${PT.label}</span></div>\n</div>\n<div class="field"><span class="k">Started</span><span class="v">${utc(startMs)}</span></div>\n<div class="field"><span class="k">Ended</span><span class="v">${utc(maxTs)}</span></div>\n<div class="field"><span class="k">Status</span><span class="v">COMPLETE</span></div>\n</div>\n</div>\n\n`;
b += `<h2 class="section-num">1. Executive Summary</h2>\n<div class="summary-layout">\n<div class="donut-block">\n<div class="donut" style="background:conic-gradient(${stops.join(', ')})">\n<div class="donut-hole"><div class="donut-pct">${Math.round(pp)}%</div><div class="donut-sub">pass rate</div></div>\n</div>\n<div class="donut-legend">\n<div class="litem"><span class="swatch pass"></span>Passed <span class="lcount">${P} / ${N}</span></div>\n<div class="litem"><span class="swatch fail"></span>Failed <span class="lcount">${F} / ${N}</span></div>\n<div class="litem"><span class="swatch blocked"></span>Blocked <span class="lcount">${B} / ${N}</span></div>\n</div>\n</div>\n<div class="stats-block">\n<div class="scard scard-total dashboard-card"><div class="val">${N}</div><div class="lbl">Total Executed Test Cases</div></div>\n<div class="summary-cards">\n<div class="scard dashboard-card"><div class="val pass">${P}</div><div class="lbl">Passed</div></div>\n<div class="scard dashboard-card"><div class="val fail">${F}</div><div class="lbl">Failed</div></div>\n<div class="scard dashboard-card"><div class="val blocked">${B}</div><div class="lbl">Blocked</div></div>\n</div>\n<div class="scard scard-total dashboard-card"><div class="val">${fmtDur(maxTs - startMs)}</div><div class="lbl">Execution Duration</div>${hasTiming ? `<a class="time-breakdown-link" href="./${slug}_TimeBreakdown.html">View Time Breakdown</a>` : ''}</div>\n</div>\n</div>\n\n`;
b += `<div class="tc-actions">\n<button type="button" id="tcExpandAll">Expand all</button>\n<button type="button" id="tcCollapseAll">Collapse all</button>\n</div>\n\n<details class="section-collapse tc-section" open>\n<summary>Test case results</summary>\n\n`;
b += `<div class="tc-toolbar dashboard-card">\n<input type="search" id="tcSearch" placeholder="Search by ID, title, endpoint, PNR...">\n<select id="tcStatusFilter">\n<option value="">All statuses</option>\n<option value="PASS">PASS</option>\n<option value="FAIL">FAIL</option>\n<option value="BLOCKED">BLOCKED</option>\n</select>\n<select id="tcCategoryFilter">\n<option value="">All categories</option>\n${cats.map(c => `<option value="${slugCat(c)}">${c}</option>`).join('\n')}\n</select>\n<button type="button" id="tcResetFilters">Reset</button>\n<span id="tcCount" class="tc-count"></span>\n</div>\n<div id="tcNoResults" class="tc-no-results js-hidden">No test cases match your search. Try a different keyword, or clear the search/filters above.</div>\n\n`;
cats.forEach(c => {
  const ts = tcs.filter(t => t.category === c);
  b += `<details class="tc-category" data-cat="${slugCat(c)}" open>\n<summary><span class="cat-icon">${ICON[c]}</span><span class="cat-name">${c}</span><span class="cat-counts"><span class="cc pass">${cnt(ts, 'PASS')} passed</span><span class="cc fail">${cnt(ts, 'FAIL')} failed</span>${cnt(ts, 'BLOCKED') ? `<span class="cc blocked">${cnt(ts, 'BLOCKED')} blocked</span>` : ''}</span><span class="cat-chev"></span></summary>\n<div class="tc-category-body">\n<div class="tc-cat-actions"><button type="button" class="tc-cat-expand">Expand all</button><button type="button" class="tc-cat-collapse">Collapse all</button></div>\n`;
  ts.forEach(t => { b += card(t) + '\n'; });
  b += `</div>\n</details>\n\n`;
});
b += `</details>\n\n`;

// findings
const fd = L.filter(x => x.type === 'finding'), defs = fd.filter(f => f.kind === 'defect'), unk = fd.filter(f => f.kind === 'unknown_resolution'), rec = fd.filter(f => f.kind === 'reconfirmed');
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 10 > 3 || [11, 12, 13].includes(n % 100)) ? 0 : n % 10]);
// UI defects: same annotated-only screenshots as the failing test case's card (a finding's own `screenshots` win)
const findingShots = f => { const t = tcs.find(x => x.tc_id === f.related_tc_id); if (!t || PT.kinds[t.tc_id] !== 'ui') return ''; return f.screenshots ? shotLinks(f.screenshots, t.verdict) : [t].concat(t.attempts || []).map(c => shotLinks(shotList(c), t.verdict)).join(''); };
const bugDir =path.join(dir, '..', 'BugReports', slug); const BUGFILE = new Proxy({}, { get: (_, id) => { try { return fs.readdirSync(bugDir).find(f => f.startsWith(id + '_')); } catch (e) { return undefined; } } });
const SPECREF = new Proxy({}, { get: (_, id) => { const t = tcs.find(x => x.tc_id === id); return t && t.spec_ref ? esc(t.spec_ref) : ''; } });
b += `<details class="section-collapse" open>\n<summary class="section-summary-flex">Findings<span class="section-count-badges"><span class="section-count-badge"><span class="scb-val serious">${defs.length}</span><span class="scb-lbl">Defects</span></span><span class="section-count-badge"><span class="scb-val accent">${unk.length}</span><span class="scb-lbl">Unknown-resolution</span></span></span></summary>\n`;
defs.forEach(f => {
  b += `<div class="finding defect"><div class="kind">Defect${f.bug_id ? (f.occurrence ? ` &mdash; ${f.bug_id}, ${ord(f.occurrence)} confirmed occurrence (not new)` : ` &mdash; ${f.bug_id} (new)`) : ''}</div>\n${esc(f.summary)} <span class="mono">(${SPECREF[f.related_tc_id] || ''}, ${f.related_tc_id})</span>\n<div><b>Field:</b> <code>${esc(f.field_name)}</code></div>\n<div><b>Expected value:</b> <code>${esc(f.expected_value)}</code></div>\n${f.history ? `<div><b>History:</b> ${esc(f.history)}</div>\n` : ''}<div><b>Impact:</b> ${esc(f.impact)}${BUGFILE[f.bug_id] ? ` See <a href="../BugReports/${slug}/${BUGFILE[f.bug_id]}">full bug report</a>.` : ''}</div>\n<div><b>Evidence:</b> ${esc(f.evidence)}${findingShots(f)}</div>\n</div>\n`;
});
unk.forEach(f => { b += `<div class="finding unknown_resolution"><div class="kind">Unknown-resolution</div>\n${esc(f.summary)} <span class="mono">(${f.related_tc_id})</span>\n</div>\n`; });
if (rec.length) b += `<p class="empty" style="margin-top:10px;">Also re-confirmed this round: ${rec.map(f => `${f.bug_id} (${esc(f.summary)}) &mdash; see ${f.related_tc_id}`).join('; ')}.</p>\n`;
if (!fd.length) b += `<p class="empty">No findings logged for this run.</p>\n`;
b += `</details>\n\n`;
const nr = L.filter(x => x.type === 'not_reproduced');
if (nr.length) b += `<details class="section-collapse" open>\n<summary>Not reproduced</summary>\n${nr.map(n => `<p style="font-size:13px; color:var(--ink-2); margin:0;"><b>${n.bug_id}</b> (${esc(n.short_name)}) &mdash; exercised by ${n.related_tc_ids.join(', ')}. ${esc(n.note)}</p>`).join('\n')}\n</details>\n\n`;
const sp = L.filter(x => x.type === 'spec_update_proposed');
b += `<details class="section-collapse" open>\n<summary class="section-summary-flex">Proposed SPEC.md updates<span class="section-count-badge"><span class="scb-val">${sp.length}</span><span class="scb-lbl">Proposed Updates</span></span></summary>\n<div style="font-size:13px; color:var(--ink-2);">\n${sp.length ? sp.map(s => `<p><b>${esc(s.section)}</b> &mdash; status: <i>${s.status}</i></p>\n<p><b>Old:</b> "${esc(s.old_text)}"</p>\n<p><b>New:</b> "${esc(s.new_text)}"</p>${s.note ? `\n<p><b>Correction:</b> ${esc(s.note)}</p>` : ''}`).join('\n') : '<p class="empty">No SPEC.md updates proposed this run.</p>'}\n</div>\n</details>\n\n`;

const out = head + b + '</div>\n' + script;
fs.writeFileSync(path.join(dir, slug + '.html'), out.replace(/<!--[\s\S]*?-->/g, m => m), 'utf8');
console.log('html bytes', out.length);
