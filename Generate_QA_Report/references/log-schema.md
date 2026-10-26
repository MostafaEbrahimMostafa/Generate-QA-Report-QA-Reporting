# JSONL log schema

Source of truth for a run: `NDC_Integration/Artifacts/Logs/<slug>.jsonl`. One JSON object per line,
appended in the order events happen — never rewritten, never reordered. The HTML report is always a
full re-render from these lines, top to bottom.

**The countable, reportable unit is the test case (one TC-ID), not an internal execution hop.** A
single-endpoint test case has exactly one hop. A flow-level test case (SPEC.md §5.4) chains several
endpoint calls (Search → FareConfirm → Book, etc.) — those calls are hops *inside* one test case, not
separate loggable units themselves. Stat tiles, the proportion bar, and "N logged so far" all count
`test_case` lines, never raw hop counts.

Every line has a `type` field. Unknown/extra fields are fine to add per-run if a specific test case
needs to carry something extra (e.g. a `supplier` override) — the renderer should not choke on fields
it doesn't recognize.

## Execution-time accounting rule

> **Revision 2026-10-10 (supersedes the Test Case Execution bullet below).** Test Case Execution is now the merged union of the intervals during which an API call was in flight: every `hops[]` and `attempts[]` entry's `[started_at, ended_at]` (attempts must therefore carry their own `started_at`/`ended_at`). A test case's own span (`started_at` to `timestamp`) is only a fallback for a legacy log with no per-call times. Idle gaps between calls are no longer execution; they fall into Other / Overhead. In the Test Case Time table each row's Execution is the test case's *share*: every elementary time slice is split evenly between the test cases whose calls cover it, so the rows sum exactly to the Test Case Execution card (no "parallel overlap" line any more).


The JSONL is also the source of truth for the "Execution Time Breakdown" page (see
`generate-qa-report`'s SKILL.md). There is no coded execution backend here — `execute-test-cases` *is*
Claude reasoning and calling the live API — so the five time categories are defined precisely to avoid
double-counting rather than measured by some external profiler:

- **Total Duration** = `LatestTimestamp − run_start.started_at`, where `LatestTimestamp` is the
  **maximum** of every timestamp anywhere in the log — `run_end.ended_at`, every `phase` `end` `at`,
  every `reporting_op.ended_at`, every `test_case.reporting_ended_at` — **not simply
  `run_end.ended_at`**. `run_end` is appended when the test-execution scope finishes, but
  `generate-qa-report`'s own final HTML + Time Breakdown transforms (and `generate-bug-report`'s pass)
  necessarily run **after** that line per this skill's own Process — real, substantial wall-clock time
  the project's own §1 "complete execution lifecycle" requirement says must be included. Stopping the
  clock at `run_end` while still counting post-`run_end` `reporting_op` time under the Reporting
  category is exactly what produces an unreconcilable total — always take the max timestamp, not just
  `run_end.ended_at`, and mirror this same value as the main report's meta-card `Ended` field and its
  `Execution Duration` card whenever timing data exists (both pages describe one lifecycle; they must
  show one number).
- **Test Case Execution** = the **union of every `test_case`'s `[started_at, timestamp]` interval**
  (and `hops[]`'s own `[started_at, ended_at]` intervals for a flow), merged where they overlap, summed
  once per merged interval — **never a naive per-line sum**. Two test cases legitimately can share the
  same live call/response (e.g. two assertions read off one Book response) and their spans will
  genuinely overlap; summing both spans double-counts that shared wall-clock time and is exactly the
  kind of double-count §8/§12 of this feature's own requirements forbid. Merge algorithm: sort all
  intervals by `started_at`, then walk them once, extending the current merged interval whenever the
  next one starts at or before its end, starting a new merged interval otherwise; sum each merged
  interval's own length. This also **includes** the inline reasoning/validation Claude does while
  judging each call — it cannot be separated from the HTTP round-trip without expensive per-microstep
  timestamping, which the project's performance rule (negligible timing overhead) forbids. Folding it
  in here, explicitly, is the accounting rule — never also counted under Claude/AI Processing.
- **Waiting** = only explicit, nameable waits: `wait` lines, or a `waiting_ms` field on a `test_case`/
  `hop`. Never a default or estimate — most test cases have none, and that's expected, not a gap.
- **Claude / AI Processing** = `ai_operation` lines only — macro AI work *outside* the per-test-case
  loop (SPEC.md §4.7 capability-confirmation analysis, results/recommendation analysis, spec-update
  reasoning). These occupy wall-clock windows outside any `test_case`/`hop` span, so they never overlap
  Test Case Execution.
- **Reporting** = `reporting_op` lines, plus each `test_case`'s own `reporting_started_at`/
  `reporting_ended_at` (the JSONL-append + Markdown-re-render window right after that test case's
  verdict) — sum these directly (they're always sequential/non-overlapping in practice, one write
  after another). Also covers the one-time final HTML transform, the Time Breakdown page render, and
  `generate-bug-report`'s per-defect Markdown drafting.
- **Other/Overhead** = `TotalDuration − (Execution+Waiting+Claude+Reporting)`, computed at render time
  from the corrected `TotalDuration` above, not its own timestamped category. With Total Duration
  correctly spanning the full lifecycle and Test Case Execution correctly de-overlapped, this is exact
  by construction (never negative in a correct render — a negative value means a real bug in what was
  logged, e.g. a category summed raw instead of merged/deduplicated, not a real result). Round each
  category to whole seconds for display, then compute the *displayed* Overhead as
  `round(TotalDuration) − round(Execution) − round(Waiting) − round(Claude) − round(Reporting)` (the
  rounded total minus the other four already-rounded values, not an independently-rounded raw number)
  so the on-page figures always sum to the on-page total exactly, never off by the last displayed
  second. The breakdown page still shows the reconciliation line explicitly; it should read as a clean
  match, not a warning, once Total Duration and Test Case Execution are computed per this rule — a
  discrepancy warning firing after following this rule correctly means a genuine logging bug, worth
  surfacing, not routine.

All timing fields below are **optional and additive** — a JSONL written before this convention existed
(or a line where a genuine timestamp was never captured) simply omits them, and the breakdown page is
skipped entirely for that run rather than backfilling invented numbers (see SKILL.md's "Non-goals").
Capture every timestamp the same way: `(Get-Date).ToUniversalTime().ToString("o")` (or equivalent),
ISO-8601 UTC, matching `started_at`/`ended_at`/`timestamp` elsewhere in this schema.

## `run_start` (exactly one, first line)

```json
{"type":"run_start","scope":"Flow #43 — V2, Family B, Hold","environment":"staging",
 "baseUrl":"https://ndc-integration-stg-ne-3.azurewebsites.net/","supplier":"SUP_A",
 "credentials_selector":"SUP_A_DEFAULT","started_at":"2026-08-04T14:32:10Z",
 "total_test_cases_planned":12}
```

`total_test_cases_planned` is best-effort (e.g. a test-case file's row count, or 1 for a single ad hoc
flow/endpoint run) — used only to render "N of M so far" and the interrupted-run note; fine if a
later count differs. `supplier`/`credentials_selector` are the run's default — if a test case runs
against a different supplier/selector than the run default, it carries its own `supplier`/
`credentials_selector` field (below) which takes precedence for that one line.

## `test_case` (one per test case executed — the primary unit)

Appended once, the moment that test case's overall verdict is known — i.e. after its last hop
finishes for a passing/failing case, or as soon as a hop fails/blocks in a way that ends the case.
For a single-endpoint test case this is immediate (one hop = the whole case). For a flow-level test
case, don't wait to accumulate several test cases' worth of hops before writing this — write it as
soon as *this* test case's outcome is settled, then move to the next one.

```json
{"type":"test_case","tc_id":"TC-0412","title":"Validate FareConfirm price reconciliation for SUP_A",
 "endpoint_or_flow":"FareConfirm","category":"Business Rule","verdict":"PASS","spec_ref":"§2.3",
 "supplier":"SUP_A",
 "request_summary":"POST /api/v2/FareConfirm — offerId=<redacted-id>, supplier=SUP_A",
 "response_summary":"200 — totalFare=482.00, currency=USD, offerId=<redacted-id>",
 "expected":"§2.3: 200, price fields reconcile per §2.1 formula",
 "actual":"200, totalFare=482.00, matches computed 482.00",
 "evidence":"computed 460.00 base + 22.00 tax = 482.00, matches totalFare",
 "correlation_id":"c4f2-...-redacted",
 "timestamp":"2026-08-04T14:33:02Z",
 "started_at":"2026-08-04T14:32:55Z","waiting_ms":0,"timing":"complete",
 "reporting_started_at":"2026-08-04T14:33:02Z","reporting_ended_at":"2026-08-04T14:33:03Z"}
```

- **Timing fields** (all optional/additive — see "Execution-time accounting rule" above):
  - `started_at` — captured right before this test case's first request is built, i.e. when work on it
    actually begins. `timestamp` (already required, above) is reused as its end/verdict time — Test
    Case Execution for this line is `timestamp − started_at`. For a flow-level test case, `started_at`
    is hop 1's own `started_at` and `timestamp` is the last hop's verdict time.
  - `waiting_ms` — only set when this specific test case included a real explicit wait (retry backoff,
    polling, an intentional pause) that would otherwise inflate its execution span; omit rather than
    write `0` when there genuinely was none — the renderer treats a missing field the same as zero, so
    there's no need to pad every line with an explicit zero.
  - `timing` — `"complete"` when both `started_at` and `timestamp` were actually captured, `"partial"`
    when the case ended (e.g. errored, interrupted) before an end timestamp could be captured — never
    silently treat a missing end time as `0` duration (SKILL.md's error-handling rule). Omit this field
    entirely for a legacy line that predates timing capture (distinct from `"partial"`, which means
    "timing was attempted but incomplete").
  - `reporting_started_at`/`reporting_ended_at` — the window `generate-qa-report` spends appending this
    line to the `.jsonl` and re-rendering the `.md` right after. Two cheap timestamps around an
    operation that already happens every test case, not a new expensive log.

- `category` is the test case's own **test-type classification** — the `Category`/`RowType` value
  already assigned to it by `generate-test-cases` in the source CSV (`Positive`, `Negative`,
  `Validation`, `Boundary`, `Business Rule`, `Regression`, `Security`, `Integration`, `Documentation`,
  or a `Flow`-type row) — **never** the endpoint/flow name (`endpoint_or_flow` already carries that).
  This is the field the HTML/Markdown category filter and `details.tc-category[data-cat=...]`
  grouping are built from (see report-template.html) — grouping cards by endpoint instead of by this
  test-type classification is a mis-render, not a stylistic choice. Consolidate closely-related
  source values when it reads better (e.g. several "End-to-End Flow - Positive/Negative
  (Addendum/Candidate)" rows can share one `"Flow"` category, using `tc-subhead` for the
  Positive/Negative split within it) but always derive the category from the test case's own
  classification, never invent one from the endpoint it happens to call.
- `verdict` is one of `PASS`, `FAIL`, `BLOCKED`.
- `request_summary`/`response_summary`/`actual`/`evidence` must already be redacted per SPEC.md
  §7.14 (no raw `supplierRequest`/`supplierResponse`) — redact before appending, the renderer does
  not re-redact.
- `response_summary` is the raw (redacted) shape of what came back — status code + the key fields
  the test case cares about — distinct from `actual`, which is the *interpreted* comparison against
  `expected` (e.g. "matches computed 482.00"). Both get shown; don't collapse one into the other.
- `supplier` is optional per-line — only set it when this test case's supplier differs from
  `run_start`'s default; otherwise the renderer falls back to the run-level `supplier`.
- `correlation_id` is optional — carry it when the response exposes one (e.g. a request/trace ID
  header), since it's the first thing a bug report needs to hand to the supplier/platform team.
- **`request_full`/`response_full`** — capture these by default for every test case (single-endpoint
  or flow), not just when convenient: `execute-test-cases`'s own Process already has the real
  request/response in hand for every call it sends, so carrying it into the log is the normal path,
  not extra work reserved for special cases. Shape:
  ```json
  "request_full":{"method":"POST","url":"https://.../api/FlightSearch/Search",
    "headers":{"Accept":"*/*","x-api-key":"[REDACTED]","Client-Id":"NDC-Core","Content-Type":"application/json"},
    "body":{"supplier":"SUP_A","credentialsSelector":"UAE","...":"..."}},
  "response_full":{"status":200,"body":{"responseId":"...","offers":[{"...":"..."}]},
    "headers_captured":false}
  ```
  Always redact `x-api-key` to the literal string `"[REDACTED]"` (the renderer turns this into the
  `••••••••(redacted)` display), and replace any raw `supplierRequest`/`supplierResponse`/
  `OriginalSupplierResponse` field inside `body` with a one-line `"[REDACTED — ... per SPEC.md §7.14]"`
  string rather than dropping the field or the whole body. `response_full.headers_captured:false` (or
  omit `headers_captured` entirely) tells the renderer to show an `.rr-note` saying response headers
  weren't captured, instead of fabricating any. Only omit `request_full`/`response_full` entirely when
  the call's full body genuinely was never retained (legacy runs, or a re-render from a `.jsonl` that
  only ever logged summaries) — the HTML renderer falls back to the plain summary-only view for that
  one entry, and this gap is worth surfacing to whoever reads the report, not silently accepted as
  routine.
- **`attempts`** (optional array, only on a single-endpoint `test_case` — never combine with `hops`)
  — use this instead of a single `request_full`/`response_full` pair when one test case sends the
  **same or similar call more than once** as its own scenario (not a multi-endpoint flow), e.g. an
  isdebug=true/false/omitted sweep or a repeated call with different header values:
  ```json
  "attempts":[
    {"label":"Attempt 1 of 3 - isdebug: true","request_full":{...},"response_full":{...}},
    {"label":"Attempt 2 of 3 - isdebug: false","request_full":{...},"response_full":{...}},
    {"label":"Attempt 3 of 3 - isdebug: omitted","request_full":{...},"response_full":{...}}
  ]
  ```
  Each `label` becomes that attempt's `.rr-attempt-label` in the rendered `.tc-reqres-panel` — see
  `20260823-164037_FLOW-V1-01.html`'s `TC-SEARCH-SEC-01` for the worked example this mirrors.
- **`hops`** (optional array, only for flow-level test cases with more than one endpoint call) —
  internal diagnostic detail nested *inside* this one test case's line, never logged as separate
  top-level events and never counted on their own:

  ```json
  "hops":[
    {"hop":1,"endpoint":"Search","request_summary":"...","response_summary":"...","expected":"...",
     "actual":"...","verdict":"PASS","evidence":"...",
     "started_at":"2026-08-04T14:32:55Z","ended_at":"2026-08-04T14:32:58Z",
     "request_full":{"method":"POST","url":"https://.../api/FlightSearch/Search",
       "headers":{"x-api-key":"[REDACTED]","Client-Id":"NDC-Core"},"body":{"...":"..."}},
     "response_full":{"status":200,"body":{"...":"..."}}},
    {"hop":2,"endpoint":"FareConfirm","request_summary":"...","response_summary":"...","expected":"...",
     "actual":"...","verdict":"PASS","evidence":"...",
     "started_at":"2026-08-04T14:32:58Z","ended_at":"2026-08-04T14:33:00Z",
     "request_full":{"...":"..."},"response_full":{"...":"..."}},
    {"hop":3,"endpoint":"Book","request_summary":"...","response_summary":"...","expected":"...",
     "actual":"...","verdict":"FAIL","evidence":"...",
     "started_at":"2026-08-04T14:33:00Z","ended_at":"2026-08-04T14:33:02Z",
     "request_full":{"...":"..."},"response_full":{"...":"..."}}
  ]
  ```

  This is what preserves execute-test-cases's own diagnostic rule that "hop 3 of an 8-hop flow
  failed" is more useful than "the flow failed" — the hop detail survives, just nested under its
  parent test case rather than being the thing that gets counted or shown as the top-level list. Each
  hop carries its own `request_full`/`response_full` by default (same redaction rules and fallback
  behavior as the top-level fields above) so the final HTML's per-hop `.hop-reqres-panel` has real
  payloads to render, not just the summary strings. Each hop also carries its own `started_at`/
  `ended_at` (optional/additive, same rule as the top-level `test_case` fields above) — the parent
  line's own `started_at` equals hop 1's `started_at`, and its `timestamp` equals the last hop's
  `ended_at`, so summing hop spans never double-counts against the parent's own span.

## `finding` (one per UNKNOWN-resolution or SPEC.md contradiction)

```json
{"type":"finding","kind":"unknown_resolution","related_tc_id":"TC-0412",
 "summary":"FareConfirm error shape for expired offerId confirmed as {errorCode:'OFFER_EXPIRED'}",
 "spec_ref":"§2.3","evidence":"..."}
```

`kind` is `unknown_resolution` or `defect` (plus the optional `reconfirmed`, below) — keep these visually and semantically separate in the
render, per execute-test-cases's own rule (new information vs. a regression/wrong assumption).

For a `defect` finding specifically, carry enough structured detail for the companion
`generate-bug-report` skill to turn it into a bug ticket without having to re-derive anything from
prose — add `field_name` (the exact response field at fault), `expected_value` (an example valid
value, not just "not null"), and `impact` (one line on what breaks downstream) alongside `summary`:

```json
{"type":"finding","kind":"defect","related_tc_id":"TC-0430",
 "field_name":"holdExpirationDate","summary":"holdExpirationDate returned null in Hold response",
 "spec_ref":"§6.3","expected_value":"2026-08-05T14:32:10Z",
 "impact":"Downstream cannot compute the Family-B hold's expiry, so cleanup/expiry tracking can't run",
 "evidence":"..."}
```

**Recurrence of a tracked bug** (optional/additive): when a defect is an existing bug seen again, add
`bug_id`, `occurrence` (how many confirmed occurrences, counting this one) and `history` (one line:
first seen, rounds confirmed, gaps). The HTML labels it "Defect — BUG-NN, Nth confirmed occurrence
(not new)" and shows a History row:

```json
{"type":"finding","kind":"defect","related_tc_id":"TC-BOOK-BIZ-05","bug_id":"BUG-09","occurrence":7,
 "history":"First observed Round 1 (2026-08-25); reproducing since Round 2; confirmed Rounds 1,2,3,5,6,9",
 "field_name":"...","summary":"...","expected_value":"...","impact":"...","evidence":"..."}
```

`kind:"reconfirmed"` (optional) records a known bug seen again inside a hop without being the test
case's own verdict (e.g. a workaround had to be applied). It renders as a closing note under
Findings and is **not** counted in the Defects/Unknown-resolution badges:

```json
{"type":"finding","kind":"reconfirmed","related_tc_id":"TC-BOOK-BIZ-04","bug_id":"BUG-10",
 "summary":"AddPassenger rejects its own saved Postman example over a name.middle mismatch","occurrence":9}
```

## `not_reproduced` (optional — one per tracked bug this run exercised but did not see)

```json
{"type":"not_reproduced","bug_id":"BUG-16","short_name":"Book/Hold HTTP 500 while silently succeeding",
 "related_tc_ids":["TC-BOOK-BIZ-04","TC-BOOK-BIZ-05"],
 "note":"Both Book calls returned a clean 200 with a real PNR. Recommend a wider re-verification before closing."}
```

Renders the optional "Not reproduced" section. No lines means no section.

## `erratum` (optional — a correction made after the report was first published)

```json
{"type":"erratum","at":"2026-09-29T10:05:00Z",
 "text":"TC-BOOK-BIZ-05's finding was first filed as new BUG-17; it is the existing BUG-09 (7th occurrence)."}
```

Appended when a published report has to be corrected. Re-render the `.md`/`.html` from the JSONL:
the correction is applied throughout the body **and** shown in the `.erratum` callout under the
meta-card. Apply the correction itself by appending corrected lines (for example a re-issued
`finding` line with the same `related_tc_id`; the latest line wins), never by editing old lines.

## `spec_update_proposed` (one per proposed edit)

```json
{"type":"spec_update_proposed","section":"§2.3","old_text":"Error shape for expired offerId: UNKNOWN",
 "new_text":"Error shape for expired offerId: {errorCode:'OFFER_EXPIRED', httpStatus:400}",
 "status":"pending"}
```

Optional `note`: rendered as the proposal's **Correction:** paragraph, for context such as "already
confirmed in Rounds 1–6 and never applied".

`status` starts `pending`; update to `applied` or `declined` with a new line of the same
`spec_update_proposed` shape (same `section`/`old_text`) if the outcome becomes known later in the
run — the renderer should use the latest line per `(section, old_text)` pair as current status.

## `cleanup` (one per live artifact left behind)

```json
{"type":"cleanup","kind":"family_b_hold","pnr":"ABC123","related_tc_id":"TC-0430",
 "note":"Held, not finalized — expires per holdExpirationDate"}
```

`kind` is `family_b_hold` or `needs_void_cancel`.

## `phase` (paired start/end lines, run-level — optional/additive)

```json
{"type":"phase","name":"Test Execution","event":"start","at":"2026-08-04T14:32:14Z"}
{"type":"phase","name":"Test Execution","event":"end","at":"2026-08-04T18:51:42Z"}
```

`name` is one of the run's execution phases (e.g. Initialization, Test Data Preparation, Test
Execution, Result Collection, AI Analysis, Bug Reporting, Report Generation, Finalization) — only emit
the phases that are actually distinct steps in a given run; skip ones that don't apply rather than
inventing a phase boundary that didn't really happen. The renderer matches `start`/`end` pairs by
`name` and, if an `end` is missing when the run finishes, treats that phase as still-open at
`run_end.ended_at` rather than silently dropping it.

## `ai_operation` (one per macro AI operation outside the per-test-case loop — optional/additive)

```json
{"type":"ai_operation","operation":"Analyze Execution Results","started_at":"2026-08-04T18:51:42Z",
 "ended_at":"2026-08-04T18:52:55Z","related_tc_id":null}
```

Only for AI work that happens *outside* a `test_case`/`hop` span — see the accounting rule above.
Typical `operation` values: "Capability Confirmation Analysis" (SPEC.md §4.7), "Analyze Execution
Results", "Generate Recommendations", "Spec Update Reasoning". `related_tc_id` is optional — set it
when the operation is tied to one test case (e.g. capability confirmation before a specific flow).

## `wait` (one per explicit, nameable wait — optional/additive)

```json
{"type":"wait","reason":"Retry backoff after 503","started_at":"2026-08-04T14:40:10Z",
 "ended_at":"2026-08-04T14:40:15Z","related_tc_id":"TC-0430"}
```

Only for a real wait the run actually performed (retry backoff, polling, an intentional pause before a
hold-expiry check, waiting on a file-generation step) — never invented for an ordinary single-call test
case. If the wait happened inside one test case's own span, prefer that test case's `waiting_ms` field
instead of a separate `wait` line, to avoid needing to cross-reference two lines for one number; use a
top-level `wait` line for a wait that isn't cleanly attributable to one test case.

## `reporting_op` (one per report-artifact-generation operation — optional/additive)

```json
{"type":"reporting_op","operation":"Final HTML Report Generation","started_at":"2026-08-04T18:53:00Z",
 "ended_at":"2026-08-04T18:53:08Z"}
```

Covers work outside the per-test-case `reporting_started_at`/`reporting_ended_at` window: the one-time
final HTML transform, the Time Breakdown page render, and (per `generate-bug-report`'s SKILL.md) each
defect's Markdown bug-report drafting (`operation:"Bug Report Generation"`).

Optional `"related_tc_ids":["TC-…","TC-…"]` lists the test cases the op was about (for bug reports: the
defects' TCs). The Time Breakdown's Test Case Time table splits the op's duration evenly across them
in each row's Reporting cell.

## `run_end` (at most one, last line when present)

```json
{"type":"run_end","status":"interrupted","interrupted_after_tc":"TC-0430","of_total":12,
 "reason":"safety-rule stop: non-staging baseUrl without authorization","ended_at":"2026-08-04T14:41:00Z"}
```

`status` is `complete` or `interrupted`. `interrupted_after_tc` names the last test case that
completed (or partially completed — see below) before the stop, not a raw hop count.

## Interrupted mid-test-case

If a run stops partway through a *flow-level* test case (some hops done, the case's own `test_case`
line never got written because its verdict was never reached), don't silently drop it: append a
`test_case` line for it anyway with `verdict:"BLOCKED"` and whatever `hops` did complete, so it still
counts and still shows up — an interrupted flow is a real (blocked) result, not a gap in the report.

## `overhead_detail` (optional — one per Other/Overhead gap worth explaining)

```json
{"type":"overhead_detail","from":"2026-09-30T11:08:16.996Z","label":"After the Book failure on chain A2, before the BIZ-03 chain",
 "steps":["Read the 409 error body ...","Ran the checks for VAL-07..VAL-10 ..."]}
```

Feeds the click-to-open popup on each row of the Time Breakdown page's "What's in Other / Overhead" list.
`from` is matched (within 3 seconds) to the start of a computed gap; `steps` is plain prose of what actually
happened in that window, taken from the conversation, never invented. A gap with no matching line still gets a
popup, with its exact window and the events on either side plus a generic note. Not counted in any category.

## Additions 2026-10-10 (Round 18 tooling)

- `run_start` may carry presentation fields read by `render-md.js` / `render-html.js`: `title_line` (the .md H1 text after "QA Execution Report — "), `prior_runs`, `scope_text`, `coverage_text`, `description_text`. Without them the renderers fall back to a generic title and "N of M planned test cases".
- A `test_case` line may carry `plain`: `{e,q,s,x,a}` (endpoint, request, response, expected, actual in plain, non-technical wording) for the six visible HTML card rows. `render-html.js` uses `t.plain`; an old run's built-in table is only a fallback.
- Every `attempts[]` entry must carry its own `started_at` / `ended_at` (hops already do): Test Case Execution is built from call intervals, so a test case made only of attempts has no execution time without them.
- Long bodies must be truncated before they are written to the log: arrays longer than 3 items keep 2 + `"__omitted__: N more items"`, strings over 110 characters are cut to 60 + `...[truncated]`, objects over 14 keys keep 8 + an `__omitted__` key. Untruncated seat maps and search results made the Round 18 HTML 30 MB.
- `ai_operation` may name `related_tc_ids` (or `related_tc_id`); with neither, its duration is split evenly across all test cases in the Claude column of the Test Case Time table (an allocation, disclosed on the page).
- `ai_operation_detail` (optional, one per operation): `{"type":"ai_operation_detail","operation":"<same name as the ai_operation>","steps":["..."]}` — plain-prose steps shown in that operation's popup.
- Durations under 1 s are displayed in milliseconds, under 10 s with two decimals, under a minute with one decimal; the cards keep whole-second rounding and the Execution Phases table's Total Reporting Time footer shows both ("5.60s (card: 6s rounded)").

## Additions 2026-10-19 (project type: UI vs API)

All optional/additive; read by `scripts/project-type.js` (see SKILL.md "Project type").

- `run_start.test_kind` / `test_case.test_kind` — `"ui"` or `"api"`, the type the producer declares. It is only a label: the renderer detects the type from the data and, when the data contradicts the label, corrects it and prints `WARNING type mismatch`. The line's value wins over `run_start`'s; either is also the fallback when the data is ambiguous.
- `screenshots` (on a `test_case`, a `hops[]` step, an `attempts[]` entry, or a `finding`) — `[{"path":"shots/tc-ui-01-annotated.png","label":"Annotated screenshot","annotated":true}]`. `path` is relative to the report; a `.png/.jpg/.jpeg/.gif/.webp/.webm/.mp4/.mov` path counts as UI evidence. `annotated:true` marks the copy with the red outline on the failure. On a FAIL only annotated entries are rendered when any exist (otherwise all are shown as captured); a PASS renders all of them (e.g. `"label":"Final UI state (PASS)"`).
- Evidence file names and labels follow the convention in SKILL.md "Evidence naming" (`<TC-ID>_<what-was-checked>_PASS.png`; `..._FAIL_<BUG-ID>_<bug-name>.png` on failures). `scripts/name-evidence.js` produces them and rewrites `path`/`label` in place once the bug ids are known.
- UI steps reuse `hops[]`: `{"hop":1,"step":"Submit wrong password","observed":"...","expected":"...","verdict":"FAIL","evidence":"...","screenshots":[...]}` — `step` falls back to `endpoint`, `observed` to `actual`. A step with no `request_full` and no HTTP-shaped `request_summary` is a UI signal. `"is_wait":true` marks an explicit UI wait (also a UI signal).
- For a UI test case the three request-shaped fields keep their names (`endpoint_or_flow`, `request_summary`, `response_summary`) but are displayed as **Feature / Steps performed / Observed**. UI test cases need no `request_full`/`response_full`.
