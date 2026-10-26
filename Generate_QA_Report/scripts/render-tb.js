// Builds <slug>_TimeBreakdown.html from the .jsonl per log-schema.md's execution-time accounting rule.
const fs = require('fs'), path = require('path');
const slug = process.argv[2];
const repo = path.resolve(__dirname, '../../../..'); // repo root, derived from this script's location
const dir = process.env.QA_LOG_DIR ? path.resolve(process.env.QA_LOG_DIR) : repo + '/NDC_Integration/Artifacts/Logs'; // QA_LOG_DIR: another project's Logs folder
const tpl = fs.readFileSync(path.join(__dirname, '../references/time-breakdown-template.html'), 'utf8');
const L = fs.readFileSync(path.join(dir, slug + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rs = L.find(x => x.type === 'run_start'); const tcs = L.filter(x => x.type === 'test_case');
const T = s => Date.parse(s);
const head = tpl.slice(tpl.indexOf('<!DOCTYPE html>'), tpl.indexOf('<!-- DATA: back-link'));
const script = tpl.slice(tpl.indexOf('<div class="tb-modal')).replace(/<!--[\s\S]*?-->/g, '');
const fmtDur = ms => { const s = Math.round(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + r + 's'; };
const fmtS = s => fmtDur(s * 1000);
const fmtP = ms => ms < 1000 ? Math.round(ms) + ' ms' : ms < 10000 ? (ms / 1000).toFixed(2) + 's' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : fmtDur(ms);
const hms = ms => new Date(ms).toISOString().slice(11, 19);
const utc = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const pct = (v, tot) => (tot ? (v / tot * 100) : 0).toFixed(1);

const tsAll = []; L.forEach(x => ['started_at', 'ended_at', 'at', 'reporting_ended_at', 'timestamp'].forEach(k => { if (x[k]) tsAll.push(T(x[k])); }));
const startMs = T(rs.started_at), endMs = Math.max(...tsAll), total = endMs - startMs;

// execution = union of test-case spans + hop spans
// Execution = wall-clock time during which at least one API call was in flight (each call counted once). A test case's own
// intervals are its hops'/attempts' [started_at, ended_at]; a log without per-call times falls back to the test case's whole span.
const callIv = t => { const c = [...(t.hops || []).map(h => [h.started_at, h.ended_at]), ...(t.attempts || []).map(a => [a.started_at, a.ended_at])].filter(x => x[0] && x[1]).map(x => [T(x[0]), T(x[1])]); if (!c.length && t.started_at && t.timestamp && !(t.hops || t.attempts)) c.push([T(t.started_at), T(t.timestamp)]); return c; };
const iv = []; tcs.forEach(t => callIv(t).forEach(c => iv.push([c[0], c[1], t.tc_id])));
iv.sort((a, b) => a[0] - b[0]);
const merged = []; iv.forEach(i => { const last = merged[merged.length - 1]; if (last && i[0] <= last[1]) { if (i[1] > last[1]) { last[1] = i[1]; last[3] = i[2]; } } else merged.push([i[0], i[1], i[2], i[2]]); });
const exec = merged.reduce((s, m) => s + (m[1] - m[0]), 0);
const execShare = {}; { const pts = [...new Set(iv.flatMap(i => [i[0], i[1]]))].sort((a, b) => a - b); for (let k = 0; k + 1 < pts.length; k++) { const a0 = pts[k], b0 = pts[k + 1]; const act = [...new Set(iv.filter(i => i[0] <= a0 && i[1] >= b0).map(i => i[2]))]; act.forEach(id => { execShare[id] = (execShare[id] || 0) + (b0 - a0) / act.length; }); } }
const wait = tcs.reduce((s, t) => s + (t.waiting_ms || 0), 0) + L.filter(x => x.type === 'wait').reduce((s, w) => s + (T(w.ended_at) - T(w.started_at)), 0);
const claude = L.filter(x => x.type === 'ai_operation').reduce((s, a) => s + (T(a.ended_at) - T(a.started_at)), 0);
const ops = L.filter(x => x.type === 'reporting_op');
const repTc = tcs.reduce((s, t) => s + ((t.reporting_started_at && t.reporting_ended_at) ? T(t.reporting_ended_at) - T(t.reporting_started_at) : 0), 0);
const repOps = ops.reduce((s, o) => s + (T(o.ended_at) - T(o.started_at)), 0);
const report = repTc + repOps;
const r = ms => Math.round(ms / 1000);
const dTot = r(total), dExec = r(exec), dWait = r(wait), dClaude = r(claude), dRep = r(report), dOver = dTot - dExec - dWait - dClaude - dRep;
const acc = dExec + dWait + dClaude + dRep + dOver;

// overhead gaps: timeline minus (exec intervals U reporting intervals)
const cover = merged.map(m => [m[0], m[1], 'exec', m[2], m[3]]);
tcs.forEach(t => { if (t.reporting_started_at && t.reporting_ended_at) cover.push([T(t.reporting_started_at), T(t.reporting_ended_at), 'rep']); });
ops.forEach(o => cover.push([T(o.started_at), T(o.ended_at), 'rep']));
cover.sort((a, b) => a[0] - b[0]);
const gaps = []; let cur = startMs, prev = null;
cover.forEach(c => { if (c[0] > cur) gaps.push({ from: cur, to: c[0], prev, next: c }); if (c[1] > cur) cur = c[1]; prev = c; });
if (endMs > cur) gaps.push({ from: cur, to: endMs, prev, next: null });

const evs = [];
tcs.forEach(t => { if (t.started_at && t.timestamp) evs.push({ s: T(t.started_at), e: T(t.timestamp), label: t.tc_id + ' (whole test case)', rank: 1 }); (t.hops || []).forEach(h => evs.push({ s: T(h.started_at), e: T(h.ended_at), label: t.tc_id + ' hop ' + h.hop + ' - ' + h.endpoint, rank: 2 })); if (t.reporting_started_at) evs.push({ s: T(t.reporting_started_at), e: T(t.reporting_ended_at), label: t.tc_id + ' log write', rank: 2 }); });
ops.forEach(o => evs.push({ s: T(o.started_at), e: T(o.ended_at), label: o.operation, rank: 2 }));
L.filter(x => x.type === 'phase').forEach(p => evs.push({ s: T(p.at), e: T(p.at), label: 'Phase "' + p.name + '" ' + (p.event === 'start' ? 'started' : 'ended'), rank: 0 }));
evs.push({ s: startMs, e: startMs, label: 'Run started (run_start)', rank: 0 });
const before = ms => { const c = evs.filter(x => Math.abs(x.e - ms) <= 60).sort((a, b) => b.rank - a.rank)[0]; return c ? (c.rank === 0 ? c.label + ' at ' + hms(c.e) : c.label + ', ended ' + hms(c.e)) : '-'; };
const after = ms => { const c = evs.filter(x => Math.abs(x.s - ms) <= 60).sort((a, b) => b.rank - a.rank)[0]; return c ? (c.rank === 0 ? c.label + ' at ' + hms(c.s) : c.label + ', started ' + hms(c.s)) : '-'; };
const details = L.filter(x => x.type === 'overhead_detail');
const big = gaps.filter(g => g.to - g.from >= 2000), small = gaps.filter(g => g.to - g.from < 2000 && g.to - g.from >= 1);
const rows = big.map(g => { const d = [...details].reverse().find(x => Math.abs(T(x.from) - g.from) <= 3000); return { from: g.from, to: g.to, len: g.to - g.from, label: d ? d.label : 'Gap after ' + before(g.from) + ' and before ' + after(g.to), steps: d ? d.steps : ['No notes were recorded for this window. It is the time between the two events shown above that no test case, wait, AI operation or reporting operation accounts for.'], before: before(g.from), after: after(g.to) }; });
if (small.length) rows.push({ from: small[0].from, to: small[small.length - 1].to, len: small.reduce((s, g) => s + (g.to - g.from), 0), label: 'Short gaps between the per-test-case log writes (' + small.length + ' gaps under 2 seconds)', steps: ["Each test case's log line and Markdown re-render ran back to back; these are the sub-2-second pauses between one render finishing and the next one starting."], before: 'the per-test-case log writes', after: 'the per-test-case log writes', agg: true });
rows.sort((a, b) => a.from - b.from);
let rowSecs = rows.map(x => Math.round(x.len / 1000)); const diff = dOver - rowSecs.reduce((a, b) => a + b, 0);
if (rows.length && diff) { let mi = rowSecs.indexOf(Math.max(...rowSecs)); rowSecs[mi] += diff; }

const defectTcs = [...new Set(L.filter(x => x.type === 'finding' && x.kind === 'defect').map(x => x.related_tc_id))];
// Reporting breakdown: every row opens the shared popup (#tbModal)
const OP_WHAT = {
  'Bug Report Generation': ['Drafted one Markdown bug report per defect finding, plus an index README, from the log (history, steps, actual/expected JSON, severity, evidence, impact).'],
  'Final HTML Report Generation': ['Rendered the single self-contained QA report (.html) from the finished .jsonl: summary donut, category cards, per-test-case request/response panels, findings, proposed SPEC.md updates and clean-up list.'],
  'Time Breakdown Report Generation': ['Rendered this Time Breakdown page from the .jsonl timestamps (categories, phases, AI operations, reporting, per-test-case table, timeline, overhead).']
};
const phaseAt = (ms, dir) => { const ev = dir < 0 ? [...L].filter(x => x.type === 'phase' && T(x.at) <= ms).pop() : L.filter(x => x.type === 'phase' && T(x.at) >= ms)[0]; return ev ? 'Phase "' + ev.name + '" ' + (ev.event === 'start' ? 'started' : 'ended') + ' at ' + hms(T(ev.at)) : (dir < 0 ? 'run start' : 'run end'); };
const repDetail = (title, from, to, len, steps, note) => ({ title, start: utc(from), end: utc(to), duration: fmtP(len), share: pct(len, total) + '% of total', before: 'Right before: ' + phaseAt(from, -1) + '.', after: 'Right after: ' + phaseAt(to, 1) + '.', steps, note });
const attr = o => { const ids = o.related_tc_ids || (o.operation === 'Bug Report Generation' ? defectTcs : null); return ids ? 'Its duration is split evenly across the ' + ids.length + ' test cases it was about (' + ids.slice(0, 6).join(', ') + (ids.length > 6 ? ', ...' : '') + ') in the Reporting column of the Test Case Time table.' : 'Run-level work, not attributable to one test case: it appears in the Reporting card but in no test case row.'; };
const dataAttr = d => esc(JSON.stringify(d)).replace(/"/g, '&quot;');
// Reporting items (formerly section 4 rows) - rendered as sub-rows under the phase that contains them.
const subItems = ops.map(o => { const len = T(o.ended_at) - T(o.started_at); return { name: o.operation, s: T(o.started_at), e: T(o.ended_at), len, d: repDetail(o.operation, T(o.started_at), T(o.ended_at), len, OP_WHAT[o.operation] || ['Report-artifact work recorded in the log as a reporting operation.'], attr(o)) }; });
if (repTc) {
  const w = tcs.filter(t => t.reporting_started_at && t.reporting_ended_at).map(t => ({ id: t.tc_id, s: T(t.reporting_started_at), e: T(t.reporting_ended_at), len: T(t.reporting_ended_at) - T(t.reporting_started_at) }));
  const sorted = [...w].sort((x, y) => y.len - x.len), avg = repTc / w.length, first = Math.min(...w.map(x => x.s)), last = Math.max(...w.map(x => x.e));
  const steps = ['For each of the ' + w.length + ' test cases: appended its line to the .jsonl, then re-rendered the whole .md from the log. The time is the window around that one append + render.', 'Average ' + fmtP(avg) + ' per test case; shortest ' + fmtP(sorted[sorted.length - 1].len) + ' (' + sorted[sorted.length - 1].id + '), longest ' + fmtP(sorted[0].len) + ' (' + sorted[0].id + ').', 'Slowest five: ' + sorted.slice(0, 5).map(x => x.id + ' ' + fmtP(x.len)).join(', ') + '.'];
  const d = repDetail('Per-test-case JSONL + Markdown writes', first, last, repTc, steps, 'Each write is charged to its own test case in the Reporting column of the Test Case Time table. The time between writes is not counted here (it is in Other / Overhead).');
  d.start = utc(first); d.end = utc(last); d.share = pct(repTc, total) + '% of total (sum of the ' + w.length + ' windows)';
  subItems.push({ name: 'Per-test-case JSONL + Markdown writes (' + tcs.length + ' test cases)', s: first, e: last, len: repTc, d });
}

// phases
const phases = []; ['Test Execution', 'Result Collection', 'Bug Reporting', 'Report Generation'].forEach(n => { const s = L.find(x => x.type === 'phase' && x.name === n && x.event === 'start'), e = [...L].reverse().find(x => x.type === 'phase' && x.name === n && x.event === 'end'); if (s && e) phases.push([n, T(s.at), T(e.at)]); });

let b = '';
b += `<a class="tb-back" href="./${slug}.html">&larr; Back to QA Execution Report</a>\n\n<div class="header">\n<h1>Execution Time Breakdown</h1>\n</div>\n\n`;
b += `<div class="meta-card dashboard-card">\n<div class="field-row">\n<div class="field"><span class="k">Total Duration</span><span class="v">${fmtS(dTot)}</span></div>\n<div class="field"><span class="k">Execution Start</span><span class="v">${utc(startMs)}</span></div>\n<div class="field"><span class="k">Execution End</span><span class="v">${utc(endMs)}</span></div>\n</div>\n</div>\n\n`;
const cats = [['exec', 'Test Case Execution', 'time-exec', dExec], ['wait', 'Waiting', 'time-wait', dWait], ['claude', 'Claude / AI Processing', 'time-claude', dClaude], ['report', 'Reporting', 'time-report', dRep], ['overhead', 'Other / Overhead', 'time-overhead', dOver]];
b += `<h2 class="section-num">1. Time Breakdown</h2>\n<div class="tb-cat-cards">\n` + cats.map(c => `<div class="tb-cat-card ${c[0]} dashboard-card"><div class="val">${fmtS(c[3])}</div><div class="pct">${pct(c[3], dTot)}%</div><div class="lbl"><span class="swatch" style="background:var(--${c[2]})"></span>${c[1]}</div></div>`).join('\n') + `\n</div>\n\n`;
b += `<div class="dashboard-card">\n<div class="tb-bars">\n` + cats.map(c => `<div class="tb-bar-row"><div class="tb-bar-label"><span class="swatch" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--${c[2]})"></span>${c[1]}</div><div class="tb-bar-track"><div class="tb-bar-fill" style="width:${pct(c[3], dTot)}%;background:var(--${c[2]})"></div></div><div class="tb-bar-value">${fmtS(c[3])} &middot; ${pct(c[3], dTot)}%</div></div>`).join('\n') + `\n</div>\n\n`;
b += Math.abs(acc - dTot) > 1 ? `<div class="tb-warning"><div class="w-title">&#9888; Time accounting discrepancy detected</div>\nTotal Duration: ${fmtS(dTot)}<br>Accounted Duration: ${fmtS(acc)}<br>Difference: ${fmtS(Math.abs(acc - dTot))}</div>\n` : `<div class="tb-reconcile">Accounted Time: <b>${fmtS(acc)}</b> &nbsp;=&nbsp; Total Duration: <b>${fmtS(dTot)}</b> &nbsp;&#10003;</div>\n`;
let ohBlock = ''; if (dOver > 0) ohBlock = `
<div class="tb-overhead-box">
<div class="oh-title">What's in Other / Overhead (${fmtS(dOver)}) &mdash; click a row for details</div>
<div class="tb-oh-rows">
` + rows.map((x, i) => { const det = { title: x.label, start: utc(x.from), end: utc(x.to), duration: fmtS(rowSecs[i]), share: pct(rowSecs[i] * 1000, dTot * 1000) + '% of total', before: x.before, after: x.after, steps: x.steps, note: x.agg ? 'Sum of many short gaps, spread between ' + hms(x.from) + ' and ' + hms(x.to) + '.' : 'Derived from the log timestamps: the time in this window is not covered by any test-case span, wait, AI operation or reporting operation.' }; return `<div class="tb-oh-row tb-oh-click" role="button" tabindex="0" data-detail="${esc(JSON.stringify(det)).replace(/"/g, '&quot;')}"><span class="oh-label">${esc(x.label)}</span><span class="oh-val">${fmtS(rowSecs[i])}</span><span class="oh-more">Details &rsaquo;</span></div>`; }).join('\n') + '\n</div>\n</div>\n';
b += `</div>\n\n`;
const te = phases.find(p => p[0] === 'Test Execution');
// Phase note (short) + one click-through popup per phase with the detail.
const PHASE_WHAT = { 'Test Execution': 'Sending the API calls and checking their responses (the test cases themselves), plus the time spent reading results and preparing the next call.', 'AI Analysis': 'Claude analysing the captured responses and composing the test case records.', 'Result Collection': 'Writing the test case records, findings and clean-up list to the log.', 'Result Collection': 'Writing each test case record, the findings and the clean-up list to the log (one JSONL append + Markdown re-render per test case).', 'Bug Reporting': 'Drafting one bug report file per defect finding.', 'Report Generation': 'Rendering the final HTML report and this Time Breakdown page.' };
const te0 = phases.find(p => p[0] === 'Test Execution');
const phaseNote = te0 ? 'Phases are wall-clock stages of the run. The <b>Test Execution</b> phase (' + fmtDur(te0[2] - te0[1]) + ') is longer than <b>Test Case Execution</b> (' + fmtS(dExec) + ', section 1) because it also contains idle time between calls. Click a phase row for the breakdown.' : '';
function idleGaps(from, to) { const out = []; let cur = from; merged.forEach(m => { if (m[1] <= from || m[0] >= to) return; if (m[0] > cur) out.push([cur, Math.min(m[0], to)]); cur = Math.max(cur, m[1]); }); if (to > cur) out.push([cur, to]); return out.filter(g => g[1] - g[0] >= 2000).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])); }
const phaseRows = phases.map((p, i) => {
  const len = p[2] - p[1], steps = [], prev = i ? phases[i - 1] : null;
  steps.push((PHASE_WHAT[p[0]] || 'A run stage.'));
  if (p[0] === 'Test Execution') {
    const callMs = merged.reduce((sum, m) => sum + Math.max(0, Math.min(m[1], p[2]) - Math.max(m[0], p[1])), 0);
    const gaps = idleGaps(p[1], p[2]), idleMs = len - callMs;
    steps.push('API calls in flight: ' + fmtDur(callMs) + ' (this is the Test Case Execution card; each call counted once).');
    steps.push('Idle inside the phase: ' + fmtDur(idleMs) + ' = phase ' + fmtDur(len) + ' minus calls ' + fmtDur(callMs) + '. It is counted as Overhead, not as test time.');
    gaps.slice(0, 8).forEach(g => steps.push('Idle ' + fmtDur(g[1] - g[0]) + ' between ' + hms(g[0]) + ' and ' + hms(g[1]) + ' (' + (merged.find(m => m[1] <= g[0] + 1000 && m[1] >= g[0] - 1000) || [0, 0, '', 'previous call'])[3] + ' finished; next call had not started).'));
    if (gaps.length > 8) steps.push('...and ' + (gaps.length - 8) + ' more idle gaps of 2s or more.');
  }
  const inside = ops.filter(o => T(o.started_at) >= p[1] - 1 && T(o.ended_at) <= p[2] + 1);
  inside.forEach(o => steps.push('Reporting step inside this phase: ' + o.operation + ' (' + fmtDur(T(o.ended_at) - T(o.started_at)) + ').'));
  if (p[0] === 'Report Generation') steps.push('Only the instants the log records as reporting count as Reporting time; the phase boundaries here are the moments the renders started and ended.');
  const gapBefore = prev ? p[1] - prev[2] : p[1] - startMs;
  const det = { title: p[0] + ' phase', start: utc(p[1]), end: utc(p[2]), duration: fmtP(len), share: pct(len, total) + '% of total', before: gapBefore >= 1000 ? 'Idle for ' + fmtDur(gapBefore) + ' ' + (prev ? 'after the ' + prev[0] + ' phase ended' : 'after the run started') + ' (no phase was running).' : (prev ? prev[0] + ' phase ended at ' + hms(prev[2]) + '.' : 'Run started at ' + hms(startMs) + '.'), after: i + 1 < phases.length ? 'Next: ' + phases[i + 1][0] + ' phase, starting ' + hms(phases[i + 1][1]) + '.' : 'Run ended at ' + hms(endMs) + '.', steps, note: 'Phase times are wall-clock; they are not the same as the five categories in section 1, and gaps between phases belong to no phase.' };
  const subs = subItems.filter(x => x.s >= p[1] - 1 && x.e <= p[2] + 1);
  const subHtml = subs.map(x => '\n<tr class="tb-oh-click tb-sub" role="button" tabindex="0" data-detail="' + dataAttr(x.d) + '"><td><span class="tb-sub-arrow">&#8627;</span>' + esc(x.name) + '</td><td>' + hms(x.s) + '</td><td>' + hms(x.e) + '</td><td class="num">' + fmtP(x.len) + '</td><td class="num">' + pct(x.len, total) + '%</td><td class="oh-more">Details &rsaquo;</td></tr>').join('');
  return '<tr class="tb-oh-click" role="button" tabindex="0" data-detail="' + esc(JSON.stringify(det)).replace(/"/g, '&quot;') + '"><td>' + p[0] + '</td><td>' + hms(p[1]) + '</td><td>' + hms(p[2]) + '</td><td class="num">' + fmtP(len) + '</td><td class="num">' + pct(len, total) + '%</td><td class="oh-more">Details &rsaquo;</td></tr>' + subHtml;
}).join('\n');

b += `<h2 class="section-num">2. Execution Phases</h2>
${te0 ? `<div class="tb-phase-note">${phaseNote}</div>
` : ''}<div class="dashboard-card tb-table-wrap">
<table class="tb-table">
<thead><tr><th>Phase</th><th>Start</th><th>End</th><th class="num">Duration</th><th class="num">%</th><th></th></tr></thead>
<tbody>
${phaseRows}
</tbody>
<tfoot><tr><td colspan="3"><b>Total Reporting Time</b> <span class="tb-foot-note">(sum of the &#8627; rows above)</span></td><td class="num"><b>${fmtP(report)}</b></td><td colspan="2" class="num"><span class="tb-foot-note">card: ${fmtS(dRep)} rounded</span></td></tr></tfoot>
</table>
</div>

`;
const ai = L.filter(x => x.type === 'ai_operation');
// AI operations: each row opens the shared popup (#tbModal). Steps come from an ai_operation_detail line (same operation name) if the log has one.
const aiDetail = op => [...L].reverse().find(x => x.type === 'ai_operation_detail' && x.operation === op);
const aiRows = ai.map(a => { const len = T(a.ended_at) - T(a.started_at); const d = aiDetail(a.operation); const ids = a.related_tc_ids || (a.related_tc_id ? [a.related_tc_id] : null);
  const steps = d ? d.steps : ['No notes were recorded for this operation. It is Claude work outside any single test case (analysis of results, composing records, spec reasoning), measured from the timestamps below.'];
  const prevEv = [...L].filter(x => x.type === 'phase' && T(x.at) <= T(a.started_at)).pop(), nextEv = L.filter(x => x.type === 'phase' && T(x.at) >= T(a.ended_at))[0];
  const det = { title: a.operation, start: utc(T(a.started_at)), end: utc(T(a.ended_at)), duration: fmtP(len), share: pct(len, total) + '% of total', before: 'Right before: ' + (prevEv ? 'Phase "' + prevEv.name + '" ' + (prevEv.event === 'start' ? 'started' : 'ended') + ' at ' + hms(T(prevEv.at)) : 'run start') + '.', after: 'Right after: ' + (nextEv ? 'Phase "' + nextEv.name + '" ' + (nextEv.event === 'start' ? 'started' : 'ended') + ' at ' + hms(T(nextEv.at)) : 'run end') + '.', steps, note: 'Counted as Claude / AI Processing, outside any test case\'s API-call time. In the Test Case Time table this ' + fmtP(len) + ' is split evenly across ' + (ids ? ids.length + ' test case(s)' : 'all ' + tcs.length + ' test cases') + ' (' + fmtP(len / (ids ? ids.length : tcs.length)) + ' each); that split is an allocation, not a per-test-case measurement.' };
  return '<tr class="tb-oh-click" role="button" tabindex="0" data-detail="' + esc(JSON.stringify(det)).replace(/"/g, '&quot;') + '"><td>' + esc(a.operation) + '</td><td>' + (ids ? ids.join(', ') : '') + '</td><td>' + hms(T(a.started_at)) + '</td><td>' + hms(T(a.ended_at)) + '</td><td class="num">' + fmtP(len) + '</td><td class="oh-more">Details &rsaquo;</td></tr>'; }).join('');
b += `<h2 class="section-num">3. Claude / AI Operations</h2>\n<div class="dashboard-card tb-table-wrap">\n${ai.length ? `<table class="tb-table">\n<thead><tr><th>Operation</th><th>Related TC</th><th>Start</th><th>End</th><th class="num">Duration</th><th></th></tr></thead>\n<tbody>${aiRows}</tbody>\n</table>` : '<div class="empty">No AI operations recorded for this run.</div>'}\n</div>\n\n`;

// per-TC rows
const slugCat = c => String(c || '').toLowerCase().replace(/[^a-z]+/g, '-');
const catList = []; tcs.forEach(t => { if (t.category && !catList.includes(t.category)) catList.push(t.category); });
const opShare = (tcId) => ops.reduce((s, o) => { const ids = o.related_tc_ids || (o.operation === 'Bug Report Generation' ? defectTcs : null); if (ids && ids.includes(tcId)) return s + (T(o.ended_at) - T(o.started_at)) / ids.length; return s; }, 0);
const aiOps = L.filter(x => x.type === 'ai_operation');
const claudeShare = id => aiOps.reduce((sum, a) => { const ids = a.related_tc_ids || (a.related_tc_id ? [a.related_tc_id] : tcs.map(t => t.tc_id)); return ids.includes(id) ? sum + (T(a.ended_at) - T(a.started_at)) / ids.length : sum; }, 0);
let sumExecRows = 0, sumRepRows = 0, sumClaudeRows = 0;
const trs = tcs.map((t, i) => {
  const e = (execShare[t.tc_id] || 0) / 1000; sumExecRows += e;
  const rp = ((t.reporting_started_at && t.reporting_ended_at) ? (T(t.reporting_ended_at) - T(t.reporting_started_at)) : 0) + opShare(t.tc_id); sumRepRows += rp / 1000;
  const w = (t.waiting_ms || 0) / 1000, cl = claudeShare(t.tc_id) / 1000; sumClaudeRows += cl; const tot = e + w + cl + rp / 1000;
  const title = t.title.replace(/^\[[^\]]*\]\[[^\]]*\]\s*/, '');
  return `<tr data-tcid="${t.tc_id}" data-title="${esc(title)}" data-status="${t.verdict}" data-cat="${slugCat(t.category)}">\n<td data-sort-v="${i + 1}">${i + 1}</td>\n<td>${t.tc_id}</td>\n<td>${esc(title)}</td>\n<td><span class="badge ${t.verdict}">${t.verdict}</span></td>\n<td data-sort-v="${T(t.started_at)}">${hms(T(t.started_at))}</td>\n<td data-sort-v="${T(t.timestamp)}">${t.timing === 'partial' ? '<span class="timing-partial">Timing: Partial</span>' : hms(T(t.timestamp))}</td>\n<td class="num" data-sort-v="${Math.round(e * 1000)}">${fmtP(e * 1000)}</td>\n<td class="num" data-sort-v="${Math.round(w * 1000)}">${fmtP(w * 1000)}</td>\n<td class="num" data-sort-v="${Math.round(cl * 1000)}">${fmtP(cl * 1000)}</td>\n<td class="num" data-sort-v="${Math.round(rp)}">${fmtP(rp)}</td>\n<td class="num" data-sort-v="${Math.round(tot * 1000)}">${fmtP(tot * 1000)}</td>\n</tr>`;
}).join('\n');
const overlap = sumExecRows - exec / 1000;
b += `<h2 class="section-num">4. Test Case Time</h2>\n<div class="tc-toolbar dashboard-card">\n<input type="search" id="tcbSearch" placeholder="Search test case ID or title...">\n<select id="tcbStatusFilter">\n<option value="">All statuses</option>\n<option value="PASS">Passed</option>\n<option value="FAIL">Failed</option>\n<option value="BLOCKED">Blocked</option>\n</select>\n<select id="tcbCategoryFilter">\n<option value="">All categories</option>\n${catList.map(c => `<option value="${slugCat(c)}">${esc(c)}</option>`).join('\n')}\n</select>\n<button type="button" id="tcbReset">Reset</button>\n<span class="tc-count" id="tcbCount">${tcs.length} / ${tcs.length} shown</span>\n</div>\n<div class="tb-no-results js-hidden" id="tcbNoResults">No test cases match the current search/filter.</div>\n<div class="dashboard-card tb-table-wrap">\n<table class="tcb-table" id="tcbTable">\n<thead><tr>\n<th data-sort="idx" data-type="num">#</th>\n<th data-sort="tcid" data-type="text">Test Case ID</th>\n<th data-sort="title" data-type="text">Test Case</th>\n<th data-sort="status" data-type="text">Status</th>\n<th data-sort="start" data-type="num">Start</th>\n<th data-sort="end" data-type="num">End</th>\n<th data-sort="exec" data-type="num" class="num">Execution</th>\n<th data-sort="wait" data-type="num" class="num">Waiting</th>\n<th data-sort="claude" data-type="num" class="num">Claude</th>\n<th data-sort="report" data-type="num" class="num">Reporting</th>\n<th data-sort="total" data-type="num" class="num">Total</th>\n</tr></thead>\n<tbody>\n${trs}\n</tbody>\n</table>\n</div>\n`;
const runLevel = ops.filter(o => !o.related_tc_ids && o.operation !== 'Bug Report Generation').reduce((s, o) => s + (T(o.ended_at) - T(o.started_at)), 0);
b += `<div class="tb-reconcile">Execution column: rows sum to ${fmtDur(sumExecRows * 1000)} = ${fmtS(dExec)} Test Case Execution (section 1). Each test case is charged only for the time its own API calls were in flight; a call shared by several test cases is split evenly between them, so nothing is counted twice and idle gaps between calls are not charged. Claude column: the run-level analysis (${fmtP(claude)}) split evenly across the ${tcs.length} test cases, rows sum to ${fmtP(sumClaudeRows * 1000)}. Reporting column: rows sum to ${fmtP(sumRepRows * 1000)}, plus ${fmtP(runLevel)} of run-level reporting (final HTML and Time Breakdown, not attributable to one test case), = ${fmtS(dRep)} Reporting (section 1).</div>\n\n`;

// timeline
const tl = []; L.filter(x => x.type === 'phase').forEach(p => { if (p.name === 'Initialization') return; tl.push([T(p.at), `<b>${p.name}</b> ${p.event === 'start' ? 'started' : 'ended'}`]); }); tcs.forEach(t => tl.push([T(t.started_at), `${t.tc_id} started`])); tl.sort((a, c) => a[0] - c[0]); tl.push([endMs, 'Execution completed']);
b += `<h2 class="section-num">5. Timeline</h2>\n<div class="dashboard-card">\n<div class="tb-timeline">\n${tl.map(x => `<div class="tb-tl-row"><div class="tb-tl-time">${hms(x[0])}</div><div class="tb-tl-label">${x[1]}</div></div>`).join('\n')}\n</div>\n</div>\n\n`;
if (ohBlock) b += '<h2 class="section-num">6. Other / Overhead</h2>\n<div class="dashboard-card">' + ohBlock + '</div>\n\n';
b = b.replace(/<h2 class="section-num">([2-6]\. [^<]*)<\/h2>([\s\S]*?)(?=<h2 class="section-num">|$)/g, (m, title, body) => '<details class="tb-sec" open><summary>' + title + '</summary>' + body + '</details>\n');
b = b.replace('<details class="tb-sec" open>', '<div class="tc-actions">\n<button type="button" id="tbExpandAll">Expand all</button>\n<button type="button" id="tbCollapseAll">Collapse all</button>\n</div>\n<details class="tb-sec" open>');
fs.writeFileSync(path.join(dir, slug + '_TimeBreakdown.html'), head + b + script, 'utf8');
console.log(JSON.stringify({ total: dTot, exec: dExec, rep: dRep, over: dOver, acc, rows: rows.length, rowSum: rowSecs.reduce((a, b) => a + b, 0), overlap: Math.round(overlap) }));
