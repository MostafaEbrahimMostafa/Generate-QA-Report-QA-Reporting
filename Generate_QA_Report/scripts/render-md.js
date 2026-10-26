// Re-renders the run's .md from its .jsonl (pure function of the JSONL). Usage: node render-md.js <slug>
const fs = require('fs'), path = require('path');
const slug = process.argv[2];
const dir = process.env.QA_LOG_DIR ? path.resolve(process.env.QA_LOG_DIR) : path.resolve(__dirname, '../../../..', 'NDC_Integration/Artifacts/Logs'); // QA_LOG_DIR: another project's Logs folder
const L = fs.readFileSync(path.join(dir, slug + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rs = L.find(x => x.type === 'run_start'), re = L.find(x => x.type === 'run_end');
const tcs = L.map(x => x).filter(x => x.type === 'test_case');
const PTM = require('./project-type'), PT = PTM.classify(L), { evidenceShots, shotList } = PTM;
PT.mismatches.forEach(m => console.warn(`WARNING type mismatch: ${m.tc_id} declared ${m.declared}, data says ${m.detected} - rendered as ${m.detected}`));
const cnt = v => tcs.filter(t => t.verdict === v).length;
const tsAll = [];
L.forEach(x => ['started_at','ended_at','at','reporting_ended_at','timestamp'].forEach(k => { if (x[k]) tsAll.push(Date.parse(x[k])); }));
const maxTs = Math.max(...tsAll);
const fmtDur = ms => { const s = Math.round(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + r + 's'; };
const ended = re ? new Date(maxTs).toISOString() : null;
let o = [];
const ids = tcs.map(t => t.tc_id).join(', ');
o.push(`# QA Execution Report — ${rs.title_line || ('SeatMap_TestCases.csv (NDC_Integration/TestCases/SeatMap_TestCases.csv) — ' + rs.total_test_cases_planned + ' test cases: ' + (ids || 'in progress'))}`, '');
o.push(`**Environment:** ${rs.environment_text || 'staging'} &middot; ${rs.baseUrl}`, ...(rs.supplier === false ? [] : [`**Supplier:** ${rs.supplier}  **Credentials Selector:** ${rs.credentials_selector}`]), `**Started:** ${rs.started_at}`, `**Project Type:** ${PT.label}`);
PT.mismatches.forEach(m => o.push(`**WARNING type mismatch:** ${m.tc_id} declared ${m.declared}, data says ${m.detected} (rendered as ${m.detected})`));
if (re) { o.push(`**Ended:** ${ended}`, `**Status:** ${re.status === 'complete' ? 'COMPLETE' : 'INTERRUPTED (after ' + re.interrupted_after_tc + ')'}`);
  if (L.some(x => x.type === 'reporting_op' && /Time Breakdown/.test(x.operation))) o.push(`**Execution Duration:** ${fmtDur(maxTs - Date.parse(rs.started_at))} ([View Time Breakdown](${slug}_TimeBreakdown.html))`);
} else o.push('**Status:** RUNNING');
o.push('**Prior runs:** ' + (rs.prior_runs || 'see NDC_Integration/Artifacts/Logs/') + ' (see NDC_Integration/Artifacts/Logs/)', '');
const sn = L.find(x => x.type === 'scope_note'); if (sn) { o.push('## Scope note', '', sn.text, ''); }
o.push('## Summary', '', `- Test cases logged: ${tcs.length} of ${rs.total_test_cases_planned} planned`, `- Passed: ${cnt('PASS')}`, `- Failed: ${cnt('FAIL')}`, `- Blocked: ${cnt('BLOCKED')}`);
const fl = tcs.filter(t => t.verdict === 'FAIL').map(t => t.tc_id); if (fl.length) o.push(`- Failed test cases: ${fl.join(', ')}`);
const bl = tcs.filter(t => t.verdict === 'BLOCKED').map(t => t.tc_id); if (bl.length) o.push(`- Blocked test cases: ${bl.join(', ')}`);
o.push('', '## Test case results', '');
for (const t of tcs) {
  const ui = PT.kinds[t.tc_id] === 'ui';
  const L3 = ui ? ['Feature', 'Steps performed', 'Observed'] : ['Endpoint Name', 'Request', 'Response'];
  const shots = ui ? [t].concat(t.attempts || []).map(c => evidenceShots(shotList(c), t.verdict)).reduce((a, b) => a.concat(b), []).map(s => `[${esc(s.label || s.path)}](${s.path})`).join(', ') : '';
  o.push(`### ${t.tc_id} — ${t.verdict}`, '', `- **Test Case:** ${esc(t.title)}`, `- **Category:** ${esc(t.category)}`, `- **${L3[0]}:** ${esc(t.endpoint_or_flow)}`, `- **${L3[1]}:** ${esc(t.request_summary)}`, `- **${L3[2]}:** ${esc(t.response_summary)}`, `- **Expected:** ${esc(t.expected)}`, `- **Actual:** ${esc(t.actual)}`, `- **Status:** ${t.verdict}`, `- **Evidence:** ${esc(t.evidence)}${shots ? ' ' + shots : ''}`, '');
  if (t.hops) t.hops.forEach(h => o.push(ui ? `  - **Step ${h.hop} &mdash; ${esc(h.step || h.endpoint)}:** ${h.verdict} &mdash; ${esc(h.observed || h.actual)}` : `  - **Hop ${h.hop} &mdash; ${esc(h.endpoint)}:** ${h.verdict} &mdash; ${esc(h.response_summary)}`));
  if (t.attempts && !ui) t.attempts.forEach(a => o.push(`  - **${esc(a.label)}:** HTTP ${a.response_full.status}`));
  if (t.hops || t.attempts) o.push('');
}
const fd = L.filter(x => x.type === 'finding');
o.push('## Findings', '');
if (!fd.length) o.push('No findings logged yet.', '');
else {
  const defs = fd.filter(f => f.kind === 'defect'), unk = fd.filter(f => f.kind === 'unknown_resolution'), rec = fd.filter(f => f.kind === 'reconfirmed');
  if (defs.length) { o.push('### Defects', ''); defs.forEach(f => o.push(`- **[${f.related_tc_id}] ${f.bug_id ? f.bug_id + (f.occurrence ? ` (occurrence ${f.occurrence}, not new)` : ' (new)') + ' &mdash; ' : ''}${esc(f.summary)}** Field: \`${esc(f.field_name)}\`. Expected: ${esc(f.expected_value)}. ${f.history ? '**History:** ' + esc(f.history) + ' ' : ''}**Impact:** ${esc(f.impact)} Evidence: ${esc(f.evidence)}`)); o.push(''); }
  if (unk.length) { o.push('### Unknown-resolutions', ''); unk.forEach(f => o.push(`- **[${f.related_tc_id}]** ${esc(f.summary)} Evidence: ${esc(f.evidence)}`)); o.push(''); }
  if (rec.length) { o.push('### Also re-confirmed', ''); rec.forEach(f => o.push(`- **[${f.related_tc_id}] ${f.bug_id}** &mdash; ${esc(f.summary)}`)); o.push(''); }
  const nr = L.filter(x => x.type === 'not_reproduced'); if (nr.length) { o.push('### Not reproduced', ''); nr.forEach(n => o.push(`- **${n.bug_id}** (${esc(n.short_name)}) &mdash; exercised by ${n.related_tc_ids.join(', ')}. ${esc(n.note)}`)); o.push(''); }
}
o.push('## Proposed SPEC.md updates', '');
const sp = L.filter(x => x.type === 'spec_update_proposed'); if (!sp.length) o.push('No SPEC.md updates proposed this round (Round 11\'s pending proposals are unchanged).', '');
sp.forEach(s => o.push(`- ${s.section} &mdash; status: *${s.status}*`, `  - **Old:** "${esc(s.old_text)}"`, `  - **New:** "${esc(s.new_text)}"`, ...(s.note ? [`  - **Correction:** ${esc(s.note)}`] : []), ''));
o.push('## Cleanup / follow-up', '');
const cl = L.filter(x => x.type === 'cleanup'); if (!cl.length) o.push('Nothing left needing cleanup.', '');
else { o.push(`Live artifacts left behind this round (${cl.length}):`, ''); cl.forEach(c => o.push(`- **${c.kind}** &mdash; pnr ${c.pnr} (${c.related_tc_id}) &mdash; ${esc(c.note)}`)); o.push(''); }
fs.writeFileSync(path.join(dir, slug + '.md'), o.join('\n') + '\n', 'utf8');
