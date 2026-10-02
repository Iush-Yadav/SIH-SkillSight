# Session evidence — local prototype

Start with `npm run dev`, then open http://127.0.0.1:5173 and select **Session evidence**.

1. Choose the centre and discrepancy settings. Submitted attendance is copied from the register; change it in Live monitor if needed.
2. Select **Use camera** (browser permission required), or upload a consented video.
3. Start the evidence session while connected so COCO-SSD can download its weights. After loading, frames are analyzed locally without uploading video. A confidence cutoff of 50% filters people detections.
4. A sustained difference creates a review case. Mark obstructed/unreliable views as unknown. End the session to save a review outcome and export its JSON evidence.
5. Disconnect the network, or pause synchronization with the labelled demonstration switch. Collection continues while this page and its loaded model stay open. Reconnect to synchronize the retained queue.

## Persistence and calculations

- Browser queue: `skillsight-sessions-v1` in localStorage; maximum eight retained sessions, maximum 3,600 observations / one hour per session. Remove synchronized local copies to free space; their server records remain.
- Shared localhost archive: `server-data/sessions.json`, written atomically by the Vite API plugin. The same API is included in `npm run preview`. Deploying only `dist/` to a static host does not deploy this API.
- `GET /api/sessions` returns summaries; `POST /api/sessions` receives incremental batches of at most 100 observations. The server validates immutable metadata, rejects conflicting samples, deduplicates retries and recalculates metrics. Browser acknowledgements never remove newer unsent observations.
- Coverage uses adjacent usable observations separated by no more than five seconds. Unknown observations, background tabs and longer gaps break sustained-mismatch windows. Visible-person-minutes use the preceding count over each usable interval; claimed-person-minutes use the same coverage denominator.
- Reload recovers unfinished sessions as interrupted at the last persisted observation. It does not invent measurements during downtime. An offline page reload/model cold start is not supported; keep the loaded page open.
- Evidence records contain source type, model/version label, confidence cutoff, timestamps, thresholds, counts, coverage, first sustained discrepancy and optional reviewer note. No media, faces or person identities are stored. Source clips are not authenticated; camera and recording sources are explicitly distinguished.
- Counts are aggregate occupancy signals, not verified trainee attendance. Instructors/visitors, occlusion, lighting and detector error affect results. Equipment operability is not inferred.
- The server is intended for localhost demonstrations, with same-origin writes and no user authentication. Production deployment needs authenticated roles, device identity, a managed database, retention policy and transport security. Unrelated legacy centre workflows still use browser-local storage.

## Defect fixes

AI saves preserve the submitted register; the comparison starts with the actual centre claim. Chair observations update seating only when the reviewer explicitly confirms the entire seating area is visible. Inventory remains separate from human verification and machinery operability.

Count ticks and threshold changes evaluate mismatch alerts. Saved local AI observations remain available even when camera connectivity is offline, consistently across overview, centre directory, infrastructure and reports.

## Verification

`npm test`, `npm run test:e2e`, `npm run build`.

Session browser coverage uses Chromium's synthetic camera with a controlled detector to verify sustained thresholds, actual browser network disconnection, retry/idempotency, persisted review outcomes, reload, shared archive and mobile layout. `audit/session-real.mjs` smoke-tests the actual downloaded detector with a synthetic camera. Neither constitutes a field-accuracy benchmark; use manually annotated consented footage before claiming precision/recall or attendance accuracy.
