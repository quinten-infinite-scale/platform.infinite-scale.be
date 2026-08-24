// Formatting helpers attached to Component prototype via mixin
const Helpers = {
  euro(n) { return '€' + (Math.round(n)).toLocaleString('en-US'); },
  pad(n) { return n < 10 ? '0' + n : '' + n; },
  iso(d) { return d.getFullYear() + '-' + this.pad(d.getMonth() + 1) + '-' + this.pad(d.getDate()); },
  today() { return new Date(); },
  daysAgo(n) { const d = this.today(); d.setDate(d.getDate() - n); return d; },
  fmtDate(s) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  },
  fmtFull(s) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },
  initialsOf(name) {
    return (name || '').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
  },
  toast(tag, text, color) {
    const id = Date.now() + Math.random();
    this.setState(s => ({ toasts: [...s.toasts, { id, tag, text, color: color || 'var(--accent)' }] }));
    setTimeout(() => { this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })); }, 3600);
  },
  clientName(id, d) {
    const c = d.clients.find(x => x.id === id);
    return c ? c.name : id;
  },
  agentName(id, d) {
    const a = d.agents.find(x => x.id === id);
    return a ? a.name : id;
  },
  _kv(k, v) {
    const e = React.createElement;
    return e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 } },
      e('span', { style: { color: 'var(--text-mute)' } }, k),
      e('span', { style: { color: 'var(--text)', fontWeight: 700, textAlign: 'right' } }, v));
  },
};
