// Project-type detection shared by render-md.js and render-html.js: is each test case a UI or an API test case?
// The data wins over the declared label (test_kind on the line, then on run_start). See SKILL.md "Project type".
const MEDIA = /\.(png|jpe?g|gif|webp|bmp|webm|mp4|mov)(\?.*)?$/i;
const HTTP_REQ = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/|https?:\/\/)/i;
const HTTP_RESP = /^\s*(HTTP\s*)?[1-5]\d\d\b/i;

const calls = t => [t].concat(t.hops || [], t.attempts || []);
const hasPayload = c => !!(c.request_full || c.response_full);

function shotList(c) { return Array.isArray(c.screenshots) ? c.screenshots : []; }
function isMedia(s) { return MEDIA.test(String((s && s.path) || s || '')); }

function signals(t) {
  const cs = calls(t);
  const payload = cs.some(hasPayload);
  const api = payload || cs.some(c => HTTP_REQ.test(c.request_summary || '') || HTTP_RESP.test(c.response_summary || ''));
  const steps = t.hops || [];
  const ui = cs.some(c => shotList(c).some(isMedia)) || MEDIA.test(String(t.evidence || '')) ||
    cs.some(c => c.is_wait === true) ||
    (steps.length > 0 && steps.every(h => !hasPayload(h) && !HTTP_REQ.test(h.request_summary || '')));
  return { payload, api, ui };
}

// Returns { kinds: {tc_id: 'ui'|'api'}, ui, api, label, mismatches: [{tc_id, declared, detected}] }
function classify(L) {
  const rs = L.find(x => x.type === 'run_start') || {};
  const tcs = L.filter(x => x.type === 'test_case');
  const sig = tcs.map(t => ({ t, s: signals(t) }));
  const decided = {};
  sig.forEach(({ t, s }) => {
    if (s.payload) decided[t.tc_id] = 'api';
    else if (s.api && !s.ui) decided[t.tc_id] = 'api';
    else if (s.ui && !s.api) decided[t.tc_id] = 'ui';
  });
  const vals = Object.keys(decided).map(k => decided[k]);
  const nUi = vals.filter(v => v === 'ui').length, nApi = vals.length - nUi;
  const majority = nUi > nApi ? 'ui' : nApi > nUi ? 'api' : null;
  const kinds = {}, mismatches = [];
  tcs.forEach(t => {
    const declared = t.test_kind || rs.test_kind || null;
    kinds[t.tc_id] = decided[t.tc_id] || declared || majority || 'api';
    if (decided[t.tc_id] && declared && decided[t.tc_id] !== declared) mismatches.push({ tc_id: t.tc_id, declared, detected: decided[t.tc_id] });
  });
  const ui = Object.keys(kinds).filter(k => kinds[k] === 'ui').length, api = tcs.length - ui;
  const label = ui && api ? `Mixed (${ui} UI, ${api} API)` : ui ? 'UI' : 'API';
  return { kinds, ui, api, label, mismatches };
}

// Evidence shown for a test case: on a failure, only the annotated screenshots (raw captures of a failing
// screen are dropped when an annotated copy exists); passed cases keep their "Final UI state (PASS)" shot.
function evidenceShots(list, verdict) {
  const shots = (list || []).filter(isMedia);
  if (verdict === 'PASS') return shots;
  const annotated = shots.filter(s => s.annotated === true);
  return annotated.length ? annotated : shots;
}

module.exports = { classify, signals, evidenceShots, shotList, isMedia };
