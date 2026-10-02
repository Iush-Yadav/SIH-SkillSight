# Vision Lab

`VisionLab` is an independent, browser-only analytics panel for the SkillSight training centre dashboard. It uses the real COCO-SSD object detector, but deliberately does not present a general object detector as a specialist safety or attendance system.

## Integration

```jsx
import VisionLab from './components/VisionLab'

function TrainingCentreOverview() {
  function handleVisionResult(result) {
    // Persist or add the summary to the dashboard here.
    // result contains counts and metadata only, never the selected file.
    console.log(result)
  }

  return <VisionLab onResult={handleVisionResult} />
}
```

`onResult` is called **only** when the user clicks **Save count summary** after a successful analysis. Its payload is:

```js
{
  persons: Number,
  chairs: Number,
  claimed: Number,
  source: 'coco-ssd',
  timestamp: String // ISO timestamp for the analyzed frame
}
```

The callback may be synchronous or return a promise. The component shows a success or retry state around either form.

## Behavior

1. The dashboard bundle does not load TensorFlow or COCO-SSD at startup. The user must click **Load AI model**. That explicit action dynamically imports `@tensorflow/tfjs` and `@tensorflow-models/coco-ssd`, initializes WebGL when available (CPU fallback), and downloads the detector weights on the first load.
2. The user chooses an image or video using a local file input. The component creates a temporary browser `objectURL`; it never uploads the file or sends it to an application endpoint. The URL is revoked when media is replaced, removed, or the component unmounts.
3. Images run when **Analyze image** is clicked. Videos run only after **Start analysis** is clicked, sample no more than once per second, and can be paused. Native video controls are preview-only unless the analysis button is running.
4. The overlay and counts include only COCO-SSD's `person` and `chair` classes. Visible people receive five-digit, in-memory track IDs and motion trails. Geometric assignment uses predicted motion and one-to-one bounding-box matching; it does not identify faces. The confidence control filters displayed and aggregated detections from the latest frame; it does not change the model or create new IDs.
5. Attendance comparison is a transparent arithmetic comparison: `detected persons - claimed attendance`. A zero difference displays **Counts match** (not a claim that attendance was verified).

## Privacy and limitations

- Raw image/video bytes remain in the browser and are not included in `onResult`.
- No face recognition, personal identity matching, biometric processing, or webcam access is used. Temporary geometric track IDs are not people's identities and are never included in saved summaries.
- No media is persisted by `VisionLab`; the parent should avoid persisting it too.
- COCO-SSD is a general-purpose pretrained detector. It can miss or misclassify objects, and a video count is a count of visible detections in the latest sampled frame, not unique attendance across time.
- Video IDs persist across consecutive matched samples, with a 2.2-second media-time grace period for missed detections. Departed IDs are retired; seeking, changing/removing media or inference errors reset tracks. New IDs are not reused within the page session. Slow sampling, crossings, occlusion and fast movement can cause ID switches; there is no re-identification or cross-camera matching.
- The dashboard's **Camera 01 · training floor** is a separate, explicitly simulated interactive scene, not footage or a live AI inference result. Its motion paths exercise the same tracker at approximately 15 updates/second with a 700ms exit grace period. Pause, playback speed, boxes/trails/zones, entry/exit, inspection and expanded view are interactive. The centre-wide count is separately labeled and not inferred from demo people.
- Reduced-motion preferences pause the demo initially and remove decorative animation. Users may explicitly start it. Tracks reset on centre change, demo reset, or leaving the monitor; no tracking state is persisted.
- It cannot verify specialist machinery, equipment condition, safe operation, or operability. Human review is required for those decisions.
- Unsupported or damaged media reports a codec/decoding message. For video, an H.264 MP4 or browser-supported WebM is a practical fallback; renaming a file extension does not convert its codec.

## Resource lifecycle

The component guards lazy model loading and frame inference against unmount/media changes, stops timers and playback, revokes object URLs, and disposes the detector on unmount. COCO-SSD owns the tensors created by `model.detect`; the component retains no tensor. In-flight inference is allowed to settle before the model is disposed so a detector is not torn down underneath an active operation.

## Prototype verification

The project checks are `npm test`, `npm run test:e2e` and `npm run build`. `playwright.config.js` restricts browser discovery to `*.spec.js` and can reuse the local Vite server.

- `tests/tracking.test.js` checks geometric ID continuity through movement/reordered detections and a simple crossing, disappearance/grace periods, non-reused IDs, bounded trails, clock resets, and the demo entry/exit lifecycle.
- `tests/tracking.spec.js` checks the connected camera UI: selection, local/global pause, entry/exit/reset, overlay controls, speed, expanded view, offline centres, mobile layout and reduced motion. Vision Lab checks cover opt-in loading/media errors plus overlay ID continuity and media replacement using an explicitly stubbed detector. The stub does **not** validate COCO-SSD inference accuracy.
- `tests/chart.test.js` and `tests/chart.spec.js` check the interactive synthetic attendance chart: exact count geometry/variance, range, line/bar modes, protected series toggles, pointer/keyboard/touch interaction, responsive sizing, invalid/empty data and reduced motion.
- Real-world video tracking accuracy, crowded crossings, prolonged occlusion and model download/inference on all target devices still require consented footage and manual evaluation. IDs must not be treated as verified attendance.

The parent app must provide the dependencies; this component intentionally does not edit `package.json`:

```sh
npm install @tensorflow/tfjs @tensorflow-models/coco-ssd lucide-react
```
