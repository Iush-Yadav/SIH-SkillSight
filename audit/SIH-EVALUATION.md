# SkillSight — functional audit and SIH evaluation

Date: 3 October 2026 (Asia/Kolkata). Scope: local project at /Users/ayush/SIH, Chromium desktop and mobile emulation. Application source and existing tests were not changed. Audit scripts and evidence are in this directory. The production build was regenerated.

## Verdict

A polished, mostly working browser-local prototype with a real opt-in AI inference path. It is not yet a complete real-time training-centre compliance system. The core competition risk is the gap between an effective dashboard demonstration and evidence of operation on real centre footage. Fix the data-integrity defects before adding a differentiator.

## Verification evidence

| Check | Result |
|---|---|
| `npm test` | 58/58 passed |
| `npm run build` | Passed; lazy vision-engine chunk is 1.93 MB uncompressed / 312 KB gzip, excluding external model weights |
| `npm run test:e2e` | 36/37 passed |
| Failed existing browser test | `tests/workflows.spec.js:60`: label `State` matches both directory filter and onboarding input. Test locator defect; not proof of broken onboarding. |
| Independent onboarding check | Created TC-AUDIT-900, reloaded, confirmed persisted notes, offline status and unknown inventory observations |
| Direct browser navigation | Overview, Live monitor, Training centres, Infrastructure, Alerts & review and Reports rendered without desktop horizontal overflow |
| Desktop runtime | No page errors or failed requests captured during the independent successful audit |
| Mobile | 390px overview visually inspected and no horizontal overflow; existing tests also cover selected 320px workflows |
| Real AI | Downloaded actual COCO-SSD weights, analyzed a generated blank PNG, returned zero people/chairs, saved the result successfully; no detector stub in this audit |
| Workflow coverage from existing tests | Settings, edits, scoped exports, report archive/reload/downloads, evidence snapshots, notifications, blocked storage, inventory reviews, tracking controls, reduced motion and malformed media |

Real inference on a blank image only verifies model download, execution and persistence. It does not establish detection accuracy. Existing tracking inference tests use a stub. Consented real-world footage, positive people/chair samples, crowded video, low light, occlusion, long sessions, real device performance, cross-browser support and load testing remain unverified. There is no backend or real camera ingestion in this project to test.

## Findings

### High: Saving an AI result can overwrite the attendance register with zero

`VisionLab.jsx:27` accepts only `onResult`, ignoring the `centre` prop supplied by App. Its claimed attendance starts at `'0'` (line 44). `appState.js:122` then copies that value into the centre's saved register when an analysis is saved. A reviewer can load footage and save counts without realizing they replaced an existing submitted attendance value. The direct real-model audit checks the seeded register of 40 before and after this workflow; see browser-results.json.

Fix: initialize comparison from the selected centre's actual register and preserve the register when saving a visual observation. Make register editing a separate explicit action. This also avoids leaving the mounted register form out of sync after an AI save.

### High: Automatic count updates do not create threshold alerts

Reproduction in logic-results.json: clear alerts, set submitted attendance to 36 and observed attendance to 27 with threshold 10; run one downward simulation tick. Observed attendance becomes 26, but alerts remain empty. `simulateTick` updates counts without invoking mismatch evaluation (`appState.js:176`). Saves invoke evaluation, ticks do not. Changing the threshold also does not re-evaluate current observations.

Fix: evaluate discrepancies consistently on observation ingestion and policy changes. For a real monitoring system, use a persistence window and deduplication to avoid noisy single-frame alerts.

### Medium: Dashboard and reports disagree about local AI observations at offline centres

Save an observation of 20 people at the offline Udaipur centre. The overview includes it because it checks only non-null counts (`App.jsx:59`). The report excludes it because it requires an online connection (`reports.js:152`). The result is 20 observed on the dashboard but an unavailable observation in the scoped report.

Fix: distinguish camera connectivity from availability/freshness of a locally analyzed observation, then use one shared eligibility policy in dashboard and reports. Saving an uploaded image should not pretend to bring a camera online.

### Capability gap: AI infrastructure observations are not integrated

Saving an analysis containing two chairs leaves the seeded seating inventory at 48/48. The chair count is retained only in the analysis summary. Workbench, computer and trade-equipment counts are seeded demo data; specialist detection and machinery operability inference are absent.

Do not blindly replace centre-wide inventory with objects visible in one frame. Add an explicit camera/zone-to-inventory mapping, source timestamps, coverage handling and human confirmation. Separate synthetic inventory provenance from real attendance provenance.

## Evaluator assessment

Strengths: clear visual hierarchy; usable mobile layout; connected review, evidence and reporting workflows; meaningful validation and storage failure handling; aggregate counting rather than face identification; explicit simulation and AI limitations.

Weaknesses: no live camera pipeline; no central persistence, authenticated reviewer roles or cross-device audit trail; no measured field accuracy; no proven offline synchronization; no automated specialist infrastructure verification. The low-resource option slows local demo updates, which is not evidence of reduced camera-network bandwidth. The chart is a disclosed synthetic series, not captured attendance history.

Official SIH 2024 guidance names novelty, feasibility, practicability, sustainability, scale of impact, user experience and future progression. It is used here as historical evaluation context, not as an asserted 2026 weighted rubric: https://sih.gov.in/letters/Guidelines-College-SPOC.pdf

The project identifies itself as SIH26245. A public mirror describes camera-based attendance/infrastructure monitoring under bandwidth and privacy constraints: https://zaidsayyed.in/tools/sih-problem-statements/sih26245 . The official 2026 statement was not independently retrieved, so confirm the exact text against your submission before finalizing the pitch.

## Single highest-impact addition

**An offline-capable session attendance evidence engine.**

Turn continuous observations from a real camera or consented recording into a defensible session-level discrepancy, instead of relying on a single headcount. One coherent workflow:

1. Select the scheduled training session and submitted attendance.
2. Process periodic frames locally and aggregate visible-person counts over time. Mark unusable/occluded intervals as unknown rather than zero.
3. Measure occupancy duration and visible-person-minutes against claimed learner-minutes. These are aggregate indicators, not proof of individual attendance; instructors, visitors and camera coverage must be accounted for.
4. Raise a review case only for a sustained mismatch. Store observation times, coverage, source/model version, configured threshold and reviewer outcome.
5. Queue summaries during a network outage and synchronize them exactly once when connectivity returns. Send compact summaries rather than continuous raw video.

Suggested judge demonstration: declare a small session count, have some consenting participants leave, show a sustained discrepancy automatically creating a review case, interrupt connectivity, continue local collection, reconnect and show the queued case in the central dashboard without duplicates. Export the same evidence the reviewer sees.

Suggested acceptance measurements: count error against manually labeled footage; discrepancy precision/recall and alert latency; missed/unknown coverage; bytes transferred per centre-hour; recovery without data loss or duplicate events; performance on the actual low-cost target device. Publish measured values rather than invented accuracy percentages.

This would strengthen feasibility, practical impact and technical depth while directly extending the existing privacy-first concept. It cannot guarantee a competition win. Real specialist inventory verification remains a separate baseline requirement to address if the official statement requires it.

## Files

- browser-results.json: independent browser observations and real AI smoke test
- logic-results.json: reproducible functional inconsistency probes
- desktop.png, mobile.png, vision.png: inspected screenshots
- browser-audit.mjs, logic-probes.mjs: audit reproduction scripts

Run the scripts from the project root. The browser script needs the local Vite server at http://127.0.0.1:5173 and uses an isolated browser context, so audit records do not alter an existing personal browser workspace.
