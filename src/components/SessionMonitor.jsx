import { useEffect, useRef, useState } from 'react';
import { Video, Upload, Play, Square, Download, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { createSession, addSample, summarizeSession, isPending, syncPayload, SESSION_KEY } from '../sessionEngine.js';
import { downloadFile } from '../download.js';
import './sessions.css';

function readSessions() {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSION_KEY) || '[]');
    if (!Array.isArray(sessions) || sessions.some(s => !s.id || !Array.isArray(s.samples) || !Number.isInteger(s.ackCount))) throw new Error('Invalid saved session queue');
    return { sessions: sessions.map(s => s.endedAt ? s : { ...s, endedAt: new Date(Date.parse(s.startedAt) + (s.samples.at(-1)?.elapsedMs || 0)).toISOString(), endReason: 'interrupted', endSynced: false }), error: '' };
  } catch (e) { return { sessions: [], error: `Session queue could not be read: ${e.message}. Export browser data before resetting storage.` }; }
}
const minutes = ms => `${(ms / 60000).toFixed(1)} min`;
export default function SessionMonitor({ centres }) {
  const [initial] = useState(readSessions);
  const [sessions, setSessions] = useState(initial.sessions);
  const records = useRef(initial.sessions);
  const [error, setError] = useState(initial.error);
  const [centreId, setCentreId] = useState(centres[0]?.id || '');
  const centre = centres.find(c => c.id === centreId) || centres[0];
  const [threshold, setThreshold] = useState(3);
  const [duration, setDuration] = useState(15);
  const [source, setSource] = useState('');
  const [sourceLabel, setSourceLabel] = useState('No camera or recording selected');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const active = useRef(null), startedClock = useRef(0), cancelled = useRef(0);
  const video = useRef(null), stream = useRef(null), fileUrl = useRef(null), model = useRef(null), timer = useRef(null);
  const [usable, setUsable] = useState(true), usableRef = useRef(true);
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [lastCount, setLastCount] = useState(null);
  const [syncStatus, setSyncStatus] = useState('Waiting to synchronize');
  const [serverSessions, setServerSessions] = useState([]);
  const syncBusy = useRef(false), mounted = useRef(true);
  const [heldOffline, setHeldOffline] = useState(false), heldRef = useRef(false);
  const activeSession = sessions.find(s => s.id === activeId);
  const summary = activeSession ? summarizeSession(activeSession) : null;
  const pending = sessions.filter(isPending).length;

  function persist(next) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); }
    catch { throw new Error('Session storage is full or blocked. Collection stopped; export saved evidence and free space before retrying.'); }
    records.current = next; setSessions(next);
  }
  function releaseSource() {
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; video.current.removeAttribute('src'); video.current.load(); }
    if (fileUrl.current) URL.revokeObjectURL(fileUrl.current); fileUrl.current = null; setReady(false);
  }
  function finish(reason = 'completed') {
    clearTimeout(timer.current); cancelled.current++; const id = active.current; active.current = null; setActiveId(null);
    if (id) {
      const existing = records.current.find(s => s.id === id);
      const elapsed = Math.min(3600000, Math.max(existing.samples.at(-1)?.elapsedMs || 0, Math.round(performance.now() - startedClock.current)));
      try { persist(records.current.map(s => s.id === id ? { ...s, endedAt: new Date(Date.parse(s.startedAt) + elapsed).toISOString(), endReason: reason, endSynced: false } : s)); }
      catch (e) { setError(e.message); }
    }
    video.current?.pause(); stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    if (source === 'camera') setReady(false);
    void synchronize();
  }
  async function synchronize() {
    if (syncBusy.current || heldRef.current || initial.error) return;
    syncBusy.current = true;
    try {
      // Incremental batches: retrying an already accepted batch is safe.
      for (let batch = 0; batch < 50; batch++) {
        if (heldRef.current) break;
        const session = records.current.find(isPending);
        if (!session) break;
        const response = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(syncPayload(session)), signal: AbortSignal.timeout(8000) });
        const ack = await response.json();
        if (!response.ok) throw new Error(ack.error || 'Server did not accept evidence');
        if (ack.id !== session.id || !Number.isInteger(ack.ackCount) || ack.ackCount < session.ackCount || ack.ackCount > session.samples.length) throw new Error('Invalid server acknowledgement');
        if (!mounted.current) return;
        persist(records.current.map(s => s.id === ack.id ? { ...s, ackCount: ack.ackCount, endSynced: Boolean(s.endedAt && ack.endedAt === s.endedAt), reviewSynced: Boolean(s.review && ack.reviewedAt === s.review.reviewedAt) } : s));
      }
      if (heldRef.current) return;
      const response = await fetch('/api/sessions', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Archive unavailable');
      const data = await response.json();
      if (mounted.current) { setServerSessions(data.sessions); setSyncStatus('Server archive connected'); }
    } catch (e) { if (mounted.current) setSyncStatus(`Waiting to sync — evidence retained locally. ${e.message}`); }
    finally { syncBusy.current = false; }
  }
  useEffect(() => {
    mounted.current = true;
    // Persist recovered interrupted sessions before uploading them.
    if (!initial.error) { try { persist(records.current); } catch (e) { setError(e.message); } }
    void synchronize();
    const interval = setInterval(() => void synchronize(), 10000);
    const online = () => void synchronize(); window.addEventListener('online', online);
    return () => { mounted.current = false; cancelled.current++; clearInterval(interval); clearTimeout(timer.current); window.removeEventListener('online', online); stream.current?.getTracks().forEach(t => t.stop()); if (fileUrl.current) URL.revokeObjectURL(fileUrl.current); };
  }, []);

  async function camera() {
    setError(''); releaseSource(); setSource('camera'); setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires localhost or HTTPS and a supported browser.');
      const input = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!mounted.current) { input.getTracks().forEach(t => t.stop()); return; }
      stream.current = input; video.current.srcObject = input; await video.current.play(); setSourceLabel('Live camera · aggregate counts only'); setReady(true);
      input.getVideoTracks()[0].onended = () => { if (active.current) finish('source-error'); setReady(false); };
    } catch (e) { setError(`Camera unavailable: ${e.message}`); }
    finally { setBusy(false); }
  }
  function selectFile(file) {
    if (!file) return; releaseSource(); setError(''); setSource('recording');
    fileUrl.current = URL.createObjectURL(file); video.current.src = fileUrl.current; setSourceLabel(`Recorded footage · ${file.name}`);
  }
  async function start() {
    setError(''); setBusy(true);
    const generation = cancelled.current;
    try {
      if (initial.error) throw new Error(initial.error);
      if (records.current.length >= 8) throw new Error('Keep up to eight sessions locally. Export and remove a synchronized session first.');
      if (!ready) throw new Error('Choose a working camera or video first.');
      if (!model.current) {
        const [tf, coco] = await Promise.all([import('@tensorflow/tfjs'), import('@tensorflow-models/coco-ssd')]);
        try { await tf.setBackend('webgl'); } catch { await tf.setBackend('cpu'); }
        await tf.ready(); model.current = await coco.load({ base: 'lite_mobilenet_v2' });
      }
      if (!mounted.current || generation !== cancelled.current) return;
      if (source === 'recording') video.current.currentTime = 0;
      await video.current.play();
      const session = createSession({ centreId: centre.id, centreName: centre.name, claimed: centre.claimed, threshold: Number(threshold), sustainedSeconds: Number(duration), source });
      persist([session, ...records.current]); active.current = session.id; setActiveId(session.id); startedClock.current = performance.now();
      const sample = async () => {
        if (active.current !== session.id || generation !== cancelled.current) return;
        try {
          if (performance.now() - startedClock.current >= 3600000 || records.current.find(s => s.id === session.id).samples.length >= 3600) { finish('limit'); return; }
          let count = null;
          if (usableRef.current && !document.hidden && video.current.readyState >= 2 && !video.current.paused) {
            try { const found = await model.current.detect(video.current, 100, .5); count = found.filter(d => d.class === 'person' && d.score >= .5).length; }
            catch { count = null; }
          }
          if (active.current !== session.id || generation !== cancelled.current) return;
          const elapsed = Math.round(performance.now() - startedClock.current);
          if (elapsed > 3600000) { finish('limit'); return; }
          persist(records.current.map(s => s.id === session.id ? addSample(s, elapsed, count) : s)); setLastCount(count);
          timer.current = setTimeout(sample, 1000);
        } catch (e) { setError(e.message); finish('source-error'); }
      };
      void sample();
    } catch (e) { setError(`Could not start session: ${e.message}`); video.current?.pause(); }
    finally { setBusy(false); }
  }

  return <div className="view-stack session-view">
    <section className="panel session-intro"><div><span className="small-eyebrow">Session attendance evidence</span><h2>Presence over time. Evidence you can review.</h2><p>Use a live camera or a consented recording. People are counted locally; only timestamped counts reach the server. Load the model online before disconnecting. Keep this tab open during collection.</p></div><ShieldCheck size={32} /></section>
    <div className="session-columns"><section className="panel session-card"><h2>1. Set up a session</h2><div className="session-fields">
      <label>Session centre<select value={centreId} disabled={Boolean(activeId) || busy} onChange={e => setCentreId(e.target.value)}>{centres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <p>Submitted attendance: <strong>{centre?.claimed ?? 0}</strong>. This is copied into the session and never changes the register.</p>
      <label>Person difference threshold<input type="number" min="1" max="100" value={threshold} disabled={Boolean(activeId) || busy} onChange={e => setThreshold(e.target.value)} /></label>
      <label>Sustained mismatch seconds<input type="number" min="5" max="300" value={duration} disabled={Boolean(activeId) || busy} onChange={e => setDuration(e.target.value)} /></label>
    </div><div className="session-actions"><button className="button button-secondary" disabled={Boolean(activeId) || busy} onClick={camera}><Video size={16} /> Use camera</button><label className="button button-secondary"><Upload size={16} /> Choose video<input aria-label="Session video" type="file" accept="video/*" disabled={Boolean(activeId) || busy} onChange={e => { selectFile(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
      <p className="session-caption">{sourceLabel}</p><video ref={video} muted playsInline controls={!activeId} onLoadedData={() => setReady(true)} onError={() => { setReady(false); setError('Video could not be decoded. Try H.264 MP4 or WebM.'); if (active.current) finish('source-error'); }} onEnded={() => { if (active.current) finish('media-ended'); }} />
      <label className="session-check"><input type="checkbox" checked={!usable} onChange={e => { usableRef.current = !e.target.checked; setUsable(!e.target.checked); }} /> View obstructed / unreliable — mark observations unknown</label>
      <div className="session-actions"><button className="button button-primary" disabled={!ready || busy || Boolean(activeId) || Boolean(initial.error)} onClick={start}><Play size={15} />{busy ? 'Preparing camera / AI…' : 'Start evidence session'}</button><button className="button button-secondary" disabled={!activeId} onClick={() => finish()}><Square size={15} /> End session</button></div>
      <p className="session-caption">First start downloads the AI model. Maximum one hour per session. Recordings run at normal playback speed. Poor visibility must be marked unknown; zero detections alone cannot prove an empty room.</p>
      {error && <p role="alert" className="wf-error">{error}</p>}
    </section><section className="panel session-card"><h2>2. Monitor evidence</h2><div className="session-stats"><div><span>Latest visible people</span><strong>{activeId ? lastCount ?? 'Unknown' : '—'}</strong></div><div><span>Observed coverage</span><strong>{summary ? `${Math.round(summary.coverage * 100)}%` : '—'}</strong></div><div><span>Visible person-minutes</span><strong>{summary?.observedPersonMinutes.toFixed(1) ?? '—'}</strong></div><div><span>Claimed person-minutes*</span><strong>{summary?.claimedPersonMinutes.toFixed(1) ?? '—'}</strong></div></div>
      <p className={summary?.needsReview ? 'session-warning' : 'session-caption'} role="status">{summary?.needsReview ? 'Sustained mismatch detected — human review required.' : activeId ? 'Collecting observations. Only sustained differences create a review case.' : 'Start a session to collect real observations.'}</p>
      <p className="session-caption">*Compared only over usable intervals. Sampling gaps longer than five seconds, hidden tabs and marked obstructions count as unknown coverage. Counts include anyone visible, including instructors; they do not identify individual trainees.</p>
      <div className="session-sync"><h3>Offline queue</h3><strong>{pending} session{pending === 1 ? '' : 's'} awaiting synchronization</strong><p role="status">{heldOffline ? 'Sync paused for outage demonstration. Collection continues locally.' : syncStatus}</p><label className="session-check"><input type="checkbox" checked={heldOffline} onChange={e => { heldRef.current = e.target.checked; setHeldOffline(e.target.checked); if (!e.target.checked) void synchronize(); }} /><WifiOff size={15} /> Pause synchronization (outage demo)</label><button className="button button-secondary" disabled={heldOffline} onClick={() => void synchronize()}><RefreshCw size={15} /> Sync now</button></div>
    </section></div>
    <section className="panel session-card"><h2>3. Local evidence & review cases</h2><p className="session-caption">Interrupted sessions are recovered on reload. Exported evidence contains every count, source, threshold, coverage and the first sustained discrepancy. Raw media is never saved.</p>
      {!sessions.length && <p>No sessions yet. Connect a camera or choose a video above.</p>}
      <div className="session-list">{sessions.map(s => { const result = summarizeSession(s); return <article key={s.id} className="session-record"><div><strong>{s.centreName}</strong><p>{s.source === 'camera' ? 'Live camera' : 'Recorded footage'} · {new Date(s.startedAt).toLocaleString()} · {s.endedAt ? s.endReason : 'Collecting'}</p><p>{s.samples.length} samples · {minutes(result.coveredMs)} usable · {minutes(result.unknownMs)} unknown · average {result.averagePresence?.toFixed(1) ?? 'unknown'} / {s.claimed} submitted</p><span className={result.needsReview ? 'session-warning' : 'session-caption'}>{result.needsReview ? `Review required: sustained difference at ${(result.firstAlertMs / 1000).toFixed(0)}s` : 'No sustained mismatch recorded; not proof of compliance.'}</span>{s.review ? <p><strong>Reviewed:</strong> {s.review.note}</p> : s.endedAt && result.needsReview ? <form onSubmit={e => { e.preventDefault(); try { const note = (reviewDrafts[s.id] || '').trim(); if (!note) throw new Error('Add a review note.'); persist(records.current.map(r => r.id === s.id ? { ...r, review: { note, reviewedAt: new Date().toISOString() }, reviewSynced: false } : r)); void synchronize(); } catch (e) { setError(e.message); } }}><label className="session-review">Review outcome<textarea aria-label={`Review outcome ${s.id}`} required maxLength={2000} value={reviewDrafts[s.id] || ''} onChange={e => setReviewDrafts({ ...reviewDrafts, [s.id]: e.target.value })} placeholder="Describe the discrepancy and follow-up action" /></label><button className="button button-secondary" type="submit">Save review outcome</button></form> : null}<p>{isPending(s) ? 'Queued locally' : s.endedAt ? 'Server acknowledged all evidence' : 'Samples synchronized'} · {s.ackCount}/{s.samples.length} samples acknowledged</p></div><div className="session-actions"><button className="button button-secondary" onClick={() => downloadFile(`session-${s.id}.json`, JSON.stringify({ ...s, summary: result }, null, 2), 'application/json')}><Download size={15} /> Export evidence</button>{s.endedAt && !isPending(s) && <button className="button button-secondary" onClick={() => { try { persist(records.current.filter(r => r.id !== s.id)); } catch (e) { setError(e.message); } }}>Remove local copy</button>}</div></article>; })}</div>
    </section>
    <section className="panel session-card"><h2>Shared server archive</h2><p className="session-caption">Durable storage on this localhost server. Open the site in another browser to see synchronized summaries. This development server has no user authentication and should remain on localhost.</p>{!serverSessions.length ? <p>No synchronized sessions available.</p> : serverSessions.map(s => <article className="session-record" key={s.id}><div><strong>{s.centreName}</strong><p>{new Date(s.startedAt).toLocaleString()} · {s.sampleCount} samples · {s.endedAt ? 'Ended' : 'Last synchronized checkpoint'}</p><p className={s.summary?.needsReview ? 'session-warning' : ''}>{s.summary?.needsReview ? 'Sustained mismatch — review evidence' : 'No sustained mismatch in received evidence'} · {Math.round((s.summary?.coverage || 0) * 100)}% observed coverage</p>{s.review && <p><strong>Reviewed:</strong> {s.review.note}</p>}</div></article>)}</section>
  </div>;
}
