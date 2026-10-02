import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Check, Circle, ArrowUpRight, FileText, AlertTriangle, X } from 'lucide-react';
import './workflow-ui.css';

export default function NotificationCenter({ notifications, onMarkRead, onOpen }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const container = useRef(null);
  const trigger = useRef(null);
  const unread = notifications.filter(n => !n.readAt);
  const shown = filter === 'unread' ? unread : notifications;
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!container.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  function mark(ids, read = true) { try { onMarkRead(ids, read); setError(''); } catch (failure) { setError(failure.message); } }
  function visit(notification) { try { onMarkRead([notification.id], true); onOpen(notification.target); setOpen(false); setError(''); } catch (failure) { setError(failure.message); } }
  return <div className="wf-notification-wrap" ref={container}>
    <button ref={trigger} className="icon-button" aria-label="Notifications" aria-expanded={open} aria-controls="notification-inbox" onClick={() => setOpen(value => !value)}><Bell size={18} />{unread.length > 0 && <span className="wf-unread-count" aria-label={`${unread.length} unread notifications`}>{unread.length > 99 ? '99+' : unread.length}</span>}</button>
    {open && <section className="wf-inbox" id="notification-inbox" aria-label="Notification inbox"><div className="wf-inbox-head"><div><span className="small-eyebrow">In-app activity</span><h2>Notifications <span>{unread.length} unread</span></h2></div><button className="icon-button small" aria-label="Close notifications" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></div><div className="wf-inbox-tools"><div className="segmented"><button aria-pressed={filter === 'all'} className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All</button><button aria-pressed={filter === 'unread'} className={filter === 'unread' ? 'selected' : ''} onClick={() => setFilter('unread')}>Unread</button></div><button className="text-button" disabled={!unread.length} onClick={() => mark(unread.map(n => n.id))}><CheckCheck size={14} /> Mark all read</button></div>{error && <p className="wf-error" role="alert">{error}</p>}<div className="wf-inbox-list">{shown.map(n => <article className={`wf-notification ${n.readAt ? '' : 'is-unread'}`} key={n.id}><span className={`wf-notification-icon ${n.type}`}>{n.type === 'alerts' ? <AlertTriangle size={16} /> : n.type === 'reports' ? <FileText size={16} /> : <Check size={16} />}</span><div><strong>{n.title}</strong><p>{n.message}</p><time>{new Date(n.createdAt).toLocaleString()}</time><div className="wf-notification-actions"><button onClick={() => visit(n)}>Open {n.target?.view === 'reports' ? 'report' : n.target?.view === 'settings' ? 'settings' : 'details'} <ArrowUpRight size={12} /></button><button onClick={() => mark([n.id], !n.readAt)}>{n.readAt ? <Circle size={11} /> : <Check size={11} />}{n.readAt ? 'Mark unread' : 'Mark read'}</button></div></div></article>)}{!shown.length && <div className="wf-inbox-empty"><Bell size={25} /><strong>{filter === 'unread' ? 'You’re all caught up.' : 'No notifications yet.'}</strong><p>Saved work, reports and new review alerts appear here when enabled in Settings.</p></div>}</div><div className="wf-inbox-footer">Local events only · opening an item marks it read</div></section>}
  </div>;
}
