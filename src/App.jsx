import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, Bell, Building2, Check, CheckCircle2, CircleHelp, Download, FileText, HardDrive, LayoutDashboard, LockKeyhole, Menu, MonitorPlay, Search, Settings2, ShieldCheck, Sparkles, ScanLine, Users, X, Eye } from 'lucide-react';
import { attendanceAvailable, inventoryAvailable } from './observations.js';
import SessionMonitor from './components/SessionMonitor.jsx';
import { dailyTrend } from './data.js';
import * as actions from './appState.js';
import { compileReport } from './reports.js';
import { centresCsv, downloadFile } from './download.js';
import AttendanceChart from './components/AttendanceChart.jsx';
import VisionLab from './components/VisionLab.jsx';
import LiveMonitor from './components/LiveMonitor.jsx';
import ReportsView from './components/ReportsView.jsx';
import CentresView from './components/CentresView.jsx';
import InfrastructureView from './components/InfrastructureView.jsx';
import SettingsView from './components/SettingsView.jsx';
import NotificationCenter from './components/NotificationCenter.jsx';
import EvidenceView from './components/EvidenceView.jsx';
import WorkflowDialog from './components/WorkflowDialog.jsx';
import './components/workflow-ui.css';

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'live', label: 'Live monitor', icon: MonitorPlay },
  { id: 'sessions', label: 'Session evidence', icon: ShieldCheck },
  { id: 'centres', label: 'Training centres', icon: Building2 },
  { id: 'infrastructure', label: 'Infrastructure', icon: HardDrive },
  { id: 'alerts', label: 'Alerts & review', icon: Bell },
  { id: 'reports', label: 'Reports', icon: FileText },
];
const pageMeta = {
  sessions: { eyebrow: 'Real camera · local inference', title: 'Session evidence', description: 'Measure sustained presence, retain an offline evidence queue and synchronize count summaries.' },
  overview: { eyebrow: 'Programme control room', title: 'Good morning, Ananya.', description: 'A current view of your training-centre workspace, with human review at its centre.' },
  live: { eyebrow: 'Interactive demonstration', title: 'Live monitor', description: 'Explore simulated tracks, reconcile counts and document the evidence you review.' },
  centres: { eyebrow: 'Centre network', title: 'Training centres', description: 'Manage centre profiles, capacity and review notes without leaving the directory.' },
  infrastructure: { eyebrow: 'Sanctioned inventory', title: 'Infrastructure compliance', description: 'Review assets, request verification and keep human findings separate from visual counts.' },
  alerts: { eyebrow: 'Human-in-the-loop review', title: 'Alerts & review', description: 'Signals become actions only after a person reviews the evidence.' },
  reports: { eyebrow: 'Evidence & transparency', title: 'Reports', description: 'Compile scoped, dated snapshots. Preview, archive and download the actual results.' },
  settings: { eyebrow: 'Workspace preferences', title: 'Settings', description: 'Control monitoring rules, demo behaviour and the notifications you receive.' },
};
const formatTime = value => value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'not saved';

export default function App() {
  const [loaded] = useState(() => actions.loadState(localStorage));
  const [appState, setAppState] = useState(loaded.state);
  const stateRef = useRef(loaded.state);
  const [storageError, setStorageError] = useState(loaded.error);
  const [activeView, setActiveView] = useState('overview');
  const [selectedCentreId, setSelectedCentreId] = useState(loaded.state.settings.defaultCentreId);
  const [focusCentreId, setFocusCentreId] = useState(null);
  const [focusItemId, setFocusItemId] = useState(null);
  const [focusReportId, setFocusReportId] = useState(null);
  const [focusAlertId, setFocusAlertId] = useState(null);
  const [toast, setToast] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [showVisionLab, setShowVisionLab] = useState(false);
  const [evidenceTarget, setEvidenceTarget] = useState(null);
  const [lastActionSavedAt, setLastActionSavedAt] = useState(loaded.state.savedAt || null);
  const selectedCentre = appState.centers.find(c => c.id === selectedCentreId) || appState.centers[0];
  const isLive = appState.settings.demoUpdates;
  const openAlerts = appState.alerts.filter(a => a.status === 'open');
  const metrics = useMemo(() => {
    const observed = appState.centers.filter(attendanceAvailable);
    const attendance = observed.reduce((sum, c) => sum + c.detected, 0);
    const comparableClaimed = observed.reduce((sum, c) => sum + c.claimed, 0);
    const items = appState.centers.flatMap(c => c.inventory);
    const available = appState.centers.flatMap(c => c.inventory.filter(i => inventoryAvailable(c, i)));
    const covered = available.filter(i => i.detected >= i.approved).length;
    return { centres: appState.centers.length, connected: appState.centers.filter(c => c.connection === 'online').length, attendance, claimed: comparableClaimed, attendanceRate: comparableClaimed ? Math.round(attendance / comparableClaimed * 100) : null, variance: comparableClaimed - attendance, gaps: available.length - covered, coverage: `${covered}/${items.length}`, unavailable: appState.centers.length - observed.length };
  }, [appState.centers]);

  function notify(message, tone = 'success') { setToast({ message, tone }); }
  function commit(transform, message) {
    try {
      const current = stateRef.current;
      const next = transform(current);
      if (next === current) return current;
      const saved = actions.persistState(localStorage, next);
      stateRef.current = saved; setAppState(saved); setStorageError('');
      if (message) { setLastActionSavedAt(saved.savedAt); notify(message); }
      return saved;
    } catch (failure) { if (failure.message.includes('browser')) setStorageError(failure.message); throw failure; }
  }
  function go(view) {
    setActiveView(view); setMobileNav(false); setFocusAlertId(null);
    window.scrollTo({ top: 0, behavior: appState.settings.reducedMotion ? 'instant' : 'smooth' });
  }
  function openMonitor(id) { setSelectedCentreId(id); go('live'); }
  function openCentre(id) { setFocusCentreId(id); go('centres'); }
  function openInfrastructure(id, itemId = null) { setFocusCentreId(id); setFocusItemId(itemId); go('infrastructure'); }
  function exportCsv(centres = stateRef.current.centers) { downloadFile('skillsight-centres.csv', centresCsv(centres), 'text/csv;charset=utf-8'); notify(`${centres.length} centre records exported.`); }
  function saveSettings(draft) { return commit(state => actions.saveSettings(state, draft), 'Settings saved locally.').settings; }
  function saveCentre(id, patch) { return commit(state => actions.saveCentre(state, id, patch), 'Centre details saved locally.').centers.find(c => c.id === id); }
  function createCentre(draft) { const next = commit(state => actions.createCentre(state, draft), 'Centre added locally. Camera setup is still required.'); return next.centers.at(-1); }
  function saveRegister(id, value) { return commit(state => actions.saveRegister(state, id, value), 'Register update saved locally.').centers.find(c => c.id === id); }
  function saveInventory(centreId, itemId, patch) { return commit(state => actions.saveInventory(state, centreId, itemId, patch), 'Human inventory review saved. Visual count preserved.').centers.find(c => c.id === centreId).inventory.find(i => i.id === itemId); }
  function requestVerification(centreId, itemId) { return commit(state => actions.requestVerification(state, centreId, itemId), 'Verification request added to the local review queue.').centers.find(c => c.id === centreId).inventory.find(i => i.id === itemId); }
  function resolveAlert(id) { try { commit(state => actions.resolveAlert(state, id), 'Alert resolved. Review activity saved locally.'); } catch (error) { notify(error.message, 'error'); } }
  function handleCompile(options) {
    const report = compileReport(stateRef.current, options);
    commit(state => actions.storeReport(state, report), 'Report compiled and saved to your local archive.');
    return report;
  }
  function openNotification(target) {
    if (target?.view === 'live') { openMonitor(target.centreId); if (target.evidenceId) setEvidenceTarget({ centreId: target.centreId, evidenceId: target.evidenceId }); }
    else if (target?.view === 'centres') openCentre(target.centreId);
    else if (target?.view === 'infrastructure') openInfrastructure(target.centreId, target.itemId);
    else if (target?.view === 'reports') { setFocusReportId(target.reportId); go('reports'); }
    else if (target?.view === 'alerts') { go('alerts'); setFocusAlertId(target.alertId); }
    else go(target?.view === 'settings' ? 'settings' : 'overview');
  }
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setShowCommand(value => !value); }
      if (event.key === 'Escape') { setShowCommand(false); setMobileNav(false); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(appState.settings.reducedMotion);
    return () => { delete document.documentElement.dataset.reducedMotion; };
  }, [appState.settings.reducedMotion]);
  useEffect(() => {
    if (!isLive || storageError) return undefined;
    const seconds = appState.settings.lowBandwidth ? Math.max(60, appState.settings.refreshIntervalSeconds) : appState.settings.refreshIntervalSeconds;
    const timer = setInterval(() => {
      if (document.hidden) return;
      try { commit(actions.simulateTick); } catch { /* The persistent storage banner explains why refreshes stopped. */ }
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [isLive, appState.settings.lowBandwidth, appState.settings.refreshIntervalSeconds, storageError]);

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="brand-lockup"><div className="brand-mark"><ScanLine size={19} strokeWidth={2.4} /></div><div><div className="brand-name">SkillSight</div><div className="brand-sub">MSDE / SIH 26245</div></div></div><div className="network-status"><span className="status-dot" /> Local prototype <span className="network-time">{metrics.connected} demo feeds</span></div><div className="sidebar-label">Control room</div><nav className="side-nav" aria-label="Main navigation">{navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${activeView === item.id ? 'active' : ''}`} onClick={() => go(item.id)}><Icon size={17} /><span>{item.label}</span>{item.id === 'alerts' && <span className="nav-badge alert-badge">{openAlerts.length}</span>}</button>; })}</nav><div className="sidebar-spacer" /><div className="sidebar-card"><div className="sidebar-card-icon"><ShieldCheck size={17} /></div><div><strong>Privacy mode on</strong><p>Anonymous session tracks.<br />No face recognition.</p></div></div><button className={`nav-item ${activeView === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}><Settings2 size={17} /><span>Settings</span></button><div className="user-chip"><div className="avatar">AR</div><div className="user-meta"><strong>Ananya Rao</strong><span>Demo reviewer · local only</span></div></div></aside>
    {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <main className="main-content"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={21} /></button><div className="breadcrumbs"><span>MSDE / Monitoring</span><span className="crumb-divider">/</span><strong>{activeView === 'overview' ? 'Overview' : pageMeta[activeView].title}</strong></div><div className="topbar-actions"><button className="search-trigger" onClick={() => setShowCommand(true)}><Search size={16} /><span>Search</span><kbd>⌘ K</kbd></button><span className="wf-persist-indicator"><CheckCircle2 size={12} />{storageError ? 'Save needs attention' : lastActionSavedAt ? `Saved locally · ${formatTime(lastActionSavedAt)}` : 'Browser-local workspace'}</span><NotificationCenter notifications={appState.notifications} onMarkRead={(ids, read) => commit(state => actions.markNotifications(state, ids, read))} onOpen={openNotification} /></div></header>
      <div className="page-wrap"><PageHeader meta={pageMeta[activeView]} isLive={isLive} onToggleLive={() => { try { saveSettings({ ...stateRef.current.settings, demoUpdates: !stateRef.current.settings.demoUpdates }); } catch (error) { notify(error.message, 'error'); } }} onExport={() => exportCsv()} />{storageError && <div className="wf-storage-error" role="alert"><AlertCircle size={17} /><span>{storageError}</span></div>}
        {activeView === 'overview' && <Overview appState={appState} metrics={metrics} selectedCentre={selectedCentre} onNavigate={go} onOpenCentre={openCentre} onOpenVision={() => { setShowVisionLab(true); }} onResolve={resolveAlert} />}
        {activeView === 'live' && <LiveMonitor centre={selectedCentre} centres={appState.centers} isLive={isLive} settings={appState.settings} history={appState.history} evidence={appState.evidence} onSelect={setSelectedCentreId} onSaveRegister={saveRegister} onOpenVision={() => setShowVisionLab(true)} onOpenEvidence={() => setEvidenceTarget({ centreId: selectedCentre.id })} onOpenInfrastructure={openInfrastructure} />}
        <div hidden={activeView !== 'sessions'}><SessionMonitor centres={appState.centers} /></div>
        {activeView === 'centres' && <CentresView centres={appState.centers} alerts={appState.alerts} history={appState.history} onSaveCentre={saveCentre} onCreateCentre={createCentre} onOpenMonitor={openMonitor} onOpenInfrastructure={openInfrastructure} focusCentreId={focusCentreId} onExport={exportCsv} />}
        {activeView === 'infrastructure' && <InfrastructureView centres={appState.centers} history={appState.history} focusCentreId={focusCentreId} focusItemId={focusItemId} onSaveInventory={saveInventory} onRequestVerification={requestVerification} onOpenMonitor={openMonitor} />}
        {activeView === 'alerts' && <AlertsView alerts={appState.alerts} focusAlertId={focusAlertId} onResolve={resolveAlert} onOpenCentre={openCentre} onOpenInfrastructure={openInfrastructure} />}
        {activeView === 'reports' && <ReportsView appState={appState} focusReportId={focusReportId} onCompile={handleCompile} onDownload={notify} />}
        {activeView === 'settings' && <SettingsView settings={appState.settings} centres={appState.centers} savedAt={appState.savedAt} onSave={saveSettings} onExportData={() => { downloadFile(`skillsight-local-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(stateRef.current, null, 2)); notify('Local backup downloaded. No footage or tracking IDs included.'); }} />}
      </div><footer className="site-footer"><div><span className="footer-mark"><ScanLine size={14} /></span><strong>SkillSight</strong><span> / a privacy-first prototype for SIH 26245</span></div><div className="footer-right"><span><LockKeyhole size={13} /> local counts, human review</span><span>v0.9 workflow demo</span></div></footer>
    </main>
    {showVisionLab && <WorkflowDialog title="Browser-local Vision Lab" eyebrow={`Real AI path · ${selectedCentre.id}`} onClose={() => setShowVisionLab(false)} wide><VisionLab centre={selectedCentre} onResult={result => commit(state => actions.saveVision(state, selectedCentre.id, result), 'Local analysis saved. Demo refreshes will not overwrite it.')} /></WorkflowDialog>}
    {evidenceTarget && <EvidenceView key={`${evidenceTarget.centreId}-${evidenceTarget.evidenceId || 'new'}`} appState={appState} centreId={evidenceTarget.centreId} initialEvidenceId={evidenceTarget.evidenceId} onSave={(snapshot, note) => commit(state => actions.saveEvidence(state, snapshot, note), 'Evidence snapshot and review note saved locally.')} onClose={() => setEvidenceTarget(null)} onOpenInfrastructure={openInfrastructure} onDownload={notify} />}
    {showCommand && <CommandPalette centres={appState.centers} onClose={() => setShowCommand(false)} onGo={go} onOpenCentre={openCentre} />}
    {toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}><span className="toast-icon">{toast.tone === 'success' ? <CheckCircle2 size={17} /> : <CircleHelp size={17} />}</span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button></div>}
  </div>;
}

function PageHeader({ meta, isLive, onToggleLive, onExport }) {
  return <section className="page-header"><div><div className="eyebrow"><span className="eyebrow-line" />{meta.eyebrow}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="header-actions"><button className={`live-toggle ${isLive ? 'on' : ''}`} aria-pressed={isLive} title="Pause or resume simulated camera motion and centre updates" onClick={onToggleLive}><span className="live-indicator" />{isLive ? 'Live updates' : 'Updates paused'}</button>{!['Settings', 'Training centres', 'Reports', 'Infrastructure compliance'].includes(meta.title) && <button className="button button-secondary" onClick={onExport}><Download size={16} /> Export centres</button>}</div></section>;
}
function Heading({ eyebrow, title, children }) { return <div className="panel-heading"><div><div className="small-eyebrow">{eyebrow}</div><h2>{title}</h2></div>{children}</div>; }
function Metric({ label, value, detail, icon: Icon, tone }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19} /></div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>; }
function Overview({ appState, metrics, selectedCentre, onNavigate, onOpenCentre, onOpenVision, onResolve }) {
  const open = appState.alerts.filter(a => a.status === 'open');
  const threshold = appState.settings.mismatchThreshold;
  const ranked = appState.centers.filter(c => c.detected !== null && Math.abs(c.claimed - c.detected) >= threshold).sort((a, b) => Math.abs(b.claimed - b.detected) - Math.abs(a.claimed - a.detected)).slice(0, 4);
  return <div className="view-stack"><section className="metric-grid"><Metric label="Centres monitored" value={metrics.centres} detail={`${metrics.connected} demo connections`} icon={Building2} tone="blue" /><Metric label="Observed snapshot" value={metrics.attendance} detail={`${metrics.unavailable} centres have no observation`} icon={Users} tone="purple" /><Metric label="Open review alerts" value={open.length} detail={`${open.filter(a => a.severity === 'high').length} high priority`} icon={AlertTriangle} tone="amber" /><Metric label="Assets within visual count" value={metrics.coverage} detail={`${metrics.gaps} potential gaps · not operability`} icon={HardDrive} tone="green" /></section>
    <section className="dashboard-grid dashboard-grid-main"><AttendanceChart points={dailyTrend} onViewReport={() => onNavigate('reports')} /><div className="panel centre-focus"><Heading eyebrow="Selected centre" title="Centre at a glance"><button className="text-button" onClick={() => onOpenCentre(selectedCentre.id)}>Open profile <ArrowRight size={14} /></button></Heading><div className="focus-name"><div className="focus-icon"><Building2 size={20} /></div><div><strong>{selectedCentre.name}</strong><span>{selectedCentre.id} · {selectedCentre.city}</span></div><span className={`connection-badge ${selectedCentre.connection}`}><i />{selectedCentre.connection}</span></div><div className="focus-stats"><div><span>Observed snapshot</span><strong>{selectedCentre.detected ?? '—'}</strong><small>{selectedCentre.source === 'local-ai' ? 'saved local analysis' : 'synthetic demo source'}</small></div><div><span>Saved register</span><strong>{selectedCentre.claimed}</strong><small>capacity {selectedCentre.capacity}</small></div></div><div className="mini-progress"><div className="progress-head"><span>Observation source</span><strong>{selectedCentre.source === 'local-ai' ? 'COCO-SSD' : 'Demo'}</strong></div><p className="wf-description">A count is not verified attendance. Review centre records and context before taking action.</p></div><div className="focus-divider" /><div className="focus-meta"><span>Snapshot {formatTime(selectedCentre.observedAt)}</span><span>{selectedCentre.cameras} configured cameras</span></div><button className="button button-dark full-button" onClick={onOpenVision}><ScanLine size={15} /> Analyse sample footage</button></div></section>
    <section className="dashboard-grid dashboard-grid-secondary"><div className="panel alert-panel"><Heading eyebrow="Action queue" title="Needs your attention"><button className="text-button" onClick={() => onNavigate('alerts')}>All alerts <ArrowRight size={14} /></button></Heading>{open.slice(0, 3).map(alert => <div className="alert-row" key={alert.id}><button className="alert-row-main" onClick={() => onOpenCentre(alert.centreId)}><span className={`alert-severity ${alert.severity}`}><AlertTriangle size={14} /></span><span><strong>{alert.summary}</strong><small>{alert.centreName}</small></span></button><button className="resolve-button" onClick={() => onResolve(alert.id)} aria-label="Resolve alert"><Check size={15} /></button></div>)}{!open.length && <Empty title="Nothing urgent" text="All current signals have been reviewed." />}</div><div className="panel variance-panel"><Heading eyebrow={`Review threshold · ${threshold} people`} title="Largest attendance gaps"><button className="text-button" onClick={() => onNavigate('centres')}>See centres <ArrowRight size={14} /></button></Heading>{ranked.map((centre, index) => <button className="rank-row" key={centre.id} onClick={() => onOpenCentre(centre.id)}><span className="rank-index">0{index + 1}</span><span className="rank-centre"><strong>{centre.name}</strong><small>{centre.city} · {centre.id}</small></span><span className="rank-value">{centre.detected - centre.claimed > 0 ? '+' : ''}{centre.detected - centre.claimed}<small>learners</small></span><ArrowRight size={15} /></button>)}{!ranked.length && <Empty title="No large differences" text="Available observations are below the configured review threshold." />}</div></section>
    <section className="insight-strip"><div className="insight-icon"><Sparkles size={18} /></div><div><strong>A useful signal · not a judgement</strong><p>Current counts, saved changes and reports are connected locally. Offline centres remain unknown; simulated data is not a field evaluation.</p></div><button className="text-button" onClick={() => onNavigate('reports')}>Compile evidence pack <ArrowRight size={14} /></button></section></div>;
}
function Empty({ title, text }) { return <div className="empty-state"><CheckCircle2 size={21} /><strong>{title}</strong><span>{text}</span></div>; }
function AlertsView({ alerts, focusAlertId, onResolve, onOpenCentre, onOpenInfrastructure }) {
  const [filter, setFilter] = useState('open');
  useEffect(() => { if (focusAlertId) setFilter('all'); }, [focusAlertId]);
  useEffect(() => { if (focusAlertId) document.getElementById(`review-${focusAlertId}`)?.scrollIntoView({ block: 'center' }); }, [focusAlertId, filter]);
  const shown = alerts.filter(a => filter === 'all' || a.status === filter);
  return <div className="view-stack"><div className="wf-info"><ShieldCheck size={19} /><div><strong>Human review is the decision layer.</strong><p>Resolving an alert records a local reviewer action. It does not verify attendance, certify an asset or send a message to the centre.</p></div></div><section className="panel alerts-table-panel"><div className="table-heading"><div><div className="small-eyebrow">Review queue</div><h2>{shown.length} alerts in view</h2></div><div className="segmented">{['open', 'resolved', 'all'].map(value => <button key={value} className={filter === value ? 'selected' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div><div className="alert-list">{shown.map(alert => <article id={`review-${alert.id}`} key={alert.id} className={`alert-card ${alert.status}`} style={focusAlertId === alert.id ? { boxShadow: 'inset 3px 0 #5266d7', background: '#fafbff' } : undefined}><div className={`alert-card-icon ${alert.severity}`}><AlertTriangle size={17} /></div><div className="alert-card-content"><div className="alert-card-title"><span>{alert.type}</span><span className={`severity-label ${alert.severity}`}>{alert.severity} priority</span></div><strong>{alert.summary}</strong><p>{alert.centreName} · {new Date(alert.createdAt).toLocaleString()}</p><div className="alert-evidence">{alert.evidence}</div></div><div className="alert-card-action"><button className="button button-secondary" onClick={() => alert.itemId ? onOpenInfrastructure(alert.centreId, alert.itemId) : onOpenCentre(alert.centreId)}><Eye size={14} />{alert.itemId ? 'Review asset' : 'Inspect centre'}</button>{alert.status === 'open' ? <button className="button button-primary" onClick={() => onResolve(alert.id)}><Check size={14} /> Resolve</button> : <span className="resolved-label"><CheckCircle2 size={15} /> Resolved locally</span>}</div></article>)}{!shown.length && <Empty title="Queue is clear" text="No alerts in this filter." />}</div></section></div>;
}
function CommandPalette({ centres, onClose, onGo, onOpenCentre }) {
  const [query, setQuery] = useState('');
  const matches = centres.filter(c => `${c.name} ${c.city} ${c.id}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
  return <WorkflowDialog title="Search workspace" eyebrow="Jump to a section or centre" onClose={onClose}><div className="command-search"><Search size={18} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search centre, city or ID…" aria-label="Search workspace" /></div><div className="command-section"><span>Sections</span>{[...navItems, { id: 'settings', label: 'Settings', icon: Settings2 }].map(item => <button key={item.id} onClick={() => { onGo(item.id); onClose(); }}><item.icon size={15} />{item.label}</button>)}</div><div className="command-section"><span>Centre profiles</span>{matches.map(c => <button key={c.id} onClick={() => { onOpenCentre(c.id); onClose(); }}><Building2 size={15} />{c.name}<small>{c.city}</small></button>)}</div></WorkflowDialog>;
}
