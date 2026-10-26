// Gives every evidence file (screenshot / video) a clear, descriptive name and label, and names the bug on failed cases.
// Usage: node scripts/name-evidence.js <slug>     (QA_LOG_DIR = the project's Logs folder, like the renderers)
//
//   PASS : <TC-ID>_<what-was-checked>_PASS.png
//   FAIL : <TC-ID>_<what-was-checked>_FAIL_<BUG-ID>_<bug-name>.png      (+ "_video" before .webm for the video)
//
// <bug-name> is the suffix of the bug report file (BugReports/<slug>/BUG-01_<bug-name>.md) when one exists,
// otherwise the defect finding's field_name. Run it after the defects are logged (and bug reports written) and
// before render-html.js. It is idempotent. It rewrites screenshot path/label fields in the .jsonl in place and
// the evidence links in the bug reports - the only edit this skill makes to an existing log, because the file
// names are not known until the defect is triaged. Also exports nameFor() for producers that name files at capture.
const fs = require('fs'), path = require('path');

const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
// "[Login][Positive] Verify a registered user can log in ..." -> "a registered user can log in ..."
const shortTitle = t => String(t || '').replace(/^(\s*\[[^\]]*\])+\s*/, '').replace(/^verify\s+(that\s+)?/i, '').replace(/[.\s]+$/, '');
// Windows refuses (and Chrome shows ERR_FILE_NOT_FOUND for) file:// paths over 260 characters, and the report sits deep
// in the repo + <slug>_evidence/, so a file name over ~100 characters makes its link dead. Keep names short.
const MAX_NAME = 96;
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'or', 'and', 'of', 'in', 'to', 'with', 'by', 'on', 'for', 'not']);
const slugOf = (t, max = 70) => { const out = []; let len = 0; for (const w of words(shortTitle(t))) { if (len + w.length + 1 > max) break; out.push(w); len += w.length + 1; } while (out.length > 1 && STOP.has(out[out.length - 1])) out.pop(); return out.join('-') || 'test-case'; };
const humanBug = n => n.replace(/^BUG-\d+_?/i, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

// tc: test_case line; shot: {path,label,...}; bug: {id, name} | null  ->  { file, label }
function nameFor(tc, shot, bug) {
  const ext = path.extname(shot.path || '').toLowerCase(), isVideo = /\.(webm|mp4|mov)$/.test(ext);
  const verdict = tc.verdict || 'PASS', what = shortTitle(tc.title);
  let tail = `_${verdict}`, label = `${tc.tc_id} - ${what} - ${verdict}`;
  if (bug) { tail += `_${bug.id}_${bug.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32)}`; label += ` - ${bug.id} ${humanBug(bug.name)}`; }
  tail += (isVideo ? '_video' : '') + ext;
  if (verdict === 'PASS') label += isVideo ? ' (video)' : ' (final screen)';
  else label += isVideo ? ' (video of the failing run)' : ' (screen when the check failed)';
  // the what-was-checked part takes whatever the name budget leaves, so the whole file name stays <= MAX_NAME
  return { file: `${tc.tc_id}_${slugOf(tc.title, Math.max(16, MAX_NAME - tc.tc_id.length - tail.length - 2))}${tail}`, label };
}

function run(slug, logDir) {
  const jsonl = path.join(logDir, slug + '.jsonl');
  const L = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const bugDir = path.join(logDir, '..', 'BugReports', slug);
  const bugFiles = fs.existsSync(bugDir) ? fs.readdirSync(bugDir) : [];
  const bugFor = tcId => {
    const f = L.find(x => x.type === 'finding' && x.kind === 'defect' && x.related_tc_id === tcId && x.bug_id);
    if (!f) return null;
    const file = bugFiles.find(n => n.startsWith(f.bug_id + '_') && n.endsWith('.md'));
    return { id: f.bug_id, name: file ? file.slice(f.bug_id.length + 1, -3) : f.field_name || 'defect' };
  };
  const renamed = []; // [oldRel, newRel]
  const fix = (tc, list) => (list || []).forEach(s => {
    if (!s || !s.path) return;
    const bug = tc.verdict === 'PASS' ? null : bugFor(tc.tc_id), n = nameFor(tc, s, bug);
    const dir = path.dirname(s.path), next = (dir === '.' ? '' : dir + '/') + n.file;
    if (next !== s.path) {
      const from = path.join(logDir, s.path), to = path.join(logDir, next);
      if (fs.existsSync(from)) { fs.renameSync(from, to); renamed.push([s.path, next]); }
      else if (!fs.existsSync(to)) { console.warn(`name-evidence: ${s.path} is missing - left as is`); return; }
      s.path = next;
    }
    const abs = path.resolve(logDir, s.path).length;
    if (abs > 250) console.warn(`name-evidence: ${abs}-character path (Windows limit 260, the link may not open): ${s.path}`);
    s.label = n.label;
  });
  L.filter(x => x.type === 'test_case').forEach(tc => [tc].concat(tc.hops || [], tc.attempts || []).forEach(c => fix(tc, c.screenshots)));
  L.filter(x => x.type === 'finding' && x.screenshots).forEach(f => { const tc = L.find(x => x.type === 'test_case' && x.tc_id === f.related_tc_id); if (tc) fix(tc, f.screenshots); });
  fs.writeFileSync(jsonl, L.map(x => JSON.stringify(x)).join('\n') + '\n');
  // keep the bug reports' evidence links working
  bugFiles.filter(n => n.endsWith('.md')).forEach(n => {
    const p = path.join(bugDir, n); let t = fs.readFileSync(p, 'utf8'); const before = t;
    renamed.forEach(([a, b]) => { t = t.split(path.basename(a)).join(path.basename(b)); });
    if (t !== before) fs.writeFileSync(p, t);
  });
  return renamed.length;
}

module.exports = { nameFor, shortTitle, slugOf };
if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) throw new Error('usage: node name-evidence.js <slug>');
  const repo = path.resolve(__dirname, '../../../..');
  const dir = process.env.QA_LOG_DIR ? path.resolve(process.env.QA_LOG_DIR) : repo + '/NDC_Integration/Artifacts/Logs';
  console.log(`name-evidence: ${run(slug, dir)} file(s) renamed`);
}
