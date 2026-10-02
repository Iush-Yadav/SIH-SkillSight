import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight, Check, ChevronRight, CircleHelp, Download, ImagePlus,
  LoaderCircle, Pause, Play, ScanLine, ShieldCheck, SlidersHorizontal,
  Upload, Users, Armchair, X, AlertCircle, FileVideo, Save,
} from 'lucide-react'
import './vision.css'
import { createPersonTracker } from './personTracker.js'

const MIN_CONFIDENCE = 0.2
const FRAME_INTERVAL_MS = 1000
const SUPPORTED_CLASSES = new Set(['person', 'chair'])

function releaseModel(model) {
  try { model?.dispose() } catch { /* A partially initialized backend may already be gone. */ }
}

function mediaKind(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (!file.type && /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)) return 'image'
  if (!file.type && /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(file.name)) return 'video'
  return null
}

/** Local-only media analysis. The parent receives counts only after an explicit save. */
export default function VisionLab({ onResult, centre }) {
  const inputId = useId()
  const thresholdId = useId()
  const claimedId = useId()
  const [modelStatus, setModelStatus] = useState('idle')
  const [modelError, setModelError] = useState('')
  const [media, setMedia] = useState(null)
  const [mediaReady, setMediaReady] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [analysisError, setAnalysisError] = useState('')
  const [dimensions, setDimensions] = useState({ width: 16, height: 10 })
  const [predictions, setPredictions] = useState([])
  const [hasResult, setHasResult] = useState(false)
  const [capturedAt, setCapturedAt] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [running, setRunning] = useState(false)
  const [threshold, setThreshold] = useState(0.5)
  const [claimed, setClaimed] = useState(String(centre?.claimed ?? 0))
  const [applyChairs, setApplyChairs] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState('')
  const [saveError, setSaveError] = useState('')

  const mountedRef = useRef(false)
  const lifecycleRef = useRef(0)
  const modelRef = useRef(null)
  const loadingRef = useRef(false)
  const imageRef = useRef(null)
  const videoRef = useRef(null)
  const mediaRef = useRef(null)
  const mediaReadyRef = useRef(false)
  const mediaSequenceRef = useRef(0)
  const objectUrlRef = useRef(null)
  const timerRef = useRef(null)
  const runRequestedRef = useRef(false)
  const runSequenceRef = useRef(0)
  const seekSequenceRef = useRef(0)
  const inferenceBusyRef = useRef(false)
  const inferencePromiseRef = useRef(null)
  const savingRef = useRef(false)
  const trackerRef = useRef(createPersonTracker({ maxLostMs: 2200, trailLength: 12 }))

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      lifecycleRef.current += 1
      runSequenceRef.current += 1
      runRequestedRef.current = false
      window.clearTimeout(timerRef.current)
      const video = videoRef.current
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
      // Do not dispose weights underneath an in-flight detect() operation.
      const model = modelRef.current
      modelRef.current = null
      const pending = inferencePromiseRef.current
      if (pending) pending.then(() => releaseModel(model), () => releaseModel(model))
      else releaseModel(model)
    }
  }, [])

  const stopAnalysis = useCallback(() => {
    runRequestedRef.current = false
    runSequenceRef.current += 1
    window.clearTimeout(timerRef.current)
    timerRef.current = null
    videoRef.current?.pause()
    if (mountedRef.current) setRunning(false)
  }, [])

  const clearResult = useCallback(() => {
    trackerRef.current.reset()
    setPredictions([])
    setHasResult(false)
    setCapturedAt(null)
    setSaveFeedback('')
    setSaveError('')
  }, [])

  async function loadModel() {
    if (loadingRef.current || modelRef.current) return
    loadingRef.current = true
    const lifecycle = lifecycleRef.current
    const current = () => mountedRef.current && lifecycleRef.current === lifecycle
    setModelStatus('loading')
    setModelError('')
    try {
      // Keep TensorFlow and COCO-SSD out of the initial dashboard bundle.
      const [tf, cocoSsd] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/coco-ssd'),
      ])
      if (!current()) return
      let gpuReady = false
      try { gpuReady = await tf.setBackend('webgl') } catch { /* Fall back to CPU. */ }
      if (!current()) return
      if (!gpuReady) await tf.setBackend('cpu')
      await tf.ready()
      if (!current()) return
      const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' })
      if (!current()) {
        releaseModel(model)
        return
      }
      modelRef.current = model
      setModelStatus('ready')
    } catch {
      if (current()) {
        setModelStatus('error')
        setModelError('The detector could not load. Check your connection and allow the model download, then retry. A browser with WebGL or CPU support is required.')
      }
    } finally {
      if (current()) loadingRef.current = false
    }
  }

  function replaceMedia(file) {
    if (!file) return
    const kind = mediaKind(file)
    if (!kind) {
      setMediaError('Choose a local image or video, such as a JPG, PNG, MP4, or WebM file. Other file types cannot be analyzed.')
      return
    }
    stopAnalysis()
    mediaReadyRef.current = false
    const oldVideo = videoRef.current
    if (oldVideo) {
      oldVideo.removeAttribute('src')
      oldVideo.load()
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    clearResult()
    setMediaError('')
    setAnalysisError('')
    setMediaReady(false)
    setDimensions({ width: 16, height: 10 })
    try {
      const url = URL.createObjectURL(file)
      objectUrlRef.current = url
      const next = { url, kind, name: file.name, id: ++mediaSequenceRef.current }
      mediaRef.current = next
      setMedia(next)
    } catch {
      mediaRef.current = null
      setMedia(null)
      setMediaError('This browser could not open the local file. Try a smaller file or a current browser.')
    }
  }

  function removeMedia() {
    stopAnalysis()
    mediaReadyRef.current = false
    mediaRef.current = null
    if (videoRef.current) {
      videoRef.current.removeAttribute('src')
      videoRef.current.load()
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setMedia(null)
    setMediaReady(false)
    setMediaError('')
    setAnalysisError('')
    clearResult()
  }

  function markMediaReady(id, element) {
    if (!mountedRef.current || mediaRef.current?.id !== id) return
    const width = element.videoWidth || element.naturalWidth
    const height = element.videoHeight || element.naturalHeight
    if (!width || !height) return
    setDimensions({ width, height })
    mediaReadyRef.current = true
    setMediaReady(true)
    setMediaError('')
  }

  function failMedia(id, kind) {
    if (!mountedRef.current || mediaRef.current?.id !== id) return
    stopAnalysis()
    mediaReadyRef.current = false
    setMediaReady(false)
    clearResult()
    setMediaError(kind === 'video'
      ? 'This video could not be decoded. Its codec may not be supported by your browser, or the file may be damaged. Try an H.264 MP4 or a WebM file; renaming the extension will not convert it.'
      : 'This image could not be decoded. Try a valid JPG, PNG, or WebP image instead.')
  }

  const detectFrame = useCallback(async () => {
    const source = mediaRef.current
    const model = modelRef.current
    if (!mountedRef.current || !source || !model || !mediaReadyRef.current || inferenceBusyRef.current) return
    const element = source.kind === 'image' ? imageRef.current : videoRef.current
    if (!element || (source.kind === 'video' && (element.readyState < 2 || element.seeking))) return
    if (source.kind === 'image' && (!element.complete || !element.naturalWidth)) return
    const lifecycle = lifecycleRef.current
    const run = runSequenceRef.current
    const seek = seekSequenceRef.current
    const current = () => mountedRef.current && lifecycleRef.current === lifecycle
      && mediaRef.current?.id === source.id && runSequenceRef.current === run
      && seekSequenceRef.current === seek
    inferenceBusyRef.current = true
    setAnalyzing(true)
    setAnalysisError('')
    const timestamp = new Date().toISOString()
    const trackingTime = source.kind === 'video' ? element.currentTime * 1000 : performance.now()
    try {
      // COCO-SSD owns/disposes its input and intermediate tensors. No tensor is retained here.
      const pending = model.detect(element, 100, MIN_CONFIDENCE)
      inferencePromiseRef.current = pending
      const detected = await pending
      if (current()) {
        const supported = detected.filter((item) => SUPPORTED_CLASSES.has(item.class))
        const people = supported.filter(item => item.class === 'person')
        const tracked = trackerRef.current.update(people, trackingTime).tracks.filter(track => track.visible)
        const tracksByDetection = new Map(tracked.map(track => [track.detectionIndex, track]))
        let personIndex = 0
        setPredictions(supported.map(item => {
          if (item.class !== 'person') return item
          const track = tracksByDetection.get(personIndex++)
          return { ...item, trackId: track?.id, trail: track?.trail || [] }
        }))
        setCapturedAt(timestamp)
        setHasResult(true)
        setSaveFeedback('')
        setSaveError('')
      }
    } catch {
      if (current()) {
        stopAnalysis()
        trackerRef.current.reset()
        setPredictions([])
        setHasResult(false)
        setAnalysisError('Analysis stopped because this frame could not be processed. Try again, use a smaller image/video, or reload the page if your graphics context was lost.')
      }
    } finally {
      inferenceBusyRef.current = false
      inferencePromiseRef.current = null
      if (mountedRef.current && lifecycleRef.current === lifecycle) setAnalyzing(false)
    }
  }, [stopAnalysis])

  async function startVideoAnalysis() {
    if (runRequestedRef.current || inferenceBusyRef.current || !modelRef.current || !mediaReadyRef.current) return
    const video = videoRef.current
    if (!video) return
    const run = ++runSequenceRef.current
    const lifecycle = lifecycleRef.current
    const sourceId = mediaRef.current?.id
    const current = () => mountedRef.current && lifecycleRef.current === lifecycle
      && runRequestedRef.current && runSequenceRef.current === run && mediaRef.current?.id === sourceId
    runRequestedRef.current = true
    setRunning(true)
    setAnalysisError('')
    try {
      if (video.ended) video.currentTime = 0
      await video.play()
      if (!current()) return
      const tick = async () => {
        if (!current()) return
        if (video.paused || video.ended) {
          stopAnalysis()
          return
        }
        await detectFrame()
        if (current()) timerRef.current = window.setTimeout(tick, FRAME_INTERVAL_MS)
      }
      await tick()
    } catch {
      if (current()) {
        stopAnalysis()
        setAnalysisError('The video could not start. Use the video play control, then select Start analysis again. If playback still fails, try an H.264 MP4 or WebM file.')
      }
    }
  }

  const visiblePredictions = useMemo(
    () => predictions.filter((prediction) => prediction.score >= threshold),
    [predictions, threshold],
  )
  const persons = visiblePredictions.filter((prediction) => prediction.class === 'person').length
  const chairs = visiblePredictions.filter((prediction) => prediction.class === 'chair').length
  const claimedNumber = Number(claimed)
  const validClaimed = claimed.trim() !== '' && Number.isSafeInteger(claimedNumber) && claimedNumber >= 0
  const difference = validClaimed && hasResult ? persons - claimedNumber : null
  const canAnalyze = modelStatus === 'ready' && mediaReady && !analyzing
  const canSave = hasResult && validClaimed && typeof onResult === 'function' && !saving
  const overlayScale = Math.max(dimensions.width / 850, dimensions.height / 500, 0.6)

  async function saveResult() {
    if (!canSave || savingRef.current) return
    savingRef.current = true
    const lifecycle = lifecycleRef.current
    const sourceId = mediaRef.current?.id
    setSaving(true)
    setSaveError('')
    setSaveFeedback('')
    try {
      await onResult({ persons, chairs, claimed: claimedNumber, applyChairs, source: 'coco-ssd', timestamp: capturedAt })
      if (mountedRef.current && lifecycleRef.current === lifecycle && mediaRef.current?.id === sourceId) {
        setSaveFeedback(`Saved ${persons} detected ${persons === 1 ? 'person' : 'people'} and ${chairs} ${chairs === 1 ? 'chair' : 'chairs'}. No media was included.`)
      }
    } catch {
      if (mountedRef.current && lifecycleRef.current === lifecycle && mediaRef.current?.id === sourceId) {
        setSaveError('The count summary could not be saved. Your media is still local; please retry.')
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current && lifecycleRef.current === lifecycle) setSaving(false)
    }
  }

  return (
    <section className="vl-root" aria-labelledby={`${inputId}-title`}>
      <header className="vl-heading">
        <div>
          <div className="vl-eyebrow"><span className="vl-blue-dot" /> THE VISION LAB <span className="vl-eyebrow-rule" /> LIVE AI</div>
          <h2 id={`${inputId}-title`}>A clearer picture.<br /><span>Not another guess.</span></h2>
          <p>Count visible people and chairs in centre footage with a real, browser-based object detector. Your files stay with you.</p>
        </div>
        <span className="vl-privacy-badge"><ShieldCheck size={16} aria-hidden="true" /> On-device processing</span>
      </header>

      <div className="vl-model-bar">
        <div className={`vl-model-icon ${modelStatus === 'ready' ? 'vl-model-icon-ready' : ''}`}><ScanLine size={22} aria-hidden="true" /></div>
        <div className="vl-model-copy">
          <strong>COCO-SSD <span> / Lite MobileNet V2</span></strong>
          <p>{modelStatus === 'ready' ? 'Detector ready. Choose a local file to get started.' : modelStatus === 'loading' ? 'Downloading and preparing model weights. The first load may take a moment.' : 'Load the real detector when you need it. Nothing runs automatically.'}</p>
        </div>
        <button className={`vl-button ${modelStatus === 'ready' ? 'vl-button-ready' : 'vl-button-dark'}`} onClick={loadModel} disabled={modelStatus === 'loading' || modelStatus === 'ready'}>
          {modelStatus === 'loading' ? <LoaderCircle className="vl-spin" size={16} aria-hidden="true" /> : modelStatus === 'ready' ? <Check size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {modelStatus === 'loading' ? 'Loading model…' : modelStatus === 'ready' ? 'Model ready' : modelStatus === 'error' ? 'Retry model load' : 'Load AI model'}
        </button>
      </div>
      <p className="vl-download-note">On first load, model weights download from external Google-hosted servers. Images and videos are never uploaded by this lab.</p>
      {modelError && <div className="vl-alert" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{modelError}</span></div>}

      <div className="vl-workspace">
        <div className="vl-viewer-card">
          <div className="vl-panel-heading">
            <div><span className="vl-step">01</span><h3>Local media</h3></div>
            <span className="vl-local-indicator"><span /> BROWSER ONLY</span>
          </div>
          <input id={inputId} className="vl-file-input" type="file" accept="image/*,video/*" aria-label="Choose an image or video from your device" onChange={(event) => { replaceMedia(event.target.files?.[0]); event.target.value = '' }} />
          <div className={`vl-stage ${media ? 'vl-stage-populated' : ''}`}>
            {!media ? (
              <label htmlFor={inputId} className="vl-empty-state">
                <span className="vl-empty-art"><span className="vl-corner vl-corner-tl" /><span className="vl-corner vl-corner-tr" /><span className="vl-corner vl-corner-bl" /><span className="vl-corner vl-corner-br" /><ImagePlus size={38} strokeWidth={1.3} aria-hidden="true" /><span className="vl-art-dot" /></span>
                <strong>Bring your centre into focus.</strong>
                <span>Choose a photo or video from your device.<br />No upload. No cloud storage.</span>
                <span className="vl-button vl-button-primary"><Upload size={15} aria-hidden="true" /> Choose local file <ArrowUpRight size={15} aria-hidden="true" /></span>
                <span className="vl-file-hint">JPG, PNG, MP4, WEBM & OTHER BROWSER-SUPPORTED FILES</span>
              </label>
            ) : (
              <>
                <div className="vl-media-frame" style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}`, maxWidth: `${440 * dimensions.width / dimensions.height}px` }}>
                  {media.kind === 'image' ? (
                    <img key={media.id} ref={imageRef} src={media.url} alt={`Local analysis preview: ${media.name}`} onLoad={(event) => markMediaReady(media.id, event.currentTarget)} onError={() => failMedia(media.id, 'image')} />
                  ) : (
                    <video key={media.id} ref={videoRef} src={media.url} controls muted playsInline preload="auto" aria-label={`Local video preview: ${media.name}`} onLoadedData={(event) => markMediaReady(media.id, event.currentTarget)} onError={() => failMedia(media.id, 'video')} onPause={() => { if (runRequestedRef.current) stopAnalysis() }} onEnded={stopAnalysis} onSeeking={() => { seekSequenceRef.current += 1; clearResult() }} />
                  )}
                  {mediaReady && hasResult && <svg className="vl-overlay" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} aria-hidden="true">
                    {visiblePredictions.map((prediction, index) => {
                      const [rawX, rawY, rawWidth, rawHeight] = prediction.bbox
                      const x = Math.max(0, rawX)
                      const y = Math.max(0, rawY)
                      const width = Math.max(0, Math.min(rawWidth, dimensions.width - x))
                      const height = Math.max(0, Math.min(rawHeight, dimensions.height - y))
                      const label = `${prediction.class === 'person' ? `#${prediction.trackId || '—'} · person` : 'Chair'} ${Math.round(prediction.score * 100)}%`
                      const labelWidth = (prediction.class === 'person' ? 164 : 96) * overlayScale
                      const labelHeight = 23 * overlayScale
                      const labelX = Math.min(x, Math.max(0, dimensions.width - labelWidth))
                      const labelY = Math.min(Math.max(0, y - labelHeight), Math.max(0, dimensions.height - labelHeight))
                      return <g key={prediction.trackId || `${prediction.class}-${index}`} className={prediction.class === 'chair' ? 'vl-box-chair' : 'vl-box-person'}>
                        {prediction.trail?.length > 1 && <polyline points={prediction.trail.map(point => point.join(',')).join(' ')} fill="none" stroke="currentColor" strokeOpacity=".75" strokeDasharray={`${4 * overlayScale} ${3 * overlayScale}`} strokeWidth={2 * overlayScale} />}
                        <rect x={x} y={y} width={width} height={height} fill="none" stroke="currentColor" strokeWidth={2 * overlayScale} />
                        <rect x={labelX} y={labelY} width={labelWidth} height={labelHeight} rx={3 * overlayScale} fill="currentColor" />
                        <text x={labelX + 7 * overlayScale} y={labelY + 15 * overlayScale} fontSize={12 * overlayScale} fill="white">{label}</text>
                      </g>
                    })}
                  </svg>}
                </div>
                {!mediaReady && !mediaError && <span className="vl-media-loading" role="status"><LoaderCircle size={18} className="vl-spin" aria-hidden="true" /> Decoding local media…</span>}
                {mediaError && <div className="vl-media-failed"><AlertCircle size={28} aria-hidden="true" /><span>Preview unavailable</span></div>}
              </>
            )}
          </div>
          <div className="vl-viewer-footer">
            <div className="vl-file-name">{media?.kind === 'video' ? <FileVideo size={16} aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}<span title={media?.name}>{media ? media.name : 'Your footage. Your device.'}</span></div>
            {media ? <div className="vl-file-actions"><label className="vl-text-action" htmlFor={inputId}>Replace</label><button className="vl-icon-button" type="button" onClick={removeMedia} aria-label="Remove local media"><X size={17} aria-hidden="true" /></button></div> : <span className="vl-footer-note">No file selected</span>}
          </div>
          <div className="vl-analysis-controls">
            <div className="vl-analysis-status" role="status"><span className={`vl-status-dot ${running ? 'vl-status-dot-active' : ''}`} />{running ? 'Sampling video frames' : analyzing ? 'Analyzing image…' : hasResult ? 'Latest frame analyzed' : 'Ready when you are'}</div>
            <button className="vl-button vl-button-primary" type="button" disabled={running ? false : !canAnalyze} onClick={media?.kind === 'video' ? running ? stopAnalysis : startVideoAnalysis : detectFrame}>
              {running ? <Pause size={16} aria-hidden="true" /> : analyzing ? <LoaderCircle className="vl-spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {running ? 'Pause analysis' : analyzing ? 'Analyzing…' : media?.kind === 'video' ? 'Start analysis' : hasResult ? 'Analyze again' : 'Analyze image'}
            </button>
          </div>
          <p className="vl-playback-note">{media?.kind === 'video' ? 'Sampled tracking: five-digit IDs and trails follow geometric motion, at most once per second. Brief missed detections have a 2.2s grace period; exits, seeking or changing files end tracks. Preview controls alone do not analyze.' : 'Load the AI model and choose a file, then run analysis. Only people and chairs are highlighted.'}</p>
          {mediaError && <div className="vl-alert vl-inner-alert" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{mediaError}</span></div>}
          {analysisError && <div className="vl-alert vl-inner-alert" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{analysisError}</span></div>}
        </div>

        <aside className="vl-results-card" aria-labelledby={`${inputId}-results`}>
          <div className="vl-panel-heading"><div><span className="vl-step">02</span><h3 id={`${inputId}-results`}>The breakdown</h3></div><SlidersHorizontal size={17} aria-hidden="true" /></div>
          <div className="vl-results-body">
            <div className="vl-count-grid">
              <div className="vl-count-card"><Users size={19} aria-hidden="true" /><strong>{hasResult ? persons.toString().padStart(2, '0') : '—'}</strong><span>People detected</span></div>
              <div className="vl-count-card"><Armchair size={19} aria-hidden="true" /><strong>{hasResult ? chairs.toString().padStart(2, '0') : '—'}</strong><span>Chairs detected</span></div>
            </div>
            <p className="vl-count-caption">{hasResult ? 'Visible objects in the latest analyzed frame. Not unique attendance.' : 'Real counts will appear after analysis. No sample results.'}</p>
            <div className="vl-setting-block">
              <div className="vl-setting-label"><label htmlFor={thresholdId}>Confidence threshold</label><output htmlFor={thresholdId}>{Math.round(threshold * 100)}%</output></div>
              <input id={thresholdId} className="vl-range" type="range" min={MIN_CONFIDENCE} max="0.9" step="0.05" value={threshold} onChange={(event) => { setThreshold(Number(event.target.value)); setSaveFeedback('') }} aria-describedby={`${thresholdId}-hint`} style={{ '--vl-range-fill': `${(threshold - MIN_CONFIDENCE) / 0.7 * 100}%` }} />
              <p id={`${thresholdId}-hint`}>Higher confidence means fewer, more certain detections. It does not guarantee accuracy.</p>
            </div>
            <div className="vl-setting-block vl-attendance-block">
              <label htmlFor={claimedId}>Claimed attendance</label>
              <div className="vl-number-wrap"><Users size={16} aria-hidden="true" /><input id={claimedId} readOnly={Boolean(centre)} type="number" min="0" step="1" inputMode="numeric" value={claimed} onChange={(event) => { setClaimed(event.target.value); setSaveFeedback('') }} aria-invalid={!validClaimed} aria-describedby={`${claimedId}-hint`} /><span>people</span></div>
              <p id={`${claimedId}-hint`}>{validClaimed ? centre ? 'Saved register. Edit submitted attendance in Live monitor.' : 'Enter the reported count for comparison.' : 'Enter a whole number of 0 or more.'}</p>
            </div>
            <div className={`vl-comparison ${difference !== null && difference !== 0 ? 'vl-comparison-mismatch' : ''}`}>
              <span>COUNT COMPARISON</span>
              <strong>{difference === null ? 'Awaiting a result' : difference === 0 ? 'Counts match' : `${Math.abs(difference)} ${difference < 0 ? 'fewer' : 'more'} detected`}</strong>
              <p>{difference === null ? 'Analyze a frame to compare with the claim.' : `${persons} visible ${persons === 1 ? 'person' : 'people'} / ${claimedNumber} claimed. ${difference === 0 ? 'A match is not attendance verification.' : 'Review the footage before drawing conclusions.'}`}</p>
            </div>
            <label className="vl-save-note"><input type="checkbox" checked={applyChairs} onChange={event => setApplyChairs(event.target.checked)} /> Update seating observation: I confirm the entire seating area is visible in this frame.</label>
            <button type="button" className="vl-button vl-button-dark vl-save-button" disabled={!canSave} onClick={saveResult} title={typeof onResult !== 'function' ? 'Saving is unavailable until the app connects a result handler.' : undefined}>{saving ? <LoaderCircle className="vl-spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}{saving ? 'Saving…' : 'Save count summary'}<ChevronRight size={15} aria-hidden="true" /></button>
            <p className="vl-save-note">Only counts are shared with the dashboard when you save. No raw file is persisted.</p>
            {saveFeedback && <p className="vl-save-success" role="status"><Check size={15} aria-hidden="true" />{saveFeedback}</p>}
            {saveError && <p className="vl-save-error" role="alert">{saveError}</p>}
          </div>
        </aside>
      </div>
      <footer className="vl-limitations"><CircleHelp size={19} aria-hidden="true" /><div><strong>A useful signal. Not the whole story.</strong><p>This general-purpose model can miss people or mistake objects. Temporary IDs use position and motion only; they can switch during crossings, occlusion or fast motion, especially at the sampled frame rate. They are not unique attendance or personal identity. No faces are recognized and equipment operability is not verified. Review context before using a result for a decision.</p></div><span>HUMAN REVIEW<br />ALWAYS MATTERS</span></footer>
    </section>
  )
}
