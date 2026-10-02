import { useEffect, useId, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, Crosshair, Footprints, Maximize2, Minimize2, Pause, Play, Plus, RotateCcw, ScanLine, ShieldCheck, Users, WifiOff } from 'lucide-react';
import { createTrainingSimulation } from './trainingSimulation.js';
import './tracking-camera.css';

const clock = time => `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
const colors = ['#8af0c5', '#b4adff', '#85d4ff', '#ffd395'];
const trackColor = id => colors[Number(id) % colors.length];

export default function TrackingCamera({ centre, isLive, reducedMotion = false, lowResource = false }) {
  const [session, setSession] = useState(0);
  return <CameraSession key={`${centre.id}-${session}`} centre={centre} isLive={isLive} reducedMotion={reducedMotion} lowResource={lowResource} onReset={() => setSession(value => value + 1)} />;
}

function CameraSession({ centre, isLive, reducedMotion, lowResource, onReset }) {
  const [engine] = useState(createTrainingSimulation);
  const [frame, setFrame] = useState(() => engine.advance(0));
  const [paused, setPaused] = useState(() => reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [trails, setTrails] = useState(true);
  const [boxes, setBoxes] = useState(true);
  const [zones, setZones] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [hoverSample, setHoverSample] = useState(null);
  const gradientId = useId();
  const panelRef = useRef(null);
  const online = centre.connection === 'online';
  const running = online && isLive && !paused;
  const visible = online ? frame.tracks.filter(track => track.visible) : [];
  const selected = online ? frame.tracks.find(track => track.id === selectedId) : null;
  const lost = online ? frame.tracks.filter(track => !track.visible).length : 0;

  useEffect(() => {
    if (!running) return undefined;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      // Do not jump IDs/positions after a suspended or backgrounded browser tab.
      const delta = Math.min((now - previous) / 1000, lowResource ? .4 : .12);
      previous = now;
      if (!document.hidden) setFrame(engine.advance(delta * speed));
    }, lowResource ? 200 : 66);
    return () => clearInterval(timer);
  }, [engine, running, speed, lowResource]);

  useEffect(() => { if (reducedMotion) setPaused(true); }, [reducedMotion]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = event => { if (event.key === 'Escape') setExpanded(false); };
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const trapFocus = event => {
      if (event.key !== 'Tab') return;
      const nodes = [...panelRef.current.querySelectorAll('button:not(:disabled), select:not(:disabled), [tabindex="0"]')];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', trapFocus);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener('keydown', onKey); window.removeEventListener('keydown', trapFocus); };
  }, [expanded]);

  const choose = id => setSelectedId(current => current === id ? null : id);
  const reset = () => { setExpanded(false); onReset(); };
  return <section ref={panelRef} tabIndex={-1} className={`panel feed-panel tc-panel ${expanded ? 'tc-expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label="Interactive training floor camera">
    <div className="feed-head"><div><div className="small-eyebrow">Camera 01 · training floor</div><h2>Aggregate presence view<span className="tc-title-dot" /></h2></div><button className="icon-button small" aria-label={expanded ? 'Collapse camera' : 'Expand camera'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></div>
    <div className="tc-demo-note"><Spark /> <span><strong>Interactive prototype</strong> · simulated people, real track continuity</span></div>
    <div className={`tc-stage ${running ? 'tc-running' : 'tc-paused'}`} data-testid="tracking-stage" data-time={frame.time.toFixed(2)}>
      <div className="tc-stage-top"><span><span className={`tc-status-dot ${running ? 'active' : ''}`} />{!online ? 'OFFLINE' : running ? 'DEMO RUNNING' : 'DEMO PAUSED'}</span><span>CAM 01 <i>/</i> {centre.id}</span><span>{clock(frame.time)} <i>·</i> {speed}×</span></div>
      <svg className="tc-floor" viewBox="0 0 900 520" aria-label="Simulated training floor. Select a person to inspect their temporary track." role="group">
        <defs>
          <linearGradient id={`${gradientId}-wall`} x2="0" y2="1"><stop stopColor="#344450" /><stop offset="1" stopColor="#25353e" /></linearGradient>
          <linearGradient id={`${gradientId}-floor`} x2=".4" y2="1"><stop stopColor="#283840" /><stop offset="1" stopColor="#14232c" /></linearGradient>
          <radialGradient id={`${gradientId}-light`}><stop stopColor="#b1e8db" stopOpacity=".13" /><stop offset="1" stopColor="#b1e8db" stopOpacity="0" /></radialGradient>
          <pattern id={`${gradientId}-grid`} width="60" height="45" patternUnits="userSpaceOnUse"><path d="M60 0H0V45" fill="none" stroke="#8fa9ad" strokeOpacity=".09" /></pattern>
        </defs>
        <g aria-hidden="true">
          <path d="M0 0H900V227L0 252Z" fill={`url(#${gradientId}-wall)`} />
          <path d="M0 252L900 227V520H0Z" fill={`url(#${gradientId}-floor)`} />
          <path d="M0 252L900 227" stroke="#739085" strokeOpacity=".45" strokeWidth="4" />
          <path d="M0 252L900 227V520H0Z" fill={`url(#${gradientId}-grid)`} />
          {[70, 160, 740, 830].map(x => <g key={x}><path d={`M${x} 83v98`} stroke="#adc5c1" strokeOpacity=".16" strokeWidth="54" /><path d={`M${x} 89v86`} stroke="#a5d3d0" strokeOpacity=".21" strokeWidth="44" /><path d={`M${x} 89v86m-22-44h44`} stroke="#1c3039" strokeWidth="4" /></g>)}
          <ellipse cx="450" cy="290" rx="390" ry="235" fill={`url(#${gradientId}-light)`} />
          <rect x="315" y="83" width="276" height="118" rx="3" fill="#172c33" stroke="#667b76" strokeWidth="5" />
          <text x="453" y="131" textAnchor="middle" fill="#c8ddd5" fontSize="27" letterSpacing="8" fontFamily="Georgia, serif">SKILLSIGHT</text>
          <text x="453" y="159" textAnchor="middle" fill="#849f96" fontSize="10" letterSpacing="4">LEARNING IN MOTION</text>
          <path d="M382 176h142" stroke="#6f988b" strokeOpacity=".5" />
          <path d="M38 308v165m-9-156 9-9 9 9m-18 147 9 9 9-9" stroke="#99c9b6" strokeOpacity=".5" fill="none" />
          <text x="46" y="500" fill="#71948c" fontSize="10" letterSpacing="2">ENTRY / EXIT</text>
          {[190, 450, 708].map((x, index) => <g key={x}><path d={`M${x - 52} 361v29m106-29v29`} stroke="#0c1b24" strokeWidth="9" /><path d={`M${x - 70} 328h132l17 36H${x - 84}Z`} fill="#4a5552" stroke="#78918a" strokeOpacity=".35" /><path d={`M${x - 84} 364h163v10H${x - 84}Z`} fill="#2d403f" /><rect x={x - 22} y="315" width="32" height="22" rx="2" fill="#172933" stroke="#78948e" /><path d={`M${x - 7} 338v7m-10 0h20`} stroke="#90a39c" strokeWidth="2" /><text x={x - 2} y="395" fill="#5a7779" fontSize="10" textAnchor="middle" letterSpacing="2">STATION 0{index + 1}</text></g>)}
          {zones && <g className="tc-zones"><path d="M72 248H842V335H72Z" fill="#8af0c5" fillOpacity=".055" stroke="#8af0c5" strokeDasharray="6 6" /><text x="85" y="266" fill="#8af0c5" fontSize="11">ZONE A · LEARNING</text><path d="M72 403H842V490H72Z" fill="#b4adff" fillOpacity=".055" stroke="#b4adff" strokeDasharray="6 6" /><text x="85" y="481" fill="#b4adff" fontSize="11">ZONE B · PRACTICE</text></g>}
          {trails && visible.map(track => <polyline key={track.id} className="tc-trail" points={track.trail.map(point => point.join(',')).join(' ')} fill="none" stroke={trackColor(track.id)} strokeWidth={selectedId === track.id ? 3 : 1.7} opacity={selectedId && selectedId !== track.id ? .15 : .6} strokeLinecap="round" strokeDasharray="3 5" />)}
        </g>
        {visible.map(track => {
          const [x, y, width, height] = track.bbox;
          const active = selectedId === track.id;
          const stride = Math.sin(frame.time * 7 + Number(track.id)) * Math.min(5, Math.hypot(...track.velocity) / 4);
          return <g key={track.id} className={`tc-person ${active ? 'is-selected' : ''}`} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`} style={{ '--track-color': trackColor(track.id) }} role="button" tabIndex={0} aria-label={`Track ${track.id}`} aria-pressed={active} data-track-id={track.id} onClick={() => choose(track.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(track.id); } }}>
            <title>Track #{track.id} · click to follow</title>
            <ellipse cx="21" cy="79" rx="25" ry="7" className="tc-person-shadow" />
            {active && <ellipse className="tc-follow-ring" cx="21" cy="79" rx="34" ry="11" fill="none" stroke="currentColor" strokeDasharray="5 4" />}
            <g className="tc-human" aria-hidden="true"><path d={`M15 49 ${12 + stride} 72M26 49 ${31 - stride} 72`} stroke="#96a9ab" strokeWidth="8" strokeLinecap="round" /><path d={`M10 28 ${5 - stride} 48M32 28 ${37 + stride} 48`} stroke="#acc2c3" strokeWidth="7" strokeLinecap="round" /><path d="M10 26Q21 19 32 26L32 52Q21 57 10 52Z" fill={trackColor(track.id)} fillOpacity=".65" /><circle cx="21" cy="12" r="10" fill="#bdc9c3" /><path d="M14 11h14" stroke="#8fa5a0" strokeWidth="5" /></g>
            {boxes && <g className="tc-box" aria-hidden="true"><rect x="-7" y="-4" width={width + 14} height={height + 8} rx="2" fill="currentColor" fillOpacity={active ? '.10' : '.025'} stroke="currentColor" strokeOpacity=".38" /><path d={`M-7 8V-4H5m32 0h12v12M-7 68v12H5m32 0h12V68`} fill="none" stroke="currentColor" strokeWidth="2" /></g>}
            <g className="tc-track-label" aria-hidden="true"><rect x="-10" y="-27" width="63" height="19" rx="3" fill={active ? trackColor(track.id) : '#142c32'} stroke="currentColor" strokeOpacity=".7" /><text x="21" y="-14" textAnchor="middle" fill={active ? '#13252c' : trackColor(track.id)} fontSize="11" fontWeight="600">#{track.id}</text></g>
            <rect x="-12" y="-30" width="69" height="118" fill="transparent" />
          </g>;
        })}
      </svg>
      {online && <div className="tc-stage-bottom"><span><ScanLine size={13} /> {visible.length} active tracks {lost > 0 && `· ${lost} leaving`}</span><span>SESSION IDs ONLY <ShieldCheck size={12} /></span></div>}
      {!online && <div className="tc-state-overlay"><WifiOff size={28} /><strong>Camera offline</strong><span>Select a connected centre to explore the tracking demo.</span></div>}
      {online && !running && <div className="tc-pause-label"><Pause size={12} />{!isLive ? 'Global updates paused' : 'Motion paused'} · IDs preserved</div>}
      <div className="tc-scanline" aria-hidden="true" />
    </div>
    <div className="tc-controls">
      <div className="tc-control-group"><button className="tc-play" disabled={!online || !isLive} onClick={() => setPaused(value => !value)} aria-label={paused ? 'Play tracking demo' : 'Pause tracking demo'}>{paused ? <Play size={14} /> : <Pause size={14} />}<span>{paused ? 'Play' : 'Pause'}</span></button><button title="Start a fresh tracking session" aria-label="Reset tracking demo" disabled={!online} onClick={reset}><RotateCcw size={14} /></button><label className="tc-speed"><span className="tc-sr-only">Playback speed</span><select aria-label="Playback speed" value={speed} disabled={!online} onChange={event => setSpeed(Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label></div>
      <div className="tc-control-group"><button aria-pressed={boxes} onClick={() => setBoxes(value => !value)}><ScanLine size={13} /> Boxes</button><button aria-pressed={trails} onClick={() => setTrails(value => !value)}><Footprints size={13} /> Trails</button><button aria-pressed={zones} onClick={() => setZones(value => !value)}><Crosshair size={13} /> Zones</button></div>
    </div>
    <div className="tc-insights">
      <div className="tc-tracks-card"><div className="tc-section-label"><span><Users size={13} /> IN-FRAME TRACKS</span><strong>{online ? String(visible.length).padStart(2, '0') : '—'}</strong></div><div className="tc-roster">{visible.map(track => <button key={track.id} aria-label={`Inspect track ${track.id}`} aria-pressed={selectedId === track.id} style={{ '--track-color': trackColor(track.id) }} onClick={() => choose(track.id)}><i />{track.id}</button>)}{!visible.length && <span className="tc-empty">{online ? 'No people visible in frame.' : 'No active camera signal.'}</span>}</div><button className="tc-add" disabled={!running || visible.length >= 12} onClick={() => { engine.add(); setFrame(engine.advance(0)); }}><Plus size={12} /> Simulate entry</button></div>
      <div className="tc-inspector" data-testid="track-inspector"><div className="tc-section-label"><span><Crosshair size={13} /> TRACK INSPECTOR</span>{selected && <span className="tc-following">{selected.visible ? 'FOLLOWING' : 'LEAVING'}</span>}</div>{selected ? <><div className="tc-selected-id" style={{ '--track-color': trackColor(selected.id) }}>#{selected.id}<span>temporary session ID</span></div><div className="tc-track-metrics"><span>In view<strong>{clock((frame.time * 1000 - selected.firstSeen) / 1000)}</strong></span><span>Demo confidence<strong>{Math.round(selected.score * 100)}%</strong></span><span>Position<strong>{Math.round(selected.bbox[0])}, {Math.round(selected.bbox[1])}</strong></span></div><button className="tc-add" disabled={!running || !selected.visible} onClick={() => engine.exitTrack(selected.id)}><ArrowUpRight size={12} /> Simulate exit</button></> : <div className="tc-inspect-hint"><Crosshair size={23} /><strong>{selectedId ? `Track #${selectedId} ended` : 'Every movement. One ID.'}</strong><p>{selectedId ? 'This person left the frame. A new entry receives a new ID.' : 'Select a person or ID to follow their path, position and time in view.'}</p></div>}</div>
    </div>
    <div className="tc-activity"><div className="tc-occupancy"><div className="tc-section-label"><span><Activity size={13} /> FRAME OCCUPANCY</span><span>{hoverSample ? `${clock(hoverSample.time)} · ${hoverSample.count} people` : 'last 36 demo seconds'}</span></div><div className="tc-occupancy-bars" aria-label="Simulated occupancy history">{online && frame.history.map(sample => <button key={sample.time} aria-label={`${clock(sample.time)}: ${sample.count} people`} title={`${clock(sample.time)} · ${sample.count} people`} style={{ '--bar-height': `${Math.max(5, sample.count / 12 * 100)}%` }} onMouseEnter={() => setHoverSample(sample)} onFocus={() => setHoverSample(sample)} onMouseLeave={() => setHoverSample(null)} onBlur={() => setHoverSample(null)}><span /></button>)}</div></div><div className="tc-events"><div className="tc-section-label"><span>TRACK EVENTS</span><span>{online ? `${frame.entered} in / ${frame.exited} out` : '—'}</span></div>{online ? frame.events.slice(0, 3).map(event => <div className={`tc-event ${event.type}`} key={`${event.id}-${event.type}`}><span>{event.type === 'entry' ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}</span><strong>#{event.id}</strong><span>{event.type === 'entry' ? 'entered frame' : 'track ended'}</span><time>{clock(event.time)}</time></div>) : <span className="tc-empty">Events resume with a connected feed.</span>}</div></div>
    <div className="tc-footnote"><ShieldCheck size={13} /><span>Anonymous, in-memory IDs. Kept while visible; retired after exit. No face recognition or cross-camera matching. Demo tracks are separate from the centre snapshot.</span></div>
  </section>;
}

function Spark() { return <span className="tc-spark" aria-hidden="true">✦</span>; }
