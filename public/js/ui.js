// Self-contained date picker — manages open/month state internally
const _DatePickerWidget = function({ value, onChange }) {
  const e = React.createElement;
  const [open, setOpen] = React.useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const initMonth = value ? value.slice(0, 7) : todayStr.slice(0, 7);
  const [month, setMonth] = React.useState(initMonth);
  const [yr, mo] = month.split('-').map(Number);
  const monthNL = ['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'];
  const dayNL = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
  const displayVal = value ? new Date(value + 'T12:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const go = (delta) => { const d = new Date(yr, mo - 1 + delta, 1); setMonth(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')); };
  const firstDow = (new Date(yr, mo - 1, 1).getDay() + 6) % 7;
  const totalDays = new Date(yr, mo, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const btnBase = { background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, padding: '4px 8px', color: 'var(--text-dim)', fontSize: 17, lineHeight: 1 };
  return e('div', { style: { position: 'relative' } },
    e('button', { type: 'button', onClick: () => setOpen(o => !o), style: { width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', color: value ? 'var(--text)' : 'var(--text-dim)', fontSize: 14, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Manrope'" } },
      e('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, style: { flexShrink: 0, opacity: 0.7 } }, e('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2 }), e('path', { d: 'M16 2v4M8 2v4M3 10h18' })),
      displayVal || 'Selecteer datum…'),
    open ? e('div', { style: { position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 9999, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, minWidth: 270, boxShadow: '0 8px 32px rgba(0,0,0,0.35)' } },
      e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } },
        e('button', { type: 'button', onClick: () => go(-1), style: btnBase }, '‹'),
        e('span', { style: { fontWeight: 700, fontSize: 13.5, color: 'var(--text)' } }, monthNL[mo-1] + ' ' + yr),
        e('button', { type: 'button', onClick: () => go(1), style: btnBase }, '›')),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 6 } },
        ...dayNL.map(d => e('div', { key: d, style: { textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--text-mute)', padding: '3px 0', letterSpacing: '.03em' } }, d))),
      ...rows.map((row, ri) => e('div', { key: ri, style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 } },
        ...row.map((day, di) => {
          if (!day) return e('div', { key: di });
          const ds = yr + '-' + String(mo).padStart(2,'0') + '-' + String(day).padStart(2,'0');
          const sel = ds === value, tod = ds === todayStr;
          return e('button', { key: di, type: 'button', onClick: () => { onChange(ds); setOpen(false); }, style: { padding: '7px 0', borderRadius: 8, border: tod && !sel ? '1.5px solid var(--accent)' : 'none', background: sel ? 'var(--accent)' : 'none', color: sel ? 'oklch(0.12 0 0)' : 'var(--text)', fontWeight: sel ? 700 : 400, fontSize: 13, cursor: 'pointer', textAlign: 'center', fontFamily: "'JetBrains Mono'" } }, day);
        }))),
      e('div', { onClick: () => setOpen(false), style: { position: 'fixed', inset: 0, zIndex: -1 } })) : null);
};

// UI component builders (all return React elements via React.createElement)
const UI = {
  C(extra, ...kids) {
    return React.createElement('div', {
      style: Object.assign({ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 18, minWidth: 0 }, extra || {})
    }, ...kids);
  },
  Row(extra, ...kids) {
    return React.createElement('div', { style: Object.assign({ display: 'flex', alignItems: 'center', gap: 12 }, extra || {}) }, ...kids);
  },
  Col(extra, ...kids) {
    return React.createElement('div', { style: Object.assign({ display: 'flex', flexDirection: 'column', minWidth: 0 }, extra || {}) }, ...kids);
  },
  Grid(cols, gap, ...kids) {
    return React.createElement('div', {
      className: cols.indexOf('auto-fit') >= 0 ? undefined : 'isp-stack',
      style: { display: 'grid', gridTemplateColumns: cols, gap: gap || 16 }
    }, ...kids);
  },
  Hd(text, extra) {
    return React.createElement('div', {
      style: Object.assign({ fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 17, letterSpacing: '-.01em' }, extra || {})
    }, text);
  },
  Sub(text, extra) {
    return React.createElement('div', { style: Object.assign({ fontSize: 12.5, color: 'var(--text-mute)' }, extra || {}) }, text);
  },
  Mono(text, extra) {
    return React.createElement('span', { style: Object.assign({ fontFamily: "'JetBrains Mono'" }, extra || {}) }, text);
  },
  Pill(text, color, bg) {
    return React.createElement('span', {
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, color: color || 'var(--text-dim)', background: bg || 'var(--surface-2)', fontFamily: "'JetBrains Mono'", whiteSpace: 'nowrap' }
    }, text);
  },
  statusPill(st) {
    const m = {
      open: ['Open', 'var(--info)', 'oklch(0.30 0.05 240)'],
      show: ['Show', 'var(--up)', 'oklch(0.30 0.10 194)'],
      no_show: ['No-show', 'var(--down)', 'oklch(0.30 0.06 25)'],
      cancel: ['Cancelled', 'var(--text-mute)', 'var(--surface-2)'],
      paid: ['Paid', 'var(--up)', 'oklch(0.30 0.10 194)'],
      pending: ['Pending', 'var(--warn)', 'oklch(0.30 0.05 85)'],
      active: ['Active', 'var(--up)', 'oklch(0.30 0.10 194)'],
      starting: ['Starting', 'var(--info)', 'oklch(0.30 0.05 240)'],
      inactive: ['Inactive', 'var(--text-mute)', 'var(--surface-2)'],
    };
    const x = m[st] || ['—', 'var(--text-mute)', 'var(--surface-2)'];
    return UI.Pill(x[0], x[1], x[2]);
  },
  Btn(label, onClick, kind, extra) {
    const styles = {
      primary: { background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' },
      ghost: { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' },
      soft: { background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)' },
      danger: { background: 'transparent', color: 'var(--down)', border: '1px solid oklch(0.45 0.12 25)' },
    };
    return React.createElement('button', {
      onClick,
      style: Object.assign({ padding: '9px 16px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'Manrope'" }, styles[kind || 'primary'], extra || {})
    }, label);
  },
  Field(label, child) {
    return React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' } }, label, child);
  },
  Input(value, onChange, ph, type, extra) {
    return React.createElement('input', {
      value: value || '', placeholder: ph || '', type: type || 'text',
      onChange: e => onChange(e.target.value),
      style: { padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%' },
      ...(extra || {}),
    });
  },
  DatePicker(value, onChange) {
    return React.createElement(_DatePickerWidget, { value, onChange });
  },
  Select(value, onChange, opts) {
    return React.createElement('select', {
      value: value || '', onChange: e => onChange(e.target.value),
      style: { padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%', cursor: 'pointer' }
    }, opts.map(o => React.createElement('option', { key: o.v, value: o.v, disabled: !!o.disabled }, o.l)));
  },
  Area(value, onChange, ph) {
    return React.createElement('textarea', {
      value: value || '', placeholder: ph || '', onChange: e => onChange(e.target.value), rows: 3,
      style: { padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%', resize: 'vertical', fontFamily: "'Manrope'" }
    });
  },
  Stat(label, value, delta, sub) {
    const e = React.createElement;
    const up = delta != null && delta >= 0;
    const deltaEl = delta == null ? null : e('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: up ? 'var(--up)' : 'var(--down)' } },
      e('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', style: { transform: up ? 'none' : 'scaleY(-1)' } },
        e('path', { d: 'M5 12l7-7 7 7M12 5v14' })),
      (up ? '+' : '') + delta + '%');
    return UI.C({ display: 'flex', flexDirection: 'column', gap: 8 },
      e('div', { style: { fontSize: 12.5, color: 'var(--text-mute)', fontWeight: 600 } }, label),
      e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 30, letterSpacing: '-.02em', lineHeight: 1 } }, value),
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, deltaEl, sub ? e('span', { style: { fontSize: 11.5, color: 'var(--text-mute)' } }, sub) : null));
  },
  Donut(pct, color, center, label) {
    const e = React.createElement; const p = Math.max(0, Math.min(100, pct));
    return e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 } },
      e('div', { style: { width: 120, height: 120, borderRadius: '50%', background: `conic-gradient(${color || 'var(--accent)'} 0 ${p}%, var(--surface-2) ${p}% 100%)`, display: 'grid', placeItems: 'center' } },
        e('div', { style: { width: 84, height: 84, borderRadius: '50%', background: 'var(--surface)', display: 'grid', placeItems: 'center' } },
          e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 22 } }, center))),
      label ? e('div', { style: { fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 600, textAlign: 'center' } }, label) : null);
  },
  Bars(data, color) {
    const e = React.createElement; const max = Math.max(1, ...data.map(d => d.value));
    const BAR_MAX = 100;
    return e('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 4, padding: '0 4px 0', borderBottom: '1px solid var(--border-soft)' } },
      data.map((d, i) => {
        const bkd = d.breakdown && d.breakdown.length > 0 ? d.breakdown : null;
        return e('div', {
          key: i,
          style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 0, position: 'relative' },
          onMouseEnter: ev => { ev.currentTarget.firstChild.style.display = 'block'; },
          onMouseLeave: ev => { ev.currentTarget.firstChild.style.display = 'none'; },
        },
          // Tooltip — always first child
          e('div', { style: { display: 'none', position: 'absolute', bottom: 'calc(100% - 10px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 13px', zIndex: 30, minWidth: 130, boxShadow: '0 6px 24px rgba(0,0,0,.45)', pointerEvents: 'none', whiteSpace: 'nowrap' } },
            e('div', { style: { fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: bkd ? 7 : 0 } }, d.value + ' appointment' + (d.value !== 1 ? 's' : '')),
            bkd ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              bkd.map((b, bi) => e('div', { key: bi, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, fontSize: 11.5 } },
                e('span', { style: { color: 'var(--text-mute)' } }, b.label),
                e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, color: b.color || 'var(--text-dim)' } }, String(b.value))))) : null),
          d.value > 0 ? e('div', { style: { fontSize: 11, fontFamily: "'JetBrains Mono'", color: 'var(--text-dim)', fontWeight: 600 } }, d.value) : e('div', { style: { fontSize: 11, height: 16 } }),
          e('div', { style: { width: '80%', maxWidth: 36, height: Math.max(4, Math.round((d.value / max) * BAR_MAX)) + 'px', background: d.value > 0 ? (color || 'var(--accent)') : 'var(--border)', borderRadius: '5px 5px 2px 2px', transformOrigin: 'bottom', animation: 'isp-grow .4s ease both' } }),
          e('div', { style: { fontSize: 10, color: 'var(--text-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center', padding: '4px 0 6px' } }, d.label));
      }));
  },
  Line(values, color, labels, formatter, breakdowns, allLabels) {
    const e = React.createElement;
    const W = 600, Hh = 160, padX = 8, padY = 12;
    const max = Math.max(...values, 0.001);
    const min = Math.min(...values, 0);
    const flat = max === min;
    const rng = flat ? 1 : (max - min);
    const n = values.length;
    const pts = values.map((v, i) => ({
      x: padX + (i / (n - 1 || 1)) * (W - padX * 2),
      y: flat ? Hh / 2 : Hh - padY - ((v - min) / rng) * (Hh - padY * 2),
      v
    }));
    // Smooth bezier path
    const smooth = pts => {
      if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : '';
      let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        const cx = (p0.x + p1.x) / 2;
        d += ` C${cx.toFixed(2)},${p0.y.toFixed(2)} ${cx.toFixed(2)},${p1.y.toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
      }
      return d;
    };
    const linePath = smooth(pts);
    const areaPath = linePath + ` L${pts[pts.length-1].x.toFixed(2)},${(Hh-padY).toFixed(2)} L${pts[0].x.toFixed(2)},${(Hh-padY).toFixed(2)} Z`;
    const fmt = formatter || (v => String(v));
    const uid = 'lg' + (color || 'acc').replace(/[^a-z]/gi, '').slice(0,6) + Math.random().toString(36).slice(2,5);
    // Per-point refs for tooltip and dot
    const tipRefs = pts.map(() => ({ tip: null, dot: null }));
    let activeIdx = -1;
    const activate = idx => {
      if (idx === activeIdx) return;
      if (activeIdx >= 0 && tipRefs[activeIdx]) {
        if (tipRefs[activeIdx].tip) tipRefs[activeIdx].tip.style.display = 'none';
        if (tipRefs[activeIdx].dot) tipRefs[activeIdx].dot.style.opacity = '0';
      }
      activeIdx = idx;
      if (idx >= 0 && tipRefs[idx]) {
        if (tipRefs[idx].tip) tipRefs[idx].tip.style.display = 'block';
        if (tipRefs[idx].dot) tipRefs[idx].dot.style.opacity = '1';
      }
    };
    const dots = pts.map((p, i) => {
      const bkd = breakdowns && breakdowns[i] && breakdowns[i].length > 0 ? breakdowns[i] : null;
      const dateLabel = allLabels && allLabels[i] ? allLabels[i] : null;
      return e('div', { key: i, style: { position: 'absolute', left: (p.x / W * 100).toFixed(2) + '%', top: (p.y / Hh * 100).toFixed(2) + '%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 2 } },
        e('div', { ref: el => { tipRefs[i].tip = el; }, style: { display: 'none', position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 13px', fontSize: 11, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', zIndex: 20, pointerEvents: 'none', boxShadow: '0 6px 24px rgba(0,0,0,.5)', minWidth: 130 } },
          dateLabel ? e('div', { style: { fontSize: 10, color: 'var(--text-mute)', fontWeight: 400, marginBottom: 4, letterSpacing: '.03em' } }, dateLabel) : null,
          e('div', { style: { fontWeight: 700, marginBottom: bkd ? 7 : 0 } }, fmt(p.v)),
          bkd ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 6 } },
            bkd.map((b, bi) => e('div', { key: bi, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, fontSize: 11 } },
              e('span', { style: { color: 'var(--text-mute)', fontWeight: 400 } }, b.label),
              e('span', { style: { fontWeight: 700, color: b.color || 'var(--text-dim)' } }, String(b.value))))) : null),
        e('div', { ref: el => { tipRefs[i].dot = el; }, style: { width: 10, height: 10, borderRadius: '50%', background: 'var(--bg)', border: '2px solid ' + (color || 'var(--accent)'), opacity: 0, transition: 'opacity .1s', boxShadow: '0 0 0 3px ' + (color || 'var(--accent)') + '22' } }));
    });
    // Invisible full-width overlay that tracks mouse X and activates nearest point
    const overlay = e('div', {
      style: { position: 'absolute', top: 0, left: 0, width: '100%', height: Hh, zIndex: 3, cursor: 'crosshair' },
      onMouseMove: ev => {
        const rect = ev.currentTarget.getBoundingClientRect();
        const relX = (ev.clientX - rect.left) / rect.width * W;
        let closest = 0, minDist = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.abs(pts[i].x - relX);
          if (d < minDist) { minDist = d; closest = i; }
        }
        activate(closest);
      },
      onMouseLeave: () => activate(-1)
    });
    return e('div', { style: { width: '100%', position: 'relative' } },
      e('svg', { viewBox: `0 0 ${W} ${Hh}`, style: { width: '100%', height: Hh, display: 'block' }, preserveAspectRatio: 'none' },
        e('defs', null,
          e('linearGradient', { id: uid, x1: 0, y1: 0, x2: 0, y2: 1 },
            e('stop', { offset: '0%', stopColor: color || 'var(--accent)', stopOpacity: 0.18 }),
            e('stop', { offset: '100%', stopColor: color || 'var(--accent)', stopOpacity: 0.0 }))),
        e('path', { d: areaPath, fill: `url(#${uid})` }),
        e('path', { d: linePath, fill: 'none', stroke: color || 'var(--accent)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' })),
      e('div', { style: { position: 'absolute', top: 0, left: 0, width: '100%', height: Hh } }, dots),
      overlay,
      labels ? e('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 4 } },
        labels.map((l, i) => e('span', { key: i }, l))) : null);
  },
  // Dual-line chart: seriesA with fill, seriesB as plain line overlay (independent y-scales)
  // opts: { hourMarkers: bool (show 9am/12pm/3pm/6pm vertical guides), dowLabels: string[] (ISO dates for Mon/Wed/Fri x-axis) }
  LineDual(seriesA, colorA, seriesB, colorB, labels, fmtA, fmtB, allLabels, opts) {
    opts = opts || {};
    const e = React.createElement;
    const W = 600, Hh = 160, padX = 8, padY = 12;
    const smooth = pts => {
      if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : '';
      let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        const cx = (p0.x + p1.x) / 2;
        d += ` C${cx.toFixed(2)},${p0.y.toFixed(2)} ${cx.toFixed(2)},${p1.y.toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
      }
      return d;
    };
    const mkPts = values => {
      const max = Math.max(...values, 0.001), min = Math.min(...values, 0);
      const flat = max === min, rng = flat ? 1 : (max - min), n = values.length;
      return values.map((v, i) => ({ x: padX + (i / (n - 1 || 1)) * (W - padX * 2), y: flat ? Hh / 2 : Hh - padY - ((v - min) / rng) * (Hh - padY * 2), v }));
    };
    const ptsA = mkPts(seriesA), ptsB = mkPts(seriesB);
    const lineA = smooth(ptsA), lineB = smooth(ptsB);
    const areaA = lineA + ` L${ptsA[ptsA.length-1].x.toFixed(2)},${(Hh-padY).toFixed(2)} L${ptsA[0].x.toFixed(2)},${(Hh-padY).toFixed(2)} Z`;
    const uid = 'ld' + Math.random().toString(36).slice(2, 6);
    const fA = fmtA || (v => String(v)), fB = fmtB || (v => String(v));

    // Y-axis grid lines based on seriesA (dials)
    const maxA = Math.max(...seriesA, 1), minA = Math.min(...seriesA, 0);
    const flatA = maxA === minA, rngA = flatA ? 1 : (maxA - minA);
    const gridStep = maxA <= 30 ? 5 : maxA <= 80 ? 20 : maxA <= 200 ? 50 : maxA <= 600 ? 100 : maxA <= 1500 ? 250 : 500;
    const gridTicks = [];
    for (let v = gridStep; v < maxA * 1.15; v += gridStep) gridTicks.push(v);
    const gridY = v => flatA ? Hh / 2 : Hh - padY - ((v - minA) / rngA) * (Hh - padY * 2);

    // Hour markers (decorative vertical guides for daily view) — positions as % of chart width
    const HOURS = [9, 12, 15, 18];
    const HOUR_LABELS = { 9: '9am', 12: '12pm', 15: '3pm', 18: '6pm' };
    const hourPct = h => ((padX + (h / 24) * (W - padX * 2)) / W * 100).toFixed(2) + '%';
    const hourSvgX = h => padX + (h / 24) * (W - padX * 2);

    // Day-of-week helpers: Mon=1, Wed=3, Fri=5
    const DOW_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const DOW_SHOW = new Set([1, 3, 5]);
    const parseDow = iso => { if (!iso) return null; const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? null : d.getDay(); };
    const fmtShort = iso => { const d = new Date(iso + 'T12:00:00'); return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]; };
    const dowSrc = opts.dowLabels || allLabels;

    const tipRefs = ptsA.map(() => ({ tip: null, dotA: null, dotB: null }));
    let activeIdx = -1;
    const activate = idx => {
      if (idx === activeIdx) return;
      if (activeIdx >= 0 && tipRefs[activeIdx]) {
        if (tipRefs[activeIdx].tip) tipRefs[activeIdx].tip.style.display = 'none';
        if (tipRefs[activeIdx].dotA) tipRefs[activeIdx].dotA.style.opacity = '0';
        if (tipRefs[activeIdx].dotB) tipRefs[activeIdx].dotB.style.opacity = '0';
      }
      activeIdx = idx;
      if (idx >= 0 && tipRefs[idx]) {
        if (tipRefs[idx].tip) tipRefs[idx].tip.style.display = 'block';
        if (tipRefs[idx].dotA) tipRefs[idx].dotA.style.opacity = '1';
        if (tipRefs[idx].dotB) tipRefs[idx].dotB.style.opacity = '1';
      }
    };
    const dots = ptsA.map((pA, i) => {
      const pB = ptsB[i];
      const dateLabel = allLabels && allLabels[i] ? allLabels[i] : null;
      return e('div', { key: i },
        e('div', { style: { position: 'absolute', left: (pA.x / W * 100).toFixed(2) + '%', top: (pA.y / Hh * 100).toFixed(2) + '%', transform: 'translate(-50%,-50%)', zIndex: 2, pointerEvents: 'none' } },
          e('div', { ref: el => { tipRefs[i].tip = el; }, style: { display: 'none', position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 13px', fontSize: 11, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', zIndex: 20, pointerEvents: 'none', boxShadow: '0 6px 24px rgba(0,0,0,.5)', minWidth: 110 } },
            dateLabel ? e('div', { style: { fontSize: 10, color: 'var(--text-mute)', fontWeight: 400, marginBottom: 5, letterSpacing: '.03em' } }, dateLabel) : null,
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12 } }, e('span', { style: { color: colorA } }, '●'), e('span', null, fA(pA.v))),
              e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12 } }, e('span', { style: { color: colorB } }, '●'), e('span', null, fB(pB.v))))),
          e('div', { ref: el => { tipRefs[i].dotA = el; }, style: { width: 9, height: 9, borderRadius: '50%', background: 'var(--bg)', border: '2px solid ' + colorA, opacity: 0, transition: 'opacity .1s' } })),
        pB ? e('div', { style: { position: 'absolute', left: (pB.x / W * 100).toFixed(2) + '%', top: (pB.y / Hh * 100).toFixed(2) + '%', transform: 'translate(-50%,-50%)', zIndex: 2, pointerEvents: 'none' } },
          e('div', { ref: el => { tipRefs[i].dotB = el; }, style: { width: 9, height: 9, borderRadius: '50%', background: 'var(--bg)', border: '2px solid ' + colorB, opacity: 0, transition: 'opacity .1s' } })) : null);
    });
    const overlay = e('div', {
      style: { position: 'absolute', top: 0, left: 0, width: '100%', height: Hh, zIndex: 3, cursor: 'crosshair' },
      onMouseMove: ev => {
        const rect = ev.currentTarget.getBoundingClientRect();
        const relX = (ev.clientX - rect.left) / rect.width * W;
        let closest = 0, minDist = Infinity;
        for (let i = 0; i < ptsA.length; i++) { const dist = Math.abs(ptsA[i].x - relX); if (dist < minDist) { minDist = dist; closest = i; } }
        activate(closest);
      },
      onMouseLeave: () => activate(-1)
    });

    // Y-axis HTML labels (not SVG text — avoids stretch from preserveAspectRatio:none)
    const yLabels = e('div', { style: { position: 'absolute', top: 0, left: 0, width: '100%', height: Hh, pointerEvents: 'none', zIndex: 1 } },
      gridTicks.map(v => {
        const gy = gridY(v);
        if (gy < padY || gy > Hh - padY) return null;
        return e('div', { key: v, style: { position: 'absolute', top: (gy / Hh * 100).toFixed(1) + '%', left: 5, transform: 'translateY(-100%)', fontSize: 9.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", whiteSpace: 'nowrap', lineHeight: 1 } }, String(v));
      }));

    // Hour markers HTML labels (avoids SVG text stretch)
    const hourLabels = opts.hourMarkers ? e('div', { style: { position: 'absolute', bottom: 0, left: 0, width: '100%', pointerEvents: 'none', zIndex: 1 } },
      HOURS.map(h => e('div', { key: h, style: { position: 'absolute', left: hourPct(h), transform: 'translateX(-50%)', fontSize: 9.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", whiteSpace: 'nowrap' } }, HOUR_LABELS[h]))) : null;

    // Combined x-axis: only Mon/Wed/Fri — day abbr on top, date below — or hour labels for daily view
    const useDow = dowSrc && dowSrc.length > 1;
    const xAxis = useDow ? e('div', { style: { position: 'relative', height: 30, marginTop: 4 } },
      ptsA.map((p, i) => {
        const iso = dowSrc[i];
        const dow = parseDow(iso);
        if (dow === null || !DOW_SHOW.has(dow)) return null;
        return e('div', { key: i, style: { position: 'absolute', left: (p.x / W * 100).toFixed(2) + '%', transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' } },
          e('div', { style: { fontSize: 9.5, fontWeight: 700, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", letterSpacing: '.04em' } }, DOW_ABBR[dow]),
          e('div', { style: { fontSize: 9, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", opacity: 0.65, marginTop: 1 } }, fmtShort(iso)));
      })) : (labels ? e('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 4 } },
        labels.map((l, i) => e('span', { key: i }, l))) : null);

    return e('div', { style: { width: '100%', position: 'relative' } },
      e('div', { style: { position: 'relative' } },
        e('svg', { viewBox: `0 0 ${W} ${Hh}`, style: { width: '100%', height: Hh, display: 'block' }, preserveAspectRatio: 'none' },
          e('defs', null,
            e('linearGradient', { id: uid, x1: 0, y1: 0, x2: 0, y2: 1 },
              e('stop', { offset: '0%', stopColor: colorA, stopOpacity: 0.18 }),
              e('stop', { offset: '100%', stopColor: colorA, stopOpacity: 0.0 }))),
          // Y-axis grid lines only (no text — labels rendered as HTML below)
          ...gridTicks.map(v => {
            const gy = gridY(v);
            if (gy < padY || gy > Hh - padY) return null;
            return e('line', { key: 'g' + v, x1: padX, y1: gy, x2: W - padX, y2: gy, stroke: 'var(--border-soft)', strokeDasharray: '2,5', strokeWidth: 0.7 });
          }),
          // Hour marker vertical lines only (labels rendered as HTML)
          ...(opts.hourMarkers ? HOURS.map(h => e('line', { key: 'h' + h, x1: hourSvgX(h), y1: padY, x2: hourSvgX(h), y2: Hh - padY, stroke: 'var(--border)', strokeDasharray: '3,5', strokeWidth: 0.7 })) : []),
          e('path', { d: areaA, fill: `url(#${uid})` }),
          e('path', { d: lineA, fill: 'none', stroke: colorA, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }),
          e('path', { d: lineB, fill: 'none', stroke: colorB, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round', strokeDasharray: 'none' })),
        yLabels,
        e('div', { style: { position: 'absolute', top: 0, left: 0, width: '100%', height: Hh } }, dots),
        overlay,
        hourLabels),
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginTop: 6, justifyContent: 'flex-end' } },
        e('span', { style: { fontSize: 11, color: 'var(--text-mute)', display: 'flex', alignItems: 'center', gap: 5 } }, e('span', { style: { display: 'inline-block', width: 16, height: 2, background: colorA, borderRadius: 1 } }), 'Dials'),
        e('span', { style: { fontSize: 11, color: 'var(--text-mute)', display: 'flex', alignItems: 'center', gap: 5 } }, e('span', { style: { display: 'inline-block', width: 16, height: 2, background: colorB, borderRadius: 1 } }), 'Appointments')),
      xAxis);
  },

  Table(cols, rows, opts) {
    const e = React.createElement; opts = opts || {};
    return e('div', { style: { overflowX: 'auto', borderRadius: 12, border: '1px solid var(--border-soft)' } },
      e('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: opts.min || 640 } },
        e('thead', null, e('tr', { style: { background: 'var(--bg-2)' } },
          cols.map((c, i) => e('th', { key: i, style: { textAlign: c.align || 'left', padding: '7px 14px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-soft)' } }, c.label)))),
        e('tbody', null, rows.length
          ? rows.map((r, ri) => e('tr', { key: ri, onClick: r._onClick, style: { borderBottom: ri < rows.length - 1 ? '1px solid var(--border-soft)' : 'none', cursor: r._onClick ? 'pointer' : 'default' } },
            cols.map((c, ci) => e('td', { key: ci, style: { padding: '7px 14px', textAlign: c.align || 'left', color: 'var(--text-dim)', whiteSpace: c.wrap ? 'normal' : 'nowrap' } },
              c.render ? c.render(r) : r[c.key]))))
          : [e('tr', { key: 'empty' }, e('td', { colSpan: cols.length, style: { padding: '34px', textAlign: 'center', color: 'var(--text-mute)' } }, opts.empty || 'Nothing here yet'))])));
  },
  SectionHd(title, right) {
    return React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' } },
      UI.Hd(title), right || null);
  },
  Seg(value, onChange, opts) {
    const e = React.createElement;
    return e('div', { style: { display: 'inline-flex', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 3, gap: 2 } },
      opts.map(o => e('button', { key: o.v, onClick: () => onChange(o.v), style: { padding: '6px 13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, background: value === o.v ? 'var(--surface-2)' : 'transparent', color: value === o.v ? 'var(--text)' : 'var(--text-mute)' } }, o.l)));
  },
};
