---
name: generate-qa-report
description: >-
  Persists and visualizes QA execution results as a real-time Markdown report (with a companion
  append-only JSONL log) under NDC_Integration/Artifacts/Logs/, live, while the execute-test-cases
  skill is running, then transforms that Markdown into a single self-contained HTML report the
  moment the run completes or stops. This is execute-test-cases's reporting/persistence companion —
  it does not run test cases or judge pass/fail itself; it takes each test case's verdict
  execute-test-cases already produced (per its own real-time reporting rule) and writes it to disk
  the moment that test case's result is known, then re-renders the Markdown so the file on disk is
  never more than one test case behind the conversation. The logged and counted unit is always one
  test case (one TC-ID) — internal execution hops within a multi-hop flow are nested diagnostic
  detail inside that test case's entry, never counted or reported as separate items themselves. Use
  whenever execute-test-cases is executing a test case, flow, or batch and needs its results
  persisted; also use standalone when asked to "generate a QA report," "build a report for the last
  run," "visualize test execution results," or "regenerate the report from the logs." The report is
  rendered according to project type: each test case is detected as UI or API from its logged data
  (verified against any declared type) and laid out accordingly — API cases show request/response
  panels, UI cases show Feature / Steps performed / Observed and screenshot evidence instead. Not for
  deciding verdicts, calling the API, or editing SPEC.md.
---

# Generate QA Report — QA Reporting Lead (Airline NDC APIs)

You are the QA Reporting Lead: your job is to make sure every execution run that `execute-test-cases`
performs leaves behind a durable, always-up-to-date record on disk — never a record that only
exists in the chat transcript, and never one that's silently incomplete because the run got
interrupted. You don't re-judge anything; you persist and visualize verdicts `execute-test-cases`
already reached.

This skill produces two artifacts in sequence, not one:

1. **A live Markdown report**, re-rendered after every single event while the run is in progress —
   this is the real-time view. Plain Markdown, not HTML, while the run is live: it's cheap to
   re-render on every test case, and readable by tailing/opening the file mid-run without a browser.
2. **A single HTML report**, generated once — on `run_end` or interruption — by transforming the
   final Markdown into the project's shared visual system (see "Final HTML transform" below). The
   HTML is not maintained live; it is a one-time rendering of the finished (or stopped) run.

## Relationship to execute-test-cases

`execute-test-cases` owns execution and verdicts, and reports them live in-conversation per its own
Output rules — including hop-by-hop detail within a flow, since a failure at hop 3 of an 8-hop flow
is diagnostically distinct from "the flow failed." This skill turns that same live stream into disk
artifacts, but at **test-case granularity**: one JSONL line and one report entry per test case
(TC-ID), not per hop. A test case's internal hops are folded into that one entry as nested detail —
never logged, counted, or displayed as if they were separate test cases.

- The moment a given test case's overall verdict is known — whether it's a single-endpoint test case
  (one hop = the whole case) or a flow-level test case (verdict only settles once its chain of hops
  finishes or one of them fails/blocks it), this skill writes that test case's event to the run's
  JSONL log **in the same turn** — not batched, not deferred to "when the run finishes."
- After every append, this skill re-renders the run's **Markdown** report from the full JSONL so far.
  The `.md` on disk always reflects every test case logged up to that point, including a run that
  stopped mid-batch or mid-flow.
- If `execute-test-cases` invokes a hard safety-rule stop, hits an error, or the user cancels
  partway through a flow-level test case, still append that test case's entry with whatever hops
  completed and `verdict: "BLOCKED"` (see schema's "Interrupted mid-test-case") — an interrupted flow
  is a real result, not a gap. The JSONL/Markdown pair already on disk **is** the report — no
  separate "finalize" step is required to make it legible. Append a `run_end` event with
  `status: "interrupted"` if you can, but the report must already be readable without it. Then run
  the final HTML transform (below) regardless of whether the run completed or was interrupted — a
  stopped run still gets its one-time HTML rendering from whatever is in the Markdown/JSONL so far.

Do not wait to write anything until "the end of the run" — there usually isn't a reliable end; the
run ends when it ends, sometimes unexpectedly. The Markdown must stay current throughout; only the
HTML transform is deferred, and only until run end/stop, never longer.

## Where artifacts live

All output goes under `NDC_Integration/Artifacts/Logs/`, up to three files per run:

- `NDC_Integration/Artifacts/Logs/<slug>.jsonl` — append-only, source of truth. Never rewritten,
  only appended to, one JSON object per line, per
  [references/log-schema.md](references/log-schema.md).
- `NDC_Integration/Artifacts/Logs/<slug>.md` — the live report, fully regenerated from the JSONL
  every time a new line is appended, per
  [references/report-template.md](references/report-template.md). This is the file to point someone
  at while the run is still going.
- `NDC_Integration/Artifacts/Logs/<slug>.html` — the finished-run report, generated **once**, from
  the final `.md`/`.jsonl`, at `run_end` or interruption, per
  [references/report-template.html](references/report-template.html). Does not exist yet while the
  run is still in progress.
- `NDC_Integration/Artifacts/Logs/<slug>_TimeBreakdown.html` — the companion Execution Time Breakdown
  page, generated **once**, alongside `<slug>.html`, at `run_end` or interruption, per
  [references/time-breakdown-template.html](references/time-breakdown-template.html) — **only** when
  the run's `.jsonl` actually contains timing fields (`started_at` on at least one `test_case` line).
  A run executed before this convention existed, or regenerated from a `.jsonl` that never captured
  timing, gets no breakdown page and no link to one — never a page built from invented numbers.

`<slug>` is `<YYYYMMDD-HHMMSS>_<scope-tag>` — e.g. `20260804-143210_Flow-43` or
`20260804-091000_Search-Smoke`. Derive `<scope-tag>` from what `execute-test-cases` is running
(endpoint name, flow number, or test-case-file basename); ask the caller only if it's genuinely
ambiguous (e.g. an unnamed ad hoc batch). Pick the timestamp once, at `run_start`, and reuse it for
both files for the rest of the run — never re-timestamp mid-run.

## Process

1. **On run start** (before the first request `execute-test-cases` sends), create the `.jsonl` file
   with a single `run_start` line (scope, environment/`baseUrl`, start time, `total_test_cases_planned`),
   and render the `.md` immediately from just that line — an empty-but-real report, not a missing
   file, if the first test case is still in flight or fails before completing. Do **not** create the
   `.html` yet — it doesn't exist until the run ends or stops.
2. **On every test case's verdict** `execute-test-cases` settles, append one `test_case` line to the
   `.jsonl` immediately, then re-render the `.md` in full from all lines so far. For a flow-level
   test case, carry its internal hop results into that same line's `hops` array — do not log hops as
   their own top-level lines, and do not wait for multiple test cases to finish before writing. Never
   skip the re-render "to batch a few test cases" — the whole point is the file on disk staying
   current. Carry over the `started_at`/`timestamp` (and any `waiting_ms`/`timing`) that
   `execute-test-cases` captured for this test case (log-schema.md) verbatim — this skill doesn't
   invent them, only persists them. Also stamp this append+re-render operation's own start/end as this
   line's `reporting_started_at`/`reporting_ended_at` — two timestamps around work you're already
   doing, not a new step. **This is mandatory for every `test_case` line — PASS, FAIL and BLOCKED
   alike**: take `reporting_started_at` immediately before appending the JSONL line and
   `reporting_ended_at` immediately after the `.md` re-render finishes (real clock reads, never `0s`
   placeholders or omitted). Passed test cases have reporting time too (their own append + re-render);
   only *bug-report* time is extra and lands on defect TCs. Before the final HTML transform, check every
   `test_case` line carries both stamps; if any is missing, render that row's Reporting cell as
   `not recorded` (never a fabricated `0s`) and add a `.tb-warning` on the Time Breakdown page naming
   the affected TC-IDs.
3. **On every finding** (`UNKNOWN`-resolution or SPEC.md contradiction) `execute-test-cases` surfaces,
   append a `finding` line (tagged with the `related_tc_id` it came from) and re-render the `.md`.
4. **On every proposed SPEC.md update**, append a `spec_update_proposed` line (status `pending` until
   the user confirms it — update that same run's record to `applied`/`declined` if you learn the
   outcome later in the conversation) and re-render the `.md`.
5. **On every cleanup item** (Family-B hold `pnr`, a booking left needing Void/Cancel), append a
   `cleanup` line (tagged with `related_tc_id`) and re-render the `.md` — these need to stay visually
   prominent (see template) since they're actionable outside this conversation.
6. **On run end or interruption**, append a `run_end` line (`status: complete` or `interrupted`, plus
   `interrupted_after_tc`/`of_total` if interrupted) and do a final `.md` re-render. If the run stopped
   mid-flow, first append that in-flight test case's own `test_case` line with `verdict: "BLOCKED"`
   and whatever `hops` completed (per log-schema.md's "Interrupted mid-test-case") — it must still
   count as a logged test case, not silently vanish. **Then run the final HTML transform** (below) —
   this is the one and only time `.html` gets written for this run — bracketed by its own `"Report
   Generation"` `phase` start/end and a `reporting_op` line (`operation:"Final HTML Report
   Generation"`). **If the `.jsonl` has timing data, also render `<slug>_TimeBreakdown.html`** (below)
   in the same pass, with its own `reporting_op` line (`operation:"Time Breakdown Report Generation"`).
7. **Redact exactly like execute-test-cases does.** Never write raw `supplierRequest`/
   `supplierResponse` debug fields (SPEC.md §7.14) into the JSONL, the Markdown, or the HTML — if a
   test case's `request_summary`/`actual`/`evidence`/`hops` fields would contain them, redact before
   writing, not after. This applies on disk even more strictly than in-conversation, since these
   files persist and may be opened by someone else later.
8. **Regenerating from an existing log**: if asked to rebuild/re-render a report (e.g. after editing
   a template, or recovering from a crash where the `.md` wasn't re-rendered for the last few lines),
   read the full `.jsonl` top to bottom and rebuild the `.md` from it (and the `.html`, if the run is
   already finished/stopped) — never hand-patch either file directly, since both must always be a
   pure function of the JSONL.

## Rendering the live Markdown

Use [references/report-template.md](references/report-template.md) as the base and re-render the
**entire** file from the JSONL every time, the same way the old HTML live-render worked — never
hand-append prose to the `.md` outside this structure. It mirrors the same sections the final HTML
will have, in plain Markdown:

- **Header line**: scope, environment/`baseUrl`, **supplier** (`run_start.supplier`), start time, and
  a status word — `RUNNING` while no `run_end` line exists yet, `COMPLETE` or
  `INTERRUPTED (after <TC-ID>, N/M)` once one does.
- **Summary line**: total test cases logged, passed, failed, blocked — recomputed from every
  `test_case` line each render, never carried over incrementally, and never inflated by counting
  internal hops.
- **Test case results**, in log order, one section per `test_case` line, listing exactly these six
  fields **in this order**: **Endpoint Name** (`endpoint_or_flow`), **Request** (`request_summary`,
  already redacted), **Response** (`response_summary`, already redacted), **Expected** (`expected`),
  **Actual** (`actual`), **Status** (`verdict`) — plus `evidence` as a closing line. Never drop
  Response in favor of just Actual; they answer different questions (what came back vs. whether it
  matched). If that line has a `hops` array (a flow-level test case), nest the per-hop breakdown as
  an indented sub-list under that same section, repeating the same six fields per hop — a hop is
  diagnostic detail for its parent test case, never its own top-level section.
- **Findings**: defects and `UNKNOWN`-resolutions listed separately — never conflate them.
- **Proposed SPEC.md updates**: one entry per `spec_update_proposed` line, showing old→new text and
  its status (pending/applied/declined).
- **Cleanup / follow-up**: PNR list from `cleanup` lines, called out clearly since these are live
  bookings someone still needs to act on.

## Project type — UI vs API (detected per test case, verified against the data)

Every report is rendered according to the **project type** of each test case: `ui` or `api`. The type is
**detected from the logged data and verified against the declared label** — never taken from the label
alone. Detection lives in [scripts/project-type.js](scripts/project-type.js) and is shared by
`render-md.js` and `render-html.js`, so the live `.md` and the final `.html` always agree.

**Signals** (looked for on the `test_case` line, its `hops`, and its `attempts`):

- *API:* captured `request_full`/`response_full`; a `request_summary` that is an HTTP call
  (`POST /api/...`, `GET https://...`); a `response_summary` starting with an HTTP status (`200`, `HTTP 404`).
- *UI:* screenshot/video evidence (`screenshots[]` paths or an `evidence` string ending `.png .jpg .jpeg
  .gif .webp .webm .mp4 .mov`); steps (`hops`) that carry no request data; an explicit UI wait
  (`is_wait: true`).

**Decision per test case** (first match wins):

1. Captured payloads → **API**.
2. Only API signals → **API**.
3. Only UI signals → **UI**.
4. Mixed, or no signals → the declared `test_kind` (the line's, then `run_start`'s), else the **majority**
   of the run's data-decided cases, else `api`.

**The data wins over the label.** A declared type that the data contradicts is corrected, and the
renderer prints `WARNING type mismatch: <TC-ID> declared <x>, data says <y>` (console), repeats it as a
`**WARNING type mismatch:**` line in the Markdown header, and counts the corrected types in the HTML
meta card's **Project Type** field: `UI`, `API`, or `Mixed (N UI, M API)`. The Markdown header carries
the same `**Project Type:**` line.

**Declaring a type.** Whatever produces the log (the manual-execution flow, an automation converter)
should set `test_kind` (`"ui"` or `"api"`) on `run_start` and/or each `test_case` so the renderers have
something to verify against. For a Playwright run that means reading each spec's source: `page.goto`/
`locator`/... or a Page Object → `ui`; only the `request` fixture → `api`; log which file decided it. A
manual run sets `ui` when its attempts have screenshot evidence. (No converter script ships in this
folder yet; the renderers only need the fields in log-schema.md.)

**What changes per type**

| | API test case | UI test case |
|---|---|---|
| Three request-shaped rows | Endpoint Name / Request / Response | **Feature / Steps performed / Observed** |
| Expected, Actual, Status | unchanged | unchanged |
| "View req & response" | `.tc-reqres-panel` + `.tc-reqres-anchor` (single case), `.hop-reqres-panel` (hops) | **none** — no panel, no anchor, no toggle on its steps; only "View Test Case" |
| Hops | `details.hops` "Hops (N)", `.hop` with Request/Response/Expected/Actual/Evidence | `details.hops` **"Steps (N)"**, `.hop.ui-step` with **Observed / Expected / Evidence** (the template's generic script skips `.hop.ui-step`) |
| Live `.md` | `Hop N` | `Step N` |

An **API test case whose payloads were never captured** is still detected as API (labels stay Endpoint
Name / Request / Response) but has nothing to put behind a toggle, so none is drawn; capture
`request_full`/`response_full` to get the panel.

**UI evidence.** Evidence files are logged as `screenshots: [{"path","label","annotated"}]` (on the line,
a step, an attempt, or a `finding`). On a **failed** UI test case only the **annotated** screenshots (the
copy with a red outline on the failure) are shown — one per attempt, in both the card's Evidence and
the defect's Findings entry; the raw "Final UI state" capture of a failing screen is left out whenever an
annotated copy exists, because alone it does not show what went wrong. A **passed** test case keeps its
"Final UI state (PASS)" screenshot. If a failure has no annotated screenshot (e.g. a Playwright failure
saves only the raw screenshot, video and trace) its evidence is shown as captured rather than dropped.
Screenshots render as relative links (the report stays self-contained; the files are not embedded).

**Evidence naming (every UI run, one convention).** Evidence files and their link labels say which test case
they belong to and, on a failure, which bug — nobody should have to open an image to know what it shows.
[scripts/name-evidence.js](scripts/name-evidence.js) owns the convention (`nameFor()`), so producers and the
finalize step agree:

| Case | File name | Link label (what the report shows) |
|---|---|---|
| PASS | `<TC-ID>_<what-was-checked>_PASS.png` | `<TC-ID> - <what was checked> - PASS (final screen)` |
| FAIL | `<TC-ID>_<what-was-checked>_FAIL_<BUG-ID>_<bug-name>.png` | `<TC-ID> - <what was checked> - FAIL - <BUG-ID> <Bug Name> (screen when the check failed)` |
| FAIL video | same as the FAIL name with `_video.webm` | `... (video of the failing run)` |

`<what-was-checked>` is the test case title without its `[Feature][Category]` prefix and leading "Verify"
(lower-case, hyphenated, cut at a word; the whole file name is capped at 96 characters because Windows/Chrome cannot open `file://` paths over 260 characters — a longer name makes the link show ERR_FILE_NOT_FOUND). `<bug-name>` is the suffix of the defect's bug-report file
(`BugReports/<slug>/BUG-01_<bug-name>.md`), else the finding's `field_name`.

- The producer names a file at capture with `nameFor(tc, shot, null)` (no bug is known yet).
- After the defects are logged **and their bug reports written**, run
  `node scripts/name-evidence.js <slug>` (with `QA_LOG_DIR` for another project) **before** `render-html.js`. It
  adds the bug name to failed cases' files, rewrites each screenshot's `path`/`label` in the `.jsonl`, and
  repoints the evidence links inside the bug reports. It is idempotent. This is the one place an existing log
  line is edited in place, because the bug name cannot be known at capture time.
- A defect `finding` with no `screenshots` of its own shows its test case's (already named) evidence.

## Final HTML transform (run end or interruption, once)

The moment `run_end` is appended (whether `status: complete` or `status: interrupted`), transform the
finished `.md`/`.jsonl` into `NDC_Integration/Artifacts/Logs/<slug>.html` using
[references/report-template.html](references/report-template.html) as the base. This happens exactly
once per run — it is not re-rendered on every event the way the `.md` is.

**Constant template — fixed as of 2026-09-30, source: Round 12.** Both output pages are built from
two constant templates. The Time Breakdown template is the Round 12 page copied verbatim with `DATA:` notes; the main
template shares Round 12's head/CSS/script and section shape. Reference generators live in `scripts/` (`render-md.js`,
`render-html.js`, `render-tb.js`; usage: `node scripts/render-X.js <slug>`):

| Output | Template | Canonical source (identical markup) |
|---|---|---|
| `<slug>.html` | [references/report-template.html](references/report-template.html) | [20260930-140455_SeatMap-GulfAir-KSA-Round12.html](../../../NDC_Integration/Artifacts/Logs/20260930-140455_SeatMap-GulfAir-KSA-Round12.html) |
| `<slug>_TimeBreakdown.html` | [references/time-breakdown-template.html](references/time-breakdown-template.html) | [20260930-140455_SeatMap-GulfAir-KSA-Round12_TimeBreakdown.html](../../../NDC_Integration/Artifacts/Logs/20260930-140455_SeatMap-GulfAir-KSA-Round12_TimeBreakdown.html) |

**Rules for keeping the output constant.** Every run's two pages must look like the Round 12 pages:

- Copy the template's `<head>` (title, full `<style>` block) and bottom `<script>` block
  **verbatim**. Never restyle, rename classes/IDs, add a new component, or write per-run JS.
- Keep the **fixed section order**: main report is header → meta-card → *[optional]* erratum →
  1. Executive Summary → Expand/Collapse all → Test case results → Findings → *[optional]* Not
  reproduced → Proposed SPEC.md updates → Cleanup / follow-up. Time Breakdown is back-link →
  header → meta-card → 1. Time Breakdown → 2. Execution Phases → 3. Claude / AI Operations →
  4. Test Case Time → 5. Timeline → 6. Other / Overhead (its own section, not inside 1). Sections 2-6 are collapsible: each title is the `<summary>` of a `details.tb-sec` block (open by default); section 1 is always visible.
- Only change **values**, and **repeat/omit** blocks only where a `DATA:` comment says so. Optional
  blocks (erratum, Not reproduced, tc-subhead, rr-attempt-label, History row, "also re-confirmed"
  note, the ai_operation table, the discrepancy warning) appear only when the JSONL has data for them.
  Mandatory sections that have no data use their empty state, never get dropped.
- Strip every `DATA:` comment and the template's file-level comment from the rendered output. The
  output starts at `<!DOCTYPE html>`, exactly like the Round 9 files.
- Self-check before finishing: once the values are swapped out, the rendered file's tag/class
  skeleton should match the Round 9 file's for every section that is present.

The rich, interactive dashboard — categories, toolbar/search/filters, global and per-category Expand
all/Collapse all, per-hop AND per-test-case "View req & response" toggles (**API test cases only** — see
"Project type" above; UI test cases get none), count-badged
Findings/Proposed-SPEC-updates headers — is the standard for **every** run's report, including a
single-flow ad hoc run with exactly one test case (wrap it in one `tc-category` rather than skipping
the grouping apparatus). Full request/response capture is the default for every hop and every
single-endpoint test case, not a bonus reserved for when it happens to be convenient (see below).

Round 9 is the primary worked example: a flow-level card with 5 hops and full `.hop-reqres-panel`s,
a hop with a rejected-then-retried request, a single-request card with a card-level
`.tc-reqres-panel`, a recurrence defect with History, a "Not reproduced" section, a post-publication
erratum, a Proposed SPEC update with a Correction note, cleanup, and a time breakdown with a
labelled Overhead split and phase note. For shapes Round 9 doesn't show, these older runs are
secondary references (markup only; the template's CSS/script always wins):

- [20260823-164037_FLOW-V1-01.html](../../../NDC_Integration/Artifacts/Logs/20260823-164037_FLOW-V1-01.html) —
  a small ad hoc run (one flow-level test case plus one security test case). Best worked example for:
  a flow's `hops`/`.hop-reqres-panel` nesting, and the multi-attempt `.tc-reqres-panel` /
  `.rr-attempt-label` pattern for a single-endpoint case that sends more than one request of interest
  (its Security category's `TC-SEARCH-SEC-01`, isdebug=true/false/omitted).
- [20260825-103032_SeatMap-GulfAir-KSA.html](../../../NDC_Integration/Artifacts/Logs/20260825-103032_SeatMap-GulfAir-KSA.html) —
  a large batch run (60 test cases across 9 categories: Positive, Validation, Boundary, Business Rule,
  Regression, Negative, Security, Integration, Flow). Best worked example for: many categories at once
  with per-category pass/fail counts and Positive/Negative `tc-subhead` splits (its Flow category is
  the one that actually splits — most single-type categories correctly have no subhead), a BLOCKED
  test case that never sent a live request correctly rendering **no** reqres panel at all (don't
  fabricate one), flow-level hops with `.hop-reqres-panel` occurring alongside single-endpoint
  `.tc-reqres-panel` cases in the same run, and Findings/Proposed-SPEC-updates/Cleanup all populated
  together in one report.

The bottom `<script>` block is the same in all of these files. It wires "View Test Case" and "View
req & response" purely by class name/anchor presence, so copying it verbatim from the template and
emitting the right classes is enough; no per-run JS is ever needed.

**Full request/response capture is the default, not a conditional bonus.** `execute-test-cases`'s own
Process (step 2: "Send it, capture the raw status code, headers, and body verbatim") means the actual
request and response for every call made this run are already available at report-build time. This
skill's job is to carry that captured detail all the way into the HTML — render a `.hop-reqres-panel`
(flow hops) or `.tc-reqres-panel` (single-endpoint test cases) for **every** request this run actually
sent, not only when a full body happens to have been retained. Only fall back to the plain two-line
`.hd`/summary-only rendering for a call whose full body was genuinely never captured (e.g. rebuilding
an old run's report from a `.jsonl` that only ever logged summaries) — and even then, prefer fixing
the underlying capture for future runs over treating summary-only as an acceptable steady state. When
one test case sends more than one request-of-interest itself (not a flow — e.g. three variants of the
same call, like `TC-SEARCH-SEC-01`'s isdebug=true/false/omitted sweep), use the multi-attempt
`.tc-reqres-panel` pattern: one `.rr-attempt-label` (e.g. "Attempt 1 of 3 — isdebug: true") per
Request/Response pair inside the same panel, anchored via a
`<span class="tc-reqres-anchor"></span>` placed inside the card's status row — the generic script
wires the toggle to this anchor automatically. See `20260823-164037_FLOW-V1-01.html`'s Security
category for the exact worked markup, now also documented in
[references/report-template.html](references/report-template.html).

The HTML carries the same design tokens (paper/surface/ink/accent/good/warning/serious/critical,
light+dark via `prefers-color-scheme` and a `data-theme` override) as
`NDC_Integration/TestCases/TestCases_Report.html`, so every QA artifact in this project reads as one
visual system. Populate the template, don't redesign it:

- **Header**: `<h1>QA Execution Report</h1>` plus a `meta-card` field block (Scope, Coverage,
  Description, Supplier, Credentials Selector, Environment, Project Type, Started, Ended, Status) — Status is always
  `COMPLETE` or `INTERRUPTED — after <TC-ID> (N/M)` here, never `RUNNING` (that state only ever shows
  in the live `.md`). **`Ended`**: when the `.jsonl` has timing data (below), this is the **maximum
  timestamp anywhere in the log** (`run_end.ended_at`, every `phase` end, every `reporting_op.ended_at`,
  every `test_case.reporting_ended_at`) — not simply `run_end.ended_at` — since this skill's own
  reporting work happens after `run_end` is appended and is still part of the run's real lifecycle.
  When the `.jsonl` predates timing capture, fall back to `run_end.ended_at` as before.
- **Erratum** *(optional)*: when the `.jsonl` has an `erratum` line (a correction made after the report
  was first published, e.g. a finding re-classified as a recurrence of an existing bug), render the
  warning-colored `.erratum` callout directly under the meta-card, titled "⚠ Correction
  (post-publication)". Also update every place in the report that the correction affects, so the body
  is already correct. No `erratum` line means no callout.
- **Executive Summary**: the donut + stat-card layout (`.donut`/`.donut-hole`/`.donut-legend` plus
  `.scard-total`/`.summary-cards` for Passed/Failed/Blocked) — computed once from every `test_case`
  line in the final JSONL, never inflated by counting internal hops. A 1-test-case run still gets a
  donut (it'll just be 100% one color) — don't special-case it away. Below the Passed/Failed/Blocked
  row, add a second `.scard-total`-sized card labeled "Execution Duration" (the corrected `Ended` minus
  `Started` from the meta-card above, formatted like `39m 23s` or `2h 11m 19s`). Omit it only if the
  run has no `Ended` timestamp (still `RUNNING`/interrupted with no end recorded). Because that 4th card
  makes the
  stats-block column taller than the two-card layout the donut was originally sized for, the donut
  itself is sized larger (`.donut`/`.donut-hole` at 280px/190px, `.donut-pct`/`.donut-sub` at
  34px/15px) so the circle's height stays visually matched to the stats-block's height instead of
  looking undersized next to it — keep these sizes in sync if the stats-block ever grows or shrinks
  by a row. **Only when the `.jsonl` has timing data** (see "Execution Time Breakdown page" below),
  add a small text link directly under that Execution Duration card's value —
  `<a class="time-breakdown-link" href="./<slug>_TimeBreakdown.html">View Time Breakdown</a>` — never
  a large button, and never rendered at all when there's no timing data to link to (no dead href).
- **Expand all / Collapse all** buttons (`.tc-actions`) above the "Test case results" section, plus a
  **second pair inside every category** (`.tc-cat-actions`, via the `.tc-cat-expand`/`.tc-cat-collapse`
  classes) that only expands/collapses that one category's cards.
- **Toolbar**: search box + status filter + **category filter** + **Reset** button + live count
  (`N / M shown`), and a red no-results message (`.tc-no-results`) that appears when a search/filter
  combination matches zero cards. Wire all of it through the same `applyFilter()` pattern (see the
  script block) — text search, status, and category all combine, and Reset clears all three.
- **Test case results**, grouped into **categories** (`details.tc-category[data-cat=...]`, each with an
  icon, name, pass/fail/blocked counts, and a chevron). **A category is the test case's own test-TYPE
  classification — `Positive`/`Negative`/`Validation`/`Boundary`/`Business Rule`/`Regression`/
  `Security`/`Integration`/`Documentation`/`Flow`, i.e. the `Category`/`RowType` value
  `generate-test-cases` already assigned it in the source CSV (carried in the JSONL's `category`
  field, see log-schema.md) — never the endpoint or flow name it happens to call.** `endpoint_or_flow`
  already carries the endpoint/flow identity inside each card's "Endpoint Name" row; grouping the
  top-level categories by endpoint instead (e.g. one category per API call) is a mis-render of this
  template, not a valid alternative — the toolbar's whole point is letting someone filter "show me
  every Security case" or "every Negative case" across endpoints, which an endpoint-keyed grouping
  defeats. Even a single ad hoc flow run gets wrapped in one category (e.g. `data-cat="flow-v1-01"`
  when there's no more specific classification) rather than skipping the grouping. Inside each category,
  split into Positive/Negative `tc-subhead` groups when that distinction applies. Each test case card
  shows exactly these six fields **in this order**: **Endpoint Name**, **Request**, **Response**,
  **Expected**, **Actual**, **Status** badge — written in **plain, neutral, non-technical language** in
  these six visible rows (per this project's established convention — see the 20260805 file's cards
  for the calibration: translate HTTP codes/field names/jargon into plain wording, drop spec-section
  citations from the Expected label, keep concrete facts like dates/routes/passenger counts/amounts).
  Nest a flow's hop-by-hop detail as an expandable `details.hops` sub-list — hops keep **technical**
  wording (unlike the six visible rows), matching how `execute-test-cases` reports them. Add a "View
  req & response" underlined toggle per hop (see the script block's generic `.hop` pass — this is
  automatic, not something you hand-write per hop) so the Request/Response lines start collapsed and
  Expected/Actual/Evidence stay visible by default.

  **Render the full raw request/response payload by default** for every hop (not the plain two-line
  summary) — `execute-test-cases`'s own Process already captures the real request/response for every
  call it sends, so this is the normal path, not a special case triggered by luck. Render each hop's
  toggle content as a `.hop-reqres-panel`: a "Request" block (`POST to <full URL>`, a HEADERS box
  listing the literal headers sent — `x-api-key` always shown as `••••••••(redacted)`, never the real
  value — then a BODY box with the full pretty-printed request JSON) followed by a "Response" block
  (`Status code <N>`, then a BODY box with the full pretty-printed response JSON). See
  [20260823-164037_FLOW-V1-01.html](../../../NDC_Integration/Artifacts/Logs/20260823-164037_FLOW-V1-01.html)
  for the worked example and exact CSS classes (`.rr-title`/`.rr-line`/`.rr-label`/`.rr-box`/
  `.rr-headers-box`/`.rr-body-box`/`.rr-redacted`/`.rr-note`). Redact exactly like everywhere else in
  this skill — never print a raw `OriginalSupplierResponse`/`supplierRequest`/`supplierResponse`
  field; replace it with a one-line `[REDACTED — ... per SPEC.md §7.14]` placeholder inside the
  otherwise-full JSON body, not by omitting the whole body. If response headers weren't actually
  captured during execution, say so in an `.rr-note` rather than fabricating plausible-looking header
  values — never invent evidence. Fall back to the plain two-`.hd` summary only when a hop's full
  payload genuinely was never captured (e.g. re-rendering an old run whose `.jsonl` only logged
  summaries) — that gap is worth calling out to the user, not silently treated as normal. The generic
  script (`hop-reqres-panel` check before the two-`.hd` fallback) already handles both cases with no
  per-run JS changes needed.

  **The same full-capture default applies to single-endpoint test cases, not just flow hops.** A
  test case with no `hops` array (one HTTP call = the whole case) still gets a `.tc-reqres-panel`
  rendered the same way, anchored via `<span class="tc-reqres-anchor"></span>` inside the card's
  `<div class="row tc-status-row">` line (the generic script attaches the toggle to this anchor
  automatically — see the script block's `.tc-reqres-anchor` handling). When one test case sends
  **more than one** request-of-interest itself — e.g. `20260823-164037_FLOW-V1-01.html`'s
  `TC-SEARCH-SEC-01`, which runs the same Search call three times (isdebug=true/false/omitted) inside
  one test case — stack multiple Request/Response pairs inside the same `.tc-reqres-panel`, each
  preceded by an `.rr-attempt-label` (e.g. "Attempt 1 of 3 — isdebug: true") so every attempt is
  individually labeled rather than only the last one being shown.

  Also render the `evidence` field as a collapsible
  `details.evidence`, and a closing `details.view-tc` "View Test Case" block (Preconditions/Steps/
  Expected Result/Actual Result) per card, matching the 20260805 file's pattern.
- **Findings section**: defects and `UNKNOWN`-resolutions in visually distinct blocks (serious vs.
  accent), with a `section-summary-flex` header showing count badges per kind (`section-count-badges`,
  one `scb-val.serious` badge for Defects and one `scb-val.accent` badge for Unknown-resolution) —
  never conflate the two kinds, per execute-test-cases's own rule that these mean different things.
  Each defect block shows Field / Expected value / *[History]* / Impact rows. A defect that is a
  recurrence of an already-tracked bug (`bug_id` + `occurrence` set) labels itself "Defect — BUG-NN,
  Nth confirmed occurrence (not new)" and adds a **History** row. Impact ends with a relative link to
  the generated bug report (`../BugReports/<slug>/<BUG-ID>_....md`) when one exists. Findings of kind
  `reconfirmed` (a known bug seen again inside a hop, not the test case's own verdict) render as a
  closing `.empty` note ("Also re-confirmed this round ...") and are not counted in the badges.
- **Not reproduced** *(optional)*: when the `.jsonl` has `not_reproduced` lines (a tracked bug this run
  exercised but did not see), render a "Not reproduced" section after Findings with one paragraph per
  line: **BUG-ID** (short name), what was exercised, what happened, and the recommendation. No lines
  means no section.
- **Proposed SPEC.md updates**: one entry per `spec_update_proposed` proposal, in the Round 9 shape:
  `<p><b>§X.Y</b> — status: <i>pending</i></p>`, then `<p><b>Old:</b> "..."</p>` and
  `<p><b>New:</b> "..."</p>`, plus `<p><b>Correction:</b> ...</p>` when the line has a `note`. The
  `section-summary-flex` header shows a single `section-count-badge` total.
- **Cleanup / follow-up**: PNR list from `cleanup` lines, kept visually prominent (warning-colored
  `.cleanup` callout, not buried at the bottom in body text) since these are live bookings someone
  still needs to act on. Include the count in the callout's own lead line (e.g. "Live artifacts left
  behind this run (N):"), matching the 20260805 file's phrasing, rather than a header badge.
- Keep the file **fully self-contained** — inline CSS only, no CDN/external font/script references —
  since it's a local file meant to be opened directly in a browser, possibly by someone without
  network access to this project's tooling.
- Follow the project's existing chart conventions: status colors are reserved for verdict states and
  never reused as a generic categorical palette; thin marks; recessive gridlines; a table/list view is
  always present alongside the chart (the step list itself satisfies this — never chart-only).

## Execution Time Breakdown page (run end or interruption, once — only if timing data exists)

Right after the main `.html` transform, if this run's `.jsonl` contains timing fields (at minimum one
`test_case` line with `started_at`), render
`NDC_Integration/Artifacts/Logs/<slug>_TimeBreakdown.html` from
[references/time-breakdown-template.html](references/time-breakdown-template.html). Skip this entirely
— and skip the "View Time Breakdown" link in the main report — for a run whose `.jsonl` predates
timing capture or was re-rendered from one that never had it. Never synthesize timing to make the link
work; a run without real timestamps just doesn't get a breakdown page.

> **Revision 2026-10-10 (supersedes the Test Case Execution bullet below).** Test Case Execution is now the merged union of the intervals during which an API call was in flight: every `hops[]` and `attempts[]` entry's `[started_at, ended_at]` (attempts must therefore carry their own `started_at`/`ended_at`). A test case's own span (`started_at` to `timestamp`) is only a fallback for a legacy log with no per-call times. Idle gaps between calls are no longer execution; they fall into Other / Overhead. In the Test Case Time table each row's Execution is the test case's *share*: every elementary time slice is split evenly between the test cases whose calls cover it, so the rows sum exactly to the Test Case Execution card (no "parallel overlap" line any more).

Compute everything from the JSONL per log-schema.md's "Execution-time accounting rule" (also
summarized here for the render itself):

- **Total Duration** = `run_start.started_at` to the **maximum timestamp anywhere in the log**
  (`run_end.ended_at`, every `phase` `end`, every `reporting_op.ended_at`, every
  `test_case.reporting_ended_at`) — compute this **first**, then use it for both this page's meta-card
  and the main report's `Ended`/`Execution Duration` (update those two fields on `<slug>.html` to
  match, whenever timing data exists — see the Executive Summary bullet above). Do not just reuse
  `run_end.ended_at`: this skill's own `reporting_op`/per-test-case reporting work runs *after*
  `run_end` is appended, so stopping the clock there would exclude real, already-counted Reporting time
  from the total, making reconciliation impossible by definition rather than by bug.
- **Test Case Execution** = the union of every `test_case`'s `[started_at, timestamp]` interval (plus
  `hops[]`'s own `[started_at, ended_at]` intervals for a flow), **merged where they overlap, summed
  once per merged interval** — never a naive per-line sum. Two test cases can legitimately share one
  live call/response (two assertions read off the same Book response, say), and summing both spans
  would double-count that shared time.
- **Waiting** = Σ(`waiting_ms`) + Σ(every `wait` line's `ended_at − started_at`).
- **Claude / AI Processing** = Σ(every `ai_operation` line's `ended_at − started_at`).
- **Reporting** = Σ(`reporting_ended_at − reporting_started_at` per `test_case`, summed directly — these
  are always sequential in practice) + Σ(every `reporting_op` line's `ended_at − started_at`).
- **Other / Overhead** = `TotalDuration − (the four sums above)`, computed **from the rounded display
  values** (`round(Total) − round(Execution) − round(Waiting) − round(Claude) − round(Reporting)`) so
  the on-page numbers always sum to the on-page total exactly. With Total Duration and Test Case
  Execution computed per the two rules above, this is exact by construction — never negative in a
  correct render. If it ever comes out negative, that's a genuine bug in what was logged (e.g. a
  category summed raw instead of merged), not a real result — render the **discrepancy warning**
  described below instead of a negative card, and treat it as worth investigating, not routine.

Populate, reusing `report-template.html`'s design tokens (same `:root` CSS variables, `.dashboard-card`/
`.scard`/`.meta-card`/`.field` classes) so the page reads as part of the same system, not a separate
tool:

- **Header**: `<h1>Execution Time Breakdown</h1>`, a plain-text back-link to `./<slug>.html`, and a
  `meta-card` with Total Duration / Execution Start / Execution End (same values as the main report's
  meta-card).
- **No on-page prose explainer for the categories** — no per-category legend list, no standalone
  "methodology" paragraph. Both were tried and removed by user request: they read as clutter once the
  cards, the reconciliation line, and the Overhead breakdown already carry the real information. The
  category *definitions* below are for this skill's own accounting (computing the right number and
  writing accurate Overhead-breakdown labels) — internal knowledge, not page copy:
  - *Test Case Execution* includes the inline reasoning Claude does while building/validating each
    call, not only network time (per log-schema.md's accounting rule) — this is why it is usually the
    largest category and why *Claude / AI Processing* is usually small or zero.
  - *Claude / AI Processing* counts **only** explicit `ai_operation` lines — macro AI work *outside*
    any single test case's span (§4.7 capability confirmation, cross-result analysis, spec-update
    reasoning). It reads `0s` on most runs, including every run with no flow-level analysis beyond
    individual test cases.
  - *Waiting* counts only explicit, nameable waits (`wait` lines or a `waiting_ms` field) — a request
    retried with a corrected payload (e.g. working around a known defect) is **not** a wait, it's part
    of that test case's own Execution span.
  - *Reporting* is disk-artifact-generation work (JSONL/Markdown writes, the final HTML transform, this
    page, bug reports) — work about the run, not work the run's own test cases needed.
  - *Other / Overhead* is the residual inside `Total Duration` not claimed by the four categories above
    — almost always genuine, attributable gaps (setup before the first test case, the interval between
    one test case's result and the next one starting, wrap-up after the last verdict before the phase
    formally closes), not slack or a modeling error. **Never leave this as a bare unexplained number**
    — see the next bullet.
- **Category summary**: one card per category (value + `% of total`, computed dynamically — never
  hardcoded) plus a **reconciliation line**: `Accounted Time: <sum> — Total Duration: <total>`, and,
  only if they differ by more than ~1s of rounding, a visible warning callout (reuse `.cleanup`'s
  warning-colored styling) stating the exact difference — per SPEC.md-style honesty, never hide a
  mismatch.
- **Overhead breakdown** (render immediately after the reconciliation line, whenever Other/Overhead is
  more than a few seconds — omit only when it rounds to `0s`): a short list of the actual gaps that sum
  to it, derived directly from the JSONL's own timestamps, never invented. At minimum, compute and name:
  the gap between `run_start.started_at` and the first `test_case`'s own `started_at` ("Setup before
  first test case"); the gap between each `test_case`'s `timestamp` and the next `test_case`'s
  `started_at` ("Between `<TC-ID>` and `<TC-ID>`"); and the gap between the last `test_case`'s
  `timestamp` and the `phase` `"Test Execution"` `end` `at` ("Wrap-up after last test case"). As in
  Round 9, each label gets a short parenthetical saying in plain words what filled that gap (e.g.
  "Setup before first test case (reading SPEC.md contracts and the Postman templates ...)"), taken
  from what actually happened, never invented. These
  three kinds of gap are exhaustive for a normal run — if they don't sum to the displayed Overhead
  value (within ~1s rounding), that is itself worth surfacing as a discrepancy (reuse the existing
  warning-callout convention) rather than silently shown as a smaller, wrong-looking list.
- **Overhead section (6. Other / Overhead, after the Timeline)**: rows are clickable: each row of the Overhead breakdown opens a popup (`#tbModal`, markup/CSS/JS live in the template) showing the gap's start/end/duration/share, the event right before and right after it, and the `steps` from the matching `overhead_detail` line (log-schema.md). Gaps under 2 seconds are merged into one "short gaps" row. Write one `overhead_detail` line per gap of 2s or more.
- **Chart**: a horizontal bar per category, share of total as bar width, same status/accent color
  tokens as the rest of the report (not a new palette) — CSS-only (a `div` with `width:<pct>%`), no
  chart library, consistent with the donut elsewhere in this template being pure CSS
  `conic-gradient`.
- **Phase table**: one row per `phase` name with Start/End/Duration/% (only phases actually present in
  the JSONL — never list all 8 example phases from the request if fewer were logged). Whenever a
  "Test Execution" phase exists, keep the `.tb-phase-note` above the table explaining that the phase's
  wall-clock time differs from the Test Case Execution category (the difference is only the part of Overhead
  that falls inside that phase, NOT the whole Overhead in section 1), listing per-test-case spans, the gaps
  between test cases, the log-writing tail, and the unlabelled Overhead outside the phase (idle gaps
  between phases, report rendering), with this run's real numbers filled in. `scripts/render-tb.js`
  builds this note automatically.
- **Claude / AI Operations table**: one row per `ai_operation` line (Operation/Related TC/Start/End/
  Duration). Render `<div class="empty">No AI operations recorded for this run.</div>` rather than an
  empty table if there are none — a run with none isn't a gap, most runs won't have any.
- **Reporting operations (inside 2. Execution Phases — there is no separate Reporting Breakdown section)**:
  the phase table lists Test Execution, Result Collection, Bug Reporting and Report Generation (those the
  log has). Each `reporting_op` line (operation name verbatim) is an indented `↳` sub-row directly under
  the phase whose start/end window contains it (Bug Report Generation → Bug Reporting; Final HTML and
  Time Breakdown → Report Generation), plus one aggregate sub-row "Per-test-case JSONL + Markdown writes
  (N test cases)" **only when** `test_case` lines carry `reporting_started_at`/`reporting_ended_at`
  (it lands under Result Collection). Sub-rows open their own popup like phase rows. The table's tfoot
  "Total Reporting Time" equals the Reporting card (exact value, plus "card: Ns rounded").
- **Test Case Time table**: `# | Test Case ID | Test Case | Status | Start | End | Execution | Waiting |
  Claude | Reporting | Total`, one row per `test_case` line — reuse the main report's `tc-toolbar`
  search/status-filter pattern (same classes/IDs, e.g. `tcbSearch`/`tcbStatusFilter`) plus clickable,
  sortable column headers (vanilla JS, generic — no per-run script edits, same convention as the main
  template's bottom `<script>` block). **Reporting column**: besides the test case's own
  `reporting_started_at/ended_at`, add each `reporting_op` that names the test case in
  `related_tc_ids` (its duration split evenly across the listed TCs). A `"Bug Report Generation"` op
  with no `related_tc_ids` is split evenly across the TCs that have a `kind:"defect"` finding. Run-level
  ops (Final HTML, Time Breakdown) stay unattributed. The column must sum to the Reporting card (±1s
  rounding) — never leave bug-report time at `0s` on the failing rows. **Total** = Execution + Waiting +
  Claude + Reporting for that row. **Reconcile line** (a `.tb-reconcile` div directly under the table):
  test cases can run in parallel, so the Execution column's plain sum exceeds the Test Case Execution
  card; state `Σ rows − parallel overlap = card value` with this run's numbers, so the two never look
  like a mismatch. A test case with `timing:"partial"` (interrupted before its end
  timestamp) shows `Timing: Partial` in that row instead of a fabricated `0s`.
- **Timeline**: a simple chronological list — every `phase` boundary and every `test_case`'s
  `started_at` — using the existing `.field`/`.mono` text styling, not a new visualization. This is the
  last section on the page — there is no further "Action Hierarchy"/self-time tree breakdown below it;
  that was tried and removed by user request (it read as clutter, especially on runs where most hops
  weren't individually timestamped) and is not part of this template's fixed, reusable shape.
- Fully self-contained (inline CSS/JS, no CDN), and the `./<slug>.html` / `./<slug>_TimeBreakdown.html`
  links stay relative both directions so the pair keeps working if the whole `Artifacts` folder is
  copied elsewhere.

## Non-goals

- Not for executing test cases or deciding verdicts — that's `execute-test-cases`; this skill only
  persists and visualizes what it already decided.
- Not for editing SPEC.md — proposed updates are recorded here for visibility, applied only where
  `execute-test-cases`'s own process says so (on user confirmation).
- Not a replacement for the in-conversation live reporting `execute-test-cases` already does — this
  skill mirrors that stream to disk, it doesn't replace or delay it.
- Not for generating the `TestCases_V1.html`/`TestCases_V2.html` coverage reports — those come from
  `generate-test-cases`'s CSV output; this skill is execution-results only.
- Not for turning a defect into a filable bug ticket — once a `defect` finding is logged here, apply
  the `generate-bug-report` skill (separately, typically once this run's report is done) to produce
  that per-defect Markdown report; this skill's own job stops at logging and visualizing the finding.

## Time Breakdown page changes 2026-10-10

`scripts/render-tb.js` now: (1) builds Test Case Execution from API-call intervals and charges each test case only its share (see the Revision note above); (2) shows millisecond-precision durations for short values (Reporting Breakdown, Phase table, AI operations table, Test Case Time table); (3) adds a Claude column value per test case (run-level AI time split evenly, disclosed in the reconcile line); (4) replaces the long Execution Phases paragraph with a two-sentence note and makes every row of sections 2 (phases), 3 (Claude / AI operations) and 4 (reporting operations, including the per-test-case write row) open the shared `#tbModal` popup via `data-detail` JSON; a "Details ›" column marks the clickable rows. `references/time-breakdown-template.html` gained a small hover/cursor rule for clickable table rows. `render-md.js` / `render-html.js` are data-driven from `run_start` and `test_case.plain` (see log-schema.md "Additions 2026-10-10").

## Time Breakdown page changes 2026-10-12

The former "4. Reporting Breakdown" section is merged into "2. Execution Phases": reporting operations are `↳` sub-rows under the phase that contains them, "Result Collection" is now a listed phase (it holds the per-test-case writes), and the "Total Reporting Time" line is the phase table's footer. Sections after it renumber to 4 Test Case Time, 5 Timeline, 6 Other / Overhead. Implemented in `scripts/render-tb.js` and `references/time-breakdown-template.html` (new `.tb-sub`, `.tb-sub-arrow`, `.tb-foot-note` CSS).
