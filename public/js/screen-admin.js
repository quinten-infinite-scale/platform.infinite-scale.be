// Subclient account helpers — standalone so they're always in scope regardless of `this` binding
const SC_KEY = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc4MjQ1NDUxOCwgImV4cCI6IDE5NDAxMzQ1MTh9.d7t6XFTyksADGN-ZaER4bNhc85TSn0g12FRsLGEbaU0';
const SC_DB = 'https://database.infinite-scale.be';

// Eagerly load contract template overrides at boot so generate() can use them
(function loadCtplOverrides() {
  window.__ctplOverrides = window.__ctplOverrides || {};
  fetch(SC_DB + '/rest/v1/contract_templates?select=slug,body', {
    headers: { apikey: SC_KEY, Authorization: 'Bearer ' + SC_KEY }
  }).then(r => r.json()).then(rows => {
    window.__ctplOverrides = {};
    (rows || []).forEach(r => { window.__ctplOverrides[r.slug] = r.body; });
    window.__ctplOverridesLoaded = true;
    window.__ctplOverridesLoading = false;
  }).catch(() => { window.__ctplOverridesLoaded = true; });
})();

async function scCreateAccount(app, clientId, subclientId, email, name) {
  const res = await fetch(SC_DB + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: SC_KEY, Authorization: 'Bearer ' + SC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'InfiniteScale2026!', email_confirm: true }),
  });
  const user = await res.json();
  if (!user.id) throw new Error(user.msg || user.error_description || 'Failed to create user');
  const uid = user.id;
  await fetch(SC_DB + '/rest/v1/profiles?on_conflict=id', {
    method: 'POST',
    headers: { apikey: SC_KEY, Authorization: 'Bearer ' + SC_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: uid, name, email, role: 'subclient' }),
  });
  const cl = app.state.data.clients.find(c => c.id === clientId);
  const newSubs = (cl.subclients || []).map(sc => sc.id === subclientId ? { ...sc, email, user_id: uid } : sc);
  await API.updateClient(clientId, { subclients: newSubs });
  app.mutLocal(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.subclients = newSubs; });
  app.toast('Account created', name + ' can now log in', 'var(--up)');
}

async function scDeleteAccount(app, clientId, subclientId) {
  const cl = app.state.data.clients.find(c => c.id === clientId);
  const sc = (cl.subclients || []).find(x => x.id === subclientId);
  if (!sc || !sc.user_id) return;
  await fetch(SC_DB + '/auth/v1/admin/users/' + sc.user_id, {
    method: 'DELETE',
    headers: { apikey: SC_KEY, Authorization: 'Bearer ' + SC_KEY },
  });
  await fetch(SC_DB + '/rest/v1/profiles?id=eq.' + sc.user_id, {
    method: 'DELETE',
    headers: { apikey: SC_KEY, Authorization: 'Bearer ' + SC_KEY },
  });
  const newSubs = (cl.subclients || []).map(x => x.id === subclientId ? { ...x, email: undefined, user_id: undefined } : x);
  await API.updateClient(clientId, { subclients: newSubs });
  app.mutLocal(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.subclients = newSubs; });
  app.toast('Account removed', sc.name + ' can no longer log in', 'var(--text-mute)');
}

// Admin screens
const ScreenAdmin = {
  scrAdmin(d, s) {
    if (!this._pollTimer) this._startPolling();
    const e = React.createElement; const r = s.route;
    if (r === 'dashboard') return this._admDash(d, s);
    if (r === 'finances') return this._admFin(d, s);
    if (r === 'stats') return this._admStats(d, s);
    if (r === 'apptadmin') return this._admAppointments(d, s);
    if (r === 'clients') return this._admClients(d, s);
    if (r === 'agents') return this._admAgents(d, s);
    if (r === 'eodadmin') return this._admEod(d, s);
    if (r === 'timeline') return this._admTimeline(d, s);
    if (r === 'prospects') return this._admProspects(d, s);
    if (r === 'recruitment') return this._admRecruit(d, s);
    if (r === 'contracts') return this._admContracts(d, s);
    if (r === 'rooster') return this._admRooster(d, s);
    if (r === 'activity') return this._admActivity(d, s);
    if (r === 'todos') return this._admTodos(d, s);
    if (r === 'whatsapp') return this._admWhatsApp(d, s);
    if (r === 'settings') { const session = typeof SB !== 'undefined' ? SB.getSession() : null; return this._settings(d, s, { name: (session?.user?.user_metadata?.name || session?.user?.email?.split('@')[0] || 'Admin'), email: session?.user?.email || 'quinten@infinite-scale.be' }); }
    return e('div', null, '');
  },

  _fin(d) {
    const now = new Date();
    const currentYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const today = this.iso(this.today());
    const cRate = (a) => { try { const fb = a.clientFeedback ? JSON.parse(a.clientFeedback) : null; if (fb && fb._rn && fb.revenue != null) return fb.revenue; } catch {} const cl = d.clients.find(c => c.id === a.client); if (a.sub && cl) { const sc = (cl.subclients || []).find(s => s.id === a.sub || s.name === a.sub); if (sc && sc.rate != null) return sc.rate; } return (cl && cl.rate) || 0; };
    const aRate = (a) => { if (a.client === 'c15') return rnAgentPay(a) ?? 0; const ag = d.agents.find(g => g.id === a.agent); return (ag && ((ag.rates || {})[a.sub] || (ag.rates || {})[a.client])) || 0; };
    // Expected: all billable appointments logged this month (regardless of invoiced status)
    const curMonthBillable = d.appointments.filter(a => a.dateLog && a.dateLog.startsWith(currentYM) && a.status !== 'cancel' && a.status !== 'no_show');
    const expected = curMonthBillable.reduce((x, a) => x + cRate(a), 0);
    // Invoiced: all appointments formally marked as invoiced
    const invoiced = d.appointments.filter(a => a.invoiced && a.status !== 'cancel' && a.status !== 'no_show').reduce((x, a) => x + cRate(a), 0);
    const received = d.appointments.filter(a => a.paid && a.status !== 'cancel' && a.status !== 'no_show').reduce((x, a) => x + cRate(a), 0);
    const agentCost = curMonthBillable.filter(a => a.status === 'show').reduce((x, a) => x + aRate(a), 0);
    const revToday = d.appointments.filter(a => a.dateLog === today && a.status !== 'cancel').reduce((x, a) => x + cRate(a), 0);
    const costToday = d.appointments.filter(a => a.dateLog === today && a.status !== 'cancel').reduce((x, a) => x + aRate(a), 0);
    const pnl = expected - agentCost;
    const pnlToday = revToday - costToday;
    const margin = expected > 0 ? Math.round(pnl / expected * 100) : null;
    const marginToday = revToday > 0 ? Math.round(pnlToday / revToday * 100) : null;
    const allLogged = d.appointments.filter(a => a.status !== 'cancel');
    const allTimeRev = allLogged.reduce((x, a) => x + cRate(a), 0);
    const allTimeCost = allLogged.reduce((x, a) => x + aRate(a), 0);
    const allTimePnL = allTimeRev - allTimeCost;
    const allTimeMargin = allTimeRev > 0 ? Math.round(allTimePnL / allTimeRev * 100) : null;
    return { expected, invoiced, received, agentCost, pnl, revToday, pnlToday, margin, marginToday, allTimePnL, allTimeMargin };
  },

  _admDash(d, s) {
    const e = React.createElement; const F = this._fin(d); const today = this.iso(this.today());
    const dialsToday = Object.keys(d.dials).reduce((x, id) => x + ((d.dials[id] || {})[today] || 0), 0);
    const apptsToday = d.appointments.filter(a => a.dateLog === today).length;
    const recruitStages = (() => { try { return JSON.parse((d.settings || {}).recruit_stages || '[]'); } catch(_) { return []; } })();
    const stageLabel = id => { const sg = recruitStages.find(s => s.id === id); return sg ? sg.label : id.replace(/_/g, ' '); };
    const recruitOverrides = (() => { try { return JSON.parse((d.settings || {}).recruit_stage_overrides || '{}'); } catch(_) { return {}; } })();
    const effectiveStage = r => recruitOverrides[r.id] || r.stage;
    const openHires = d.recruits.filter(r => { const st = effectiveStage(r); return st !== 'hired' && st !== 'not_qualified'; });

    const marginBadge = (pct) => (pct === null || pct === undefined) ? null : e('span', { style: { fontSize: 10.5, fontWeight: 700, color: pct >= 0 ? 'var(--up)' : 'var(--down)', background: pct >= 0 ? 'oklch(0.22 0.08 152 / .5)' : 'oklch(0.22 0.08 0 / .5)', padding: '2px 7px', borderRadius: 20, letterSpacing: '.01em' } }, pct + '% margin');
    const statCard = (label, val, sub, onClick, margin) => e('div', {
      onClick, style: { padding: '16px 18px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 6, cursor: onClick ? 'pointer' : 'default', transition: 'border-color .15s, background .15s' },
      onMouseEnter: ev => { if (onClick) { ev.currentTarget.style.borderColor = 'var(--accent)'; ev.currentTarget.style.background = 'oklch(0.22 0.06 194 / .4)'; } },
      onMouseLeave: ev => { ev.currentTarget.style.borderColor = 'var(--border-soft)'; ev.currentTarget.style.background = 'var(--surface)'; },
    },
      e('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em' } }, label),
      e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 26, color: 'var(--text)', lineHeight: 1.1 } }, val),
      e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
        e('div', { style: { fontSize: 12, color: 'var(--text-mute)' } }, sub),
        marginBadge(margin)));

    const expandedEventId = s.expandedEventId;

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      UI.Grid('repeat(auto-fit,minmax(190px,1fr))', 14,
        statCard('Revenue today', this.euro(F.revToday), 'expected · live', () => this.setState({ route: 'finances', finPeriod: 'daily' }), F.marginToday),
        statCard('Revenue this month', this.euro(F.expected), 'expected · month', () => this.setState({ route: 'finances', finPeriod: 'monthly' }), F.margin),
        statCard('Dials today', String(dialsToday), 'all agents', () => this.setState({ route: 'stats' })),
        statCard('Appointments today', String(apptsToday), 'all clients', () => this.setState({ route: 'apptadmin', fDateFrom: today, fDateTo: today, fmonth: 'all' }))),
      UI.Grid('minmax(0,1.4fr) minmax(0,1fr)', 18,
        UI.C({ padding: 0, overflow: 'hidden' },
          e('div', { style: { padding: '15px 18px' } }, UI.Hd('Team status', { fontSize: 15 })),
          UI.Table([
            { label: 'Agent', render: x => e('span', { onClick: () => this.openModal('agentDayStats', { id: x.id }), style: { color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 } }, x.name) },
            { label: 'Status', render: x => UI.Row({}, e('span', { style: { width: 8, height: 8, borderRadius: '50%', background: x.working ? 'var(--up)' : 'var(--text-mute)', flexShrink: 0 } }), e('span', { style: { fontSize: 12.5, color: x.working ? 'var(--up)' : 'var(--text-mute)', fontWeight: 600 } }, x.working ? 'Working' : 'Offline')) },
            { label: 'Dials today', align: 'right', render: x => UI.Mono((d.dials[x.id] || {})[today] || 0, { fontWeight: 700, color: 'var(--text)' }) },
            { label: 'Appts today', align: 'right', render: x => UI.Mono(d.appointments.filter(a => a.agent === x.id && a.dateLog === today).length, { fontWeight: 700, color: 'var(--text)' }) },
            { label: 'Clients', align: 'right', render: x => String((x.clients || []).length) },
          ], d.agents.filter(a => a.active), { min: 520 })),
        UI.Col({ gap: 18 },
          UI.C({}, UI.Hd('Open hiring', { fontSize: 15, marginBottom: 12 }),
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
              openHires.slice(0, 4).map(h => e('div', { key: h.id, onClick: () => this.setState({ route: 'recruitment' }), style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 11px', borderRadius: 9, background: 'var(--bg-2)', cursor: 'pointer', transition: 'background .15s' }, onMouseEnter: ev => { ev.currentTarget.style.background = 'var(--surface-2)'; }, onMouseLeave: ev => { ev.currentTarget.style.background = 'var(--bg-2)'; } },
                e('span', { style: { fontSize: 13, fontWeight: 600 } }, h.name),
                UI.Pill(stageLabel(effectiveStage(h)), 'var(--violet)', 'oklch(0.30 0.05 295)'))))),
          UI.C({}, UI.Hd('Quick actions', { fontSize: 15, marginBottom: 12 }),
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              [['Add client', () => this.openModal('createClient')], ['Create agent', () => this.openModal('createAgent')], ['New contract', () => this.openModal('wizard', { step: 0 })]].map(([label, fn]) =>
                UI.Btn(label, fn, 'ghost', { width: '100%', textAlign: 'left' }))))),
      UI.C({},
        UI.SectionHd('Updates & events', UI.Btn('Add event', () => this.setState({ addingEvent: !s.addingEvent }), 'soft', { padding: '5px 12px', fontSize: 12 })),
        s.addingEvent ? e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: 14, borderRadius: 11, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
          e('input', { value: s.form.evTitle || '', placeholder: 'Event title…', onChange: ev => this.setForm('evTitle', ev.target.value), style: { flex: '2 1 180px', padding: '8px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' } }),
          e('input', { value: s.form.evTag || '', placeholder: 'Tag (e.g. Update)', onChange: ev => this.setForm('evTag', ev.target.value), style: { flex: '1 1 120px', padding: '8px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' } }),
          e('input', { type: 'date', value: s.form.evDate || '', onChange: ev => this.setForm('evDate', ev.target.value), style: { flex: '1 1 140px', padding: '8px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' } }),
          e('textarea', { value: s.form.evDesc || '', placeholder: 'Description (optional)…', rows: 2, onChange: ev => this.setForm('evDesc', ev.target.value), style: { flex: '3 1 100%', padding: '8px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' } }),
          UI.Btn('Save event', () => { this.addEvent(s.form.evTitle, s.form.evTag, s.form.evDate, s.form.evDesc); this.setState({ addingEvent: false }); }, 'primary', { padding: '8px 14px', fontSize: 12 })) : null,
        d.events.length ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          d.events.map(ev => e('div', { key: ev.id, style: { borderRadius: 10, background: 'var(--bg-2)', border: '1px solid ' + (expandedEventId === ev.id ? 'var(--accent)' : 'var(--border-soft)'), overflow: 'hidden' } },
            e('div', { onClick: () => this.setState({ expandedEventId: expandedEventId === ev.id ? null : ev.id }), style: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', cursor: 'pointer' } },
              UI.Pill(ev.tag || 'Update', 'var(--accent)', 'oklch(0.30 0.10 194)'),
              e('span', { style: { flex: 1, fontSize: 13.5, fontWeight: 600 } }, ev.title),
              UI.Mono(this.fmtDate(ev.date), { fontSize: 11.5, color: 'var(--text-mute)' }),
              e('span', { style: { fontSize: 11, color: 'var(--text-mute)', marginLeft: 4 } }, expandedEventId === ev.id ? '▲' : '▼'),
              e('button', { onClick: ev2 => { ev2.stopPropagation(); this.deleteEvent(ev.id); }, style: { width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--down)', cursor: 'pointer', fontSize: 14, display: 'grid', placeItems: 'center', flexShrink: 0 } }, '×')),
            expandedEventId === ev.id ? e('div', { style: { padding: '0 12px 14px', borderTop: '1px solid var(--border-soft)' } },
              e('div', { style: { paddingTop: 12, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: ev.desc ? 12 : 0 } }, ev.desc || e('span', { style: { color: 'var(--text-mute)', fontStyle: 'italic' } }, 'No description added.')),
              e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 } },
                e('label', { style: { display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-dim)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' } },
                  e('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }, e('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }), e('polyline', { points: '17 8 12 3 7 8' }), e('line', { x1: 12, y1: 3, x2: 12, y2: 15 })),
                  'Attach file',
                  e('input', { type: 'file', accept: 'image/*,.pdf,.doc,.docx', style: { display: 'none' }, onChange: ev2 => this.toast('File', ev2.target.files[0]?.name + ' attached (upload coming soon)', 'var(--accent)') })),
                ev.attachments?.length ? ev.attachments.map((att, i) => e('a', { key: i, href: att.url, target: '_blank', rel: 'noopener', style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--accent)', fontSize: 12.5, textDecoration: 'none' } }, att.name)) : null)) : null))) :
          UI.Sub('No events yet. Add one above.'))));
  },

  _admFin(d, s) {
    const e = React.createElement;
    const finTab = s.finTab || 'overview';
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      UI.Seg(finTab, v => this.setState({ finTab: v }), [
        { v: 'overview', l: 'Overzicht' },
        { v: 'pnl', l: 'P&L' },
        { v: 'invoices', l: 'Facturen' },
      ]),
      finTab === 'pnl' ? ScreenAdmin._admPnl.call(this, d, s) :
      finTab === 'invoices' ? ScreenAdmin._admInvoices.call(this, d, s) :
      ScreenAdmin._admFinOverview.call(this, d, s)
    );
  },

  _admFinOverview(d, s) {
    const e = React.createElement;
    const F = this._fin(d);
    const now = new Date();
    const iso = d2 => d2.toISOString().slice(0, 10);
    const period = s.finPeriod || 'monthly';
    const offset = s.finOffset || 0;

    const getRate = a => {
      try { const fb = a.clientFeedback ? JSON.parse(a.clientFeedback) : null; if (fb && fb._rn && fb.revenue != null) return fb.revenue; } catch {}
      const cl = d.clients.find(c => c.id === a.client);
      if (a.sub && cl) { const sc = (cl.subclients || []).find(sc2 => sc2.id === a.sub || sc2.name === a.sub); if (sc && sc.rate != null) return sc.rate; }
      return (cl && cl.rate) || 0;
    };
    const getCost = a => { const ag = d.agents.find(g => g.id === a.agent); return (ag && ((ag.rates || {})[a.sub] || (ag.rates || {})[a.client])) || 0; };

    // ── Period window ──────────────────────────────────────────────────
    let periodLabel = '', periodKey = '', prevKey = '';
    let periodStart = '', periodEnd = '';

    if (period === 'daily') {
      const d2 = new Date(now); d2.setDate(d2.getDate() - offset);
      const d3 = new Date(now); d3.setDate(d3.getDate() - offset - 1);
      periodKey = iso(d2);
      prevKey = iso(d3);
      periodLabel = d2.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
      periodStart = periodKey; periodEnd = periodKey;
    } else if (period === 'weekly') {
      const base = new Date(now);
      const dow = base.getDay() || 7; base.setDate(base.getDate() - (dow - 1));
      const wStart = new Date(base); wStart.setDate(wStart.getDate() - offset * 7);
      const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 6);
      const wStartPrev = new Date(wStart); wStartPrev.setDate(wStartPrev.getDate() - 7);
      const wEndPrev = new Date(wEnd); wEndPrev.setDate(wEndPrev.getDate() - 7);
      periodStart = iso(wStart); periodEnd = iso(wEnd);
      prevKey = iso(wStartPrev) + '|' + iso(wEndPrev);
      periodKey = periodStart + '|' + periodEnd;
      periodLabel = wStart.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) + ' – ' + wEnd.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
    } else {
      const d2 = new Date(now); d2.setDate(1); d2.setMonth(d2.getMonth() - offset);
      const d3 = new Date(now); d3.setDate(1); d3.setMonth(d3.getMonth() - offset - 1);
      periodKey = d2.getFullYear() + '-' + String(d2.getMonth() + 1).padStart(2, '0');
      prevKey = d3.getFullYear() + '-' + String(d3.getMonth() + 1).padStart(2, '0');
      periodLabel = d2.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
      periodStart = periodKey; periodEnd = periodKey + '-99';
    }

    const inPeriod = key => a => {
      if (period === 'daily') return a.dateLog === key;
      if (period === 'weekly') { const [ws, we] = key.split('|'); return a.dateLog >= ws && a.dateLog <= we; }
      return a.dateLog && a.dateLog.startsWith(key);
    };
    const inPeriodAppt = key => a => {
      const dt = a.dateAppt || a.dateLog || '';
      if (period === 'daily') return dt === key;
      if (period === 'weekly') { const [ws, we] = key.split('|'); return dt >= ws && dt <= we; }
      return dt.startsWith(key);
    };

    const curLoggedAll = d.appointments.filter(a => inPeriod(periodKey)(a));
    const curLogged  = curLoggedAll.filter(a => a.status !== 'cancel');
    const curLoggedCancel = curLoggedAll.filter(a => a.status === 'cancel').length;
    const curLoggedNoShow = curLogged.filter(a => a.status === 'no_show').length;
    const curInPeriodAll = d.appointments.filter(a => inPeriodAppt(periodKey)(a));
    const curInPeriod = curInPeriodAll.filter(a => a.status !== 'cancel' && a.status !== 'no_show');
    const curInPeriodCancel = curInPeriodAll.filter(a => a.status === 'cancel').length;
    const curInPeriodNoShow = curInPeriodAll.filter(a => a.status === 'no_show').length;
    const curInvoiced = d.appointments.filter(a => a.invoiced && a.status !== 'cancel' && a.status !== 'no_show' && inPeriodAppt(periodKey)(a));
    const prevLogged  = d.appointments.filter(a => a.status !== 'cancel' && inPeriod(prevKey)(a));
    const prevInPeriod = d.appointments.filter(a => a.status !== 'cancel' && a.status !== 'no_show' && inPeriodAppt(prevKey)(a));

    const revLogged   = curLogged.reduce((x, a) => x + getRate(a), 0);
    const revInPeriod = curInPeriod.reduce((x, a) => x + getRate(a), 0);
    const revInvoiced = curInvoiced.reduce((x, a) => x + getRate(a), 0);
    const costLogged  = curLogged.reduce((x, a) => x + getCost(a), 0);
    const costInPeriod = curInPeriod.reduce((x, a) => x + getCost(a), 0);
    const pnlLogged   = revLogged - costLogged;
    const pnlInPeriod = revInPeriod - costInPeriod;
    const prevRevLogged = prevLogged.reduce((x, a) => x + getRate(a), 0);
    const prevRevInPeriod = prevInPeriod.reduce((x, a) => x + getRate(a), 0);

    const pct = (a, b) => { if (!b) return a > 0 ? '+100%' : '—'; const v = Math.round((a - b) / b * 100); return (v >= 0 ? '+' : '') + v + '%'; };
    const pctCol = (a, b) => a >= b ? 'var(--up)' : 'var(--down)';
    const delta = (a, b) => e('span', { style: { fontSize: 12, fontWeight: 700, color: pctCol(a, b) } }, pct(a, b) + ' vs vorige');

    // ── Period nav bar ─────────────────────────────────────────────────
    const periodNav = e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        e('button', { onClick: () => this.setState({ finOffset: offset + 1 }), style: { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, '←'),
        e('div', { style: { minWidth: 220, textAlign: 'center', fontWeight: 700, fontSize: 15, color: 'var(--text)', textTransform: 'capitalize' } }, periodLabel),
        offset > 0
          ? e('button', { onClick: () => this.setState({ finOffset: offset - 1 }), style: { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, '→')
          : e('div', { style: { width: 32 } })),
      UI.Seg(period, v => this.setState({ finPeriod: v, finOffset: 0 }), [{ v: 'daily', l: 'Dag' }, { v: 'weekly', l: 'Week' }, { v: 'monthly', l: 'Maand' }]));

    // ── Big paired billboard cards ─────────────────────────────────────
    const statusPill = (label, count, total, bg, ink) => {
      const p = total > 0 ? Math.round(count / total * 100) : 0;
      return e('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
        e('span', { style: { fontSize: 11.5, fontWeight: 700, color: ink, background: bg, padding: '2px 8px', borderRadius: 20 } }, label + ': ' + count),
        e('span', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 600 } }, p + '%'));
    };

    // Cross-period: appointments in this period but booked (logged) in the previous period
    const crossPeriodCount = period === 'monthly'
      ? curInPeriod.filter(a => (a.dateLog || '').startsWith(prevKey)).length
      : 0;
    const crossPeriodPct = curInPeriod.length > 0 ? Math.round(crossPeriodCount / curInPeriod.length * 100) : 0;

    const billboard = (title, accent, appts, rev, cost, prevRev, cancelCount, noShowCount, totalAll, crossCount, crossPct) =>
      e('div', { style: { flex: '1 1 260px', borderRadius: 16, border: '1px solid var(--border)', background: 'var(--surface)', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', position: 'relative' } },
        e('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: '16px 16px 0 0' } }),
        e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 } }, title),
        e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 } },
          e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 800, fontSize: 34, color: accent, lineHeight: 1 } }, this.euro(rev)),
          delta(rev, prevRev)),
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 } },
          e('span', { style: { fontSize: 13, color: 'var(--text-dim)' } },
            e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 16, color: 'var(--text)' } }, appts),
            ' afspraken')),
        e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: crossCount > 0 ? 8 : 16 } },
          cancelCount > 0 ? statusPill('Cancel', cancelCount, totalAll, 'oklch(0.22 0.06 0 / .4)', 'var(--down)') : null,
          noShowCount > 0 ? statusPill('No-show', noShowCount, totalAll, 'oklch(0.22 0.05 50 / .4)', 'var(--warn)') : null),
        crossCount > 0 ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 } },
          e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', background: 'oklch(0.22 0.04 256 / .4)', padding: '2px 8px', borderRadius: 20 } }, 'Vorige maand: ' + crossCount),
          e('span', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 600 } }, crossPct + '%')) : null,
        e('div', { style: { borderTop: '1px solid var(--border-soft)', paddingTop: 14, display: 'flex', gap: 24 } },
          e('div', null,
            e('div', { style: { fontSize: 10.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 } }, 'Agentkosten'),
            e('div', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 14, color: 'var(--down)' } }, this.euro(cost))),
          e('div', null,
            e('div', { style: { fontSize: 10.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 } }, 'P&L'),
            e('div', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 14, color: rev - cost >= 0 ? 'var(--up)' : 'var(--down)' } }, this.euro(rev - cost)))));

    const billboards = e('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap' } },
      billboard('Ingeboekt', 'var(--info)', curLogged.length, revLogged, costLogged, prevRevLogged, curLoggedCancel, curLoggedNoShow, curLoggedAll.length, 0, 0),
      billboard('In de ' + (period === 'daily' ? 'dag' : period === 'weekly' ? 'week' : 'maand'), 'var(--accent)', curInPeriod.length, revInPeriod, costInPeriod, prevRevInPeriod, curInPeriodCancel, curInPeriodNoShow, curInPeriodAll.length, crossPeriodCount, crossPeriodPct));

    // ── Small cards row ────────────────────────────────────────────────
    const periodMargin = revLogged > 0 ? Math.round(pnlLogged / revLogged * 100) : null;
    const smallCards = e('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap' } },
      this._finCard('Gefactureerd', this.euro(revInvoiced), curInvoiced.length + ' afspraken · periode', 'var(--up)'),
      this._finCard('All time invoiced', this.euro(F.invoiced), 'na statussluitdatum', 'var(--warn)'),
      this._finCard('All time paid', this.euro(F.received), 'via a.paid vlag · handmatig', 'var(--up)'),
      this._finCard('All time P&L', this.euro(F.pnl), 'omzet − agentkosten', 'var(--accent)'),
      this._finCard('Marge ' + periodLabel, periodMargin !== null ? periodMargin + '%' : '—', 'ingeboekt · netto marge', periodMargin !== null && periodMargin >= 50 ? 'var(--up)' : periodMargin !== null && periodMargin >= 20 ? 'var(--warn)' : 'var(--down)'));

    // ── Agent cost breakdown (toggle) ──────────────────────────────────
    const agentCostRowsLogged = d.agents.map(ag => {
      const agAppts = curLogged.filter(a => a.agent === ag.id);
      const agCost = agAppts.reduce((x, a) => x + getCost(a), 0);
      const agRev = agAppts.reduce((x, a) => x + getRate(a), 0);
      return { name: ag.name, count: agAppts.length, cost: agCost, rev: agRev };
    }).filter(r => r.count > 0).sort((a, b) => b.cost - a.cost);

    const agentCostRowsInvoiced = d.agents.map(ag => {
      const agAppts = curInvoiced.filter(a => a.agent === ag.id);
      const agCost = agAppts.reduce((x, a) => x + getCost(a), 0);
      const agRev = agAppts.reduce((x, a) => x + getRate(a), 0);
      return { name: ag.name, count: agAppts.length, cost: agCost, rev: agRev };
    }).filter(r => r.count > 0).sort((a, b) => b.cost - a.cost);

    const costInvoiced = agentCostRowsInvoiced.reduce((x, r) => x + r.cost, 0);

    const agentCostBlock = (agentCostRowsLogged.length > 0 || agentCostRowsInvoiced.length > 0) ? UI.C({ padding: 0, overflow: 'hidden' },
      e('div', { onClick: () => this.setState({ finAgentCostOpen: !s.finAgentCostOpen }), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', background: s.finAgentCostOpen ? 'oklch(0.18 0.02 256 / .5)' : 'var(--surface)' } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          UI.Hd('Agentkosten detail', { fontSize: 14 }),
          e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 13, color: 'var(--down)' } }, this.euro(costLogged)),
          e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '· ingeboekt · ' + periodLabel)),
        e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: s.finAgentCostOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
      s.finAgentCostOpen ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 } },
        // Ingeboekt section
        e('div', null,
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } },
            e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'Ingeboekt'),
            e('span', { style: { fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 700, color: 'var(--down)' } }, this.euro(costLogged))),
          UI.Table([
            { label: 'Agent', render: r => e('span', { style: { fontWeight: 600, color: 'var(--text)' } }, r.name) },
            { label: 'Afspraken', align: 'right', render: r => UI.Mono(r.count, { color: 'var(--text-dim)' }) },
            { label: 'Omzet', align: 'right', render: r => UI.Mono(this.euro(r.rev), { color: 'var(--info)', fontWeight: 700 }) },
            { label: 'Kosten', align: 'right', render: r => UI.Mono(this.euro(r.cost), { color: 'var(--down)', fontWeight: 700 }) },
          ], agentCostRowsLogged, { min: 360, empty: 'Geen data.' })),
        // Gefactureerd section
        e('div', null,
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } },
            e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'Gefactureerd'),
            e('span', { style: { fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 700, color: 'var(--down)' } }, this.euro(costInvoiced))),
          UI.Table([
            { label: 'Agent', render: r => e('span', { style: { fontWeight: 600, color: 'var(--text)' } }, r.name) },
            { label: 'Afspraken', align: 'right', render: r => UI.Mono(r.count, { color: 'var(--text-dim)' }) },
            { label: 'Omzet', align: 'right', render: r => UI.Mono(this.euro(r.rev), { color: 'var(--up)', fontWeight: 700 }) },
            { label: 'Kosten', align: 'right', render: r => UI.Mono(this.euro(r.cost), { color: 'var(--down)', fontWeight: 700 }) },
          ], agentCostRowsInvoiced, { min: 360, empty: 'Geen gefactureerde afspraken in deze periode.' }))) : null) : null;

    // ── Month-by-month table ───────────────────────────────────────────
    // Build Jan–Dec of current year
    const months = [];
    for (let i = 0; i <= 11; i++) {
      const d2 = new Date(now.getFullYear(), i, 1);
      const ym = iso(d2).slice(0, 7);
      const label = d2.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });

      const logged = d.appointments.filter(a =>
        a.status !== 'cancel' && a.dateLog && a.dateLog.startsWith(ym));
      const inMonth = d.appointments.filter(a =>
        a.status !== 'cancel' && a.status !== 'no_show' &&
        (a.dateAppt || a.dateLog || '').startsWith(ym));
      const invoiced = d.appointments.filter(a =>
        a.invoiced && a.status !== 'cancel' && a.status !== 'no_show' &&
        (a.dateAppt || a.dateLog || '').startsWith(ym));

      const mRevLogged  = logged.reduce((x, a) => x + getRate(a), 0);
      const mRevInMonth = inMonth.reduce((x, a) => x + getRate(a), 0);
      const mRevInvoiced = invoiced.reduce((x, a) => x + getRate(a), 0);
      const loggedInOwnMonth = logged.filter(a => (a.dateAppt || '').startsWith(ym)).length;
      const pctInMonth = logged.length > 0 ? Math.round(loggedInOwnMonth / logged.length * 100) : null;

      months.push({ ym, label, logged, inMonth, invoiced, mRevLogged, mRevInMonth, mRevInvoiced, pctInMonth });
    }

    const curYM = iso(now).slice(0, 7);
    const curM = months.find(m => m.ym === curYM) || months[months.length - 1];
    const tableRows = [...months].reverse();

    // Pre-compute cost per month (needed by both table and bar chart)
    months.forEach(m => {
      m._cost = d.appointments
        .filter(a => a.status !== 'cancel' && a.dateLog && a.dateLog.startsWith(m.ym))
        .reduce((x, a) => x + getCost(a) + (a.dealCommission || 0), 0);
    });

    const monthTable = UI.C({ padding: 0, overflow: 'hidden' },
      // Table header
      e('div', { style: { display: 'grid', gridTemplateColumns: '130px repeat(2,80px) repeat(3,1fr) 70px', gap: 0, padding: '10px 18px', borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-2)' } },
        e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em' } }, 'Maand'),
        e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' } }, 'Ingeboekt'),
        e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' } }, 'In maand'),
        e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' } }, 'Omzet ingeboekt'),
        e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' } }, 'Omzet in maand'),
        e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' } }, 'Gefactureerd'),
        e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' } }, 'Marge')),
      // Table rows
      ...tableRows.map((m, mi) => {
        const isCur = m.ym === curM.ym;
        const pctInM = m.pctInMonth !== null ? m.pctInMonth + '%' : '—';
        const pctColor = m.pctInMonth !== null ? (m.pctInMonth >= 80 ? 'var(--up)' : m.pctInMonth >= 50 ? 'var(--warn)' : 'var(--down)') : 'var(--text-mute)';
        const mCost = m._cost || 0;
        const mMargin = m.mRevLogged > 0 ? Math.round((m.mRevLogged - mCost) / m.mRevLogged * 100) : null;
        const marginColor = mMargin === null ? 'var(--text-mute)' : mMargin >= 50 ? 'var(--up)' : mMargin >= 20 ? 'var(--warn)' : 'var(--down)';
        return e('div', { key: m.ym, style: { display: 'grid', gridTemplateColumns: '130px repeat(2,80px) repeat(3,1fr) 70px', gap: 0, padding: '12px 18px', borderBottom: mi < tableRows.length - 1 ? '1px solid var(--border-soft)' : 'none', background: isCur ? 'oklch(0.18 0.04 194 / .25)' : 'transparent', alignItems: 'center' } },
          // Month label
          e('div', null,
            e('div', { style: { fontSize: 13, fontWeight: isCur ? 700 : 600, color: isCur ? 'var(--accent)' : 'var(--text)', textTransform: 'capitalize' } }, m.label),
            isCur ? e('div', { style: { fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginTop: 1 } }, 'Deze maand') : null),
          // # Ingeboekt
          e('div', { style: { textAlign: 'right' } },
            e('div', { style: { fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--text)' } }, m.logged.length || '—')),
          // # In maand + %
          e('div', { style: { textAlign: 'right' } },
            e('div', { style: { fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--text)' } }, m.inMonth.length || '—'),
            m.logged.length > 0 ? e('div', { style: { fontSize: 10.5, fontWeight: 700, color: pctColor } }, pctInM) : null),
          // Omzet ingeboekt
          e('div', { style: { textAlign: 'right' } },
            e('div', { style: { fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: m.mRevLogged > 0 ? 'var(--info)' : 'var(--text-mute)' } }, m.mRevLogged > 0 ? this.euro(m.mRevLogged) : '—')),
          // Omzet in maand
          e('div', { style: { textAlign: 'right' } },
            e('div', { style: { fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: m.mRevInMonth > 0 ? 'var(--accent)' : 'var(--text-mute)' } }, m.mRevInMonth > 0 ? this.euro(m.mRevInMonth) : '—')),
          // Gefactureerd
          e('div', { style: { textAlign: 'right' } },
            e('div', { style: { fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: m.mRevInvoiced > 0 ? 'var(--up)' : 'var(--text-mute)' } }, m.mRevInvoiced > 0 ? this.euro(m.mRevInvoiced) : '—')),
          // Marge
          e('div', { style: { textAlign: 'right' } },
            e('div', { style: { fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: marginColor } }, mMargin !== null ? mMargin + '%' : '—')));
      }),
      // Totaal row
      (() => {
        const totLogged = months.reduce((x, m) => x + m.logged.length, 0);
        const totInMonth = months.reduce((x, m) => x + m.inMonth.length, 0);
        const totRevLogged = months.reduce((x, m) => x + m.mRevLogged, 0);
        const totRevInMonth = months.reduce((x, m) => x + m.mRevInMonth, 0);
        const totInvoiced = months.reduce((x, m) => x + m.mRevInvoiced, 0);
        const totCost = months.reduce((x, m) => x + (m._cost || 0), 0);
        const totMargin = totRevLogged > 0 ? Math.round((totRevLogged - totCost) / totRevLogged * 100) : null;
        return e('div', { style: { display: 'grid', gridTemplateColumns: '130px repeat(2,80px) repeat(3,1fr) 70px', gap: 0, padding: '12px 18px', background: 'var(--bg-2)', borderTop: '2px solid var(--border)', alignItems: 'center' } },
          e('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em' } }, '12 maanden'),
          e('div', { style: { textAlign: 'right', fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--text)' } }, totLogged),
          e('div', { style: { textAlign: 'right', fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--text)' } }, totInMonth),
          e('div', { style: { textAlign: 'right', fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--info)' } }, this.euro(totRevLogged)),
          e('div', { style: { textAlign: 'right', fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--accent)' } }, this.euro(totRevInMonth)),
          e('div', { style: { textAlign: 'right', fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--up)' } }, this.euro(totInvoiced)),
          e('div', { style: { textAlign: 'right', fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: totMargin !== null ? (totMargin >= 50 ? 'var(--up)' : totMargin >= 20 ? 'var(--warn)' : 'var(--down)') : 'var(--text-mute)' } }, totMargin !== null ? totMargin + '%' : '—'));
      })());

    // ── Gefactureerd breakdown (collapsible, scoped to current period) ──
    const invOpen = !!s.finInvOpen;
    const invoicedBlock = UI.C({ padding: 0, overflow: 'hidden' },
      e('div', { onClick: () => this.setState({ finInvOpen: !invOpen }), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', background: invOpen ? 'oklch(0.18 0.02 256 / .5)' : 'var(--surface)' } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          UI.Hd('Gefactureerd overzicht', { fontSize: 14 }),
          e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 13, color: 'var(--up)' } }, this.euro(revInvoiced)),
          e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '· ' + curInvoiced.length + ' afspraken · ' + periodLabel)),
        e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: invOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
      invOpen ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 } },
        // Per client
        e('div', null,
          e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 } }, 'Per klant'),
          UI.Table([
            { label: 'Klant', render: r => e('span', { style: { fontWeight: 600, color: 'var(--text)' } }, r.name) },
            { label: 'Afspraken', align: 'right', render: r => UI.Mono(r.count, { color: 'var(--text-dim)' }) },
            { label: 'Omzet', align: 'right', render: r => UI.Mono(this.euro(r.rev), { color: 'var(--up)', fontWeight: 700 }) },
          ], d.clients.map(cl => {
            const appts = curInvoiced.filter(a => a.client === cl.id);
            const rev = appts.reduce((x, a) => x + getRate(a), 0);
            return { name: cl.name, count: appts.length, rev };
          }).filter(r => r.count > 0).sort((a, b) => b.rev - a.rev), { min: 360, empty: 'Geen gefactureerde afspraken in deze periode.' })),
        // Per agent
        e('div', null,
          e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 } }, 'Per callagent'),
          UI.Table([
            { label: 'Agent', render: r => e('span', { style: { fontWeight: 600, color: 'var(--text)' } }, r.name) },
            { label: 'Afspraken', align: 'right', render: r => UI.Mono(r.count, { color: 'var(--text-dim)' }) },
            { label: 'Omzet', align: 'right', render: r => UI.Mono(this.euro(r.rev), { color: 'var(--up)', fontWeight: 700 }) },
            { label: 'Kosten', align: 'right', render: r => UI.Mono(this.euro(r.cost), { color: 'var(--down)' }) },
            { label: 'P&L', align: 'right', render: r => UI.Mono(this.euro(r.rev - r.cost), { color: r.rev - r.cost >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }) },
          ], d.agents.map(ag => {
            const appts = curInvoiced.filter(a => a.agent === ag.id);
            const rev = appts.reduce((x, a) => x + getRate(a), 0);
            const cost = appts.reduce((x, a) => x + getCost(a) + (a.dealCommission || 0), 0);
            return { name: ag.name, count: appts.length, rev, cost };
          }).filter(r => r.count > 0).sort((a, b) => b.rev - a.rev), { min: 440, empty: 'Geen gefactureerde afspraken in deze periode.' }))) : null);

    // ── Bar chart: revenue vs costs per month ─────────────────────────
    const rawMax = Math.max(...months.map(m => Math.max(m.mRevLogged, m._cost)), 1);
    // Round up to a nice number
    const niceMax = (() => {
      const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
      const steps = [1, 2, 2.5, 5, 10];
      for (const s of steps) { const v = Math.ceil(rawMax / (mag * s)) * mag * s; if (v >= rawMax) return v; }
      return rawMax;
    })();
    const CHART_H = 220; // px bar area height
    const barH = val => val > 0 ? Math.max(3, Math.round((val / niceMax) * CHART_H)) : 0;
    const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, val: Math.round(niceMax * f) }));
    const fmtK = v => v >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k' : String(v);
    const GREEN = 'oklch(0.58 0.15 152)';
    const RED   = 'oklch(0.60 0.16 18)';
    const GREEN_DIM = 'oklch(0.58 0.15 152 / .55)';
    const RED_DIM   = 'oklch(0.60 0.16 18 / .45)';

    const hoveredYM = s.chartHoverYM || null;
    const hoveredM = hoveredYM ? months.find(m => m.ym === hoveredYM) : null;

    const barChart = UI.C({ padding: '22px 24px 16px' },
      // Title + legend row
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
        UI.Hd('Inkomsten en uitgaven', { fontSize: 15 }),
        e('div', { style: { display: 'flex', gap: 20, alignItems: 'center' } },
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
            e('div', { style: { width: 22, height: 12, borderRadius: 3, background: GREEN } }),
            e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, 'Inkomsten')),
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
            e('div', { style: { width: 22, height: 12, borderRadius: 3, background: RED } }),
            e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, 'Uitgaven')))),
      // Hover tooltip row (fixed height so chart doesn't jump)
      e('div', { style: { height: 40, display: 'flex', alignItems: 'center', marginBottom: 8 } },
        hoveredM
          ? e('div', { style: { display: 'inline-flex', gap: 20, alignItems: 'center', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 14px' } },
              e('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize', minWidth: 90 } }, hoveredM.label),
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                e('div', { style: { width: 8, height: 8, borderRadius: 2, background: GREEN, flexShrink: 0 } }),
                e('span', { style: { fontSize: 12.5, fontWeight: 700, color: GREEN, fontFamily: "'JetBrains Mono'" } }, this.euro(hoveredM.mRevLogged))),
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                e('div', { style: { width: 8, height: 8, borderRadius: 2, background: RED, flexShrink: 0 } }),
                e('span', { style: { fontSize: 12.5, fontWeight: 700, color: RED, fontFamily: "'JetBrains Mono'" } }, this.euro(hoveredM._cost || 0))),
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, 'P&L'),
                e('span', { style: { fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: hoveredM.mRevLogged - (hoveredM._cost || 0) >= 0 ? 'var(--up)' : 'var(--down)' } }, this.euro(hoveredM.mRevLogged - (hoveredM._cost || 0)))))
          : e('span', { style: { fontSize: 12, color: 'var(--text-mute)', paddingLeft: 4 } }, 'Hover over een maand voor details')),
      // Chart area
      e('div', { style: { display: 'flex', gap: 0 } },
        // Y-axis labels
        e('div', { style: { display: 'flex', flexDirection: 'column-reverse', justifyContent: 'space-between', paddingBottom: 24, paddingRight: 10, minWidth: 44, alignItems: 'flex-end' } },
          yLabels.map(({ f, val }) =>
            e('div', { key: f, style: { fontSize: 10.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", lineHeight: 1 } }, fmtK(val)))),
        // Bars + x-axis
        e('div', { style: { flex: 1, position: 'relative' } },
          // Gridlines
          e('div', { style: { position: 'absolute', inset: '0 0 24px 0', display: 'flex', flexDirection: 'column-reverse', justifyContent: 'space-between', pointerEvents: 'none' } },
            yLabels.map(({ f }) =>
              e('div', { key: f, style: { borderTop: '1px solid var(--border-soft)', width: '100%' } }))),
          // Bars row — thin bars, visible gaps between months
          e('div', { style: { display: 'flex', alignItems: 'flex-end', height: CHART_H + 24, paddingBottom: 24, gap: 6 } },
            months.map(m => {
              const rH = barH(m.mRevLogged);
              const cH = barH(m._cost || 0);
              const isCur = m.ym === curM.ym;
              const isHov = m.ym === hoveredYM;
              const shortLabel = m.label.slice(0, 3).toLowerCase();
              return e('div', {
                key: m.ym,
                onMouseEnter: () => this.setState({ chartHoverYM: m.ym }),
                onMouseLeave: () => this.setState({ chartHoverYM: null }),
                style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', cursor: 'crosshair', borderRadius: 4, background: isHov ? 'oklch(0.5 0.02 256 / .07)' : 'transparent', transition: 'background .12s' }
              },
                // Bar pair — thin (60% width via padding)
                e('div', { style: { width: '100%', display: 'flex', gap: 1, alignItems: 'flex-end', flex: 1, padding: '0 20%' } },
                  e('div', { style: { flex: 1, height: rH + 'px', background: isHov ? GREEN : (isCur ? GREEN : GREEN_DIM), borderRadius: '3px 3px 0 0', minWidth: 0, transition: 'background .12s' } }),
                  e('div', { style: { flex: 1, height: cH + 'px', background: isHov ? RED : (isCur ? RED : RED_DIM), borderRadius: '3px 3px 0 0', minWidth: 0, transition: 'background .12s' } })),
                e('div', { style: { fontSize: 10, color: isCur ? 'var(--accent)' : (isHov ? 'var(--text)' : 'var(--text-mute)'), fontWeight: isCur || isHov ? 700 : 400, marginTop: 5, whiteSpace: 'nowrap', transition: 'color .12s' } }, shortLabel));
            })))));


    // Legend explaining the columns
    const legend = e('div', { style: { display: 'flex', gap: 20, flexWrap: 'wrap', padding: '10px 18px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border-soft)', fontSize: 11.5, color: 'var(--text-mute)', lineHeight: 1.5 } },
      e('span', null, e('strong', { style: { color: 'var(--text)' } }, 'Ingeboekt'), ': afspraken gelogd in die maand'),
      e('span', null, e('strong', { style: { color: 'var(--text)' } }, 'In maand'), ': afspraken gepland in die maand (show/open) + % van ingeboekt'),
      e('span', null, e('strong', { style: { color: 'var(--text)' } }, 'Omzet ingeboekt'), ': omzet op basis van logdatum'),
      e('span', null, e('strong', { style: { color: 'var(--text)' } }, 'Omzet in maand'), ': omzet op basis van afspraakdatum'),
      e('span', null, e('strong', { style: { color: 'var(--text)' } }, 'Gefactureerd'), ': omzet van facturen verstuurd'));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      periodNav,
      billboards,
      smallCards,
      agentCostBlock,
      invoicedBlock,
      barChart,
      legend,
      monthTable);
  },

  _admInvoices(d, s) {
    const e = React.createElement;
    const now = new Date();
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      (() => {
        const clInvMonthExp = s.clInvMonthExp || {};
        const clClientExp = s.clClientExp || {};
        const now3 = new Date();
        const months12 = [];
        for (let i = 0; i < 12; i++) {
          const m = new Date(now3.getFullYear(), now3.getMonth() - i, 1);
          const ym = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
          months12.push({ ym, label: m.toLocaleString('nl-BE', { month: 'long', year: 'numeric' }) });
        }
        const getApptYM = a => (a.dateAppt || a.dateLog || '').slice(0, 7);
        const monthsWithData = months12.filter(({ ym }) => d.appointments.some(a => getApptYM(a) === ym));

        const doMarkInvoiced = async (cl, ym, appts) => {
          this.mutLocal(dd => appts.forEach(a => { const f = dd.appointments.find(x => x.id === a.id); if (f) f.invoiced = true; }));
          this.toast('Gefactureerd', `${cl.name} – ${ym} gemarkeerd als gefactureerd`, 'var(--up)');
          await API.markClientInvoiced(cl.id, ym);
          this._logActivity('client_invoiced', `Marked ${appts.length} appointments as invoiced for ${cl.name} (${ym})`);
        };

        const now4 = new Date();
        const rawCloseDate = (d.settings && d.settings.billing_close_date) || null;
        const storedCloseDate = rawCloseDate && parseInt(rawCloseDate.slice(0, 4)) >= 2020 ? rawCloseDate : null;
        const closeDate = storedCloseDate ? new Date(storedCloseDate + 'T23:59:59') : new Date(now4.getFullYear(), now4.getMonth() + 1, 0, 23, 59, 59);
        const daysUntilClose = Math.ceil((closeDate - now4) / 86400000);
        const isInvoicingPeriod = daysUntilClose >= 0 && daysUntilClose <= 7;
        const saveBillingCloseDate = async (newDate) => {
          await SB.patch('platform_settings', `?key=eq.billing_close_date`, { value: newDate });
          this.mutLocal(dd => { if (!dd.settings) dd.settings = {}; dd.settings.billing_close_date = newDate; });
          this.toast('Opgeslagen', 'Factuurperiode sluitdatum: ' + newDate, 'var(--up)');
        };
        // Auto-open during invoicing period unless user explicitly closed it
        const clInvOpen = s.clInvOpen !== undefined ? !!s.clInvOpen : isInvoicingPeriod;
        return UI.C({ border: isInvoicingPeriod && !clInvOpen ? '1px solid var(--warn)' : undefined },
          e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: clInvOpen ? 14 : 0 } },
            e('div', { onClick: () => this.setState(st => ({ clInvOpen: !clInvOpen })), style: { display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', userSelect: 'none', flex: 1 } },
              UI.Hd('Client invoices'),
              isInvoicingPeriod ? e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--warn)', background: 'oklch(0.22 0.05 85 / .35)', padding: '2px 9px', borderRadius: 20 } }, '⚡ Factuurperiode open — nog ' + daysUntilClose + ' dag' + (daysUntilClose === 1 ? '' : 'en')) : null),
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              UI.Btn('📧 Review emails', () => this.openModal('sendReviewEmails'), 'soft', { padding: '5px 12px', fontSize: 12 }),
              e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, 'Sluitdatum:'),
              e('input', { type: 'date', value: storedCloseDate || '', min: '2024-01-01', max: '2030-12-31', onChange: ev => saveBillingCloseDate(ev.target.value), onClick: ev => ev.stopPropagation(), style: { padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer' } }),
              e('span', { onClick: () => this.setState(st => ({ clInvOpen: !clInvOpen })), style: { fontSize: 18, color: 'var(--text-mute)', transform: clInvOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block', cursor: 'pointer' } }, '›'))),
          clInvOpen ? (monthsWithData.length === 0
            ? e('div', { style: { color: 'var(--text-mute)', fontSize: 13, padding: '4px 0 8px' } }, 'Geen afspraken.')
            : e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                ...monthsWithData.map(({ ym, label }) => {
                  const monthAppts = d.appointments.filter(a => getApptYM(a) === ym);
                  const billable = monthAppts.filter(a => a.status !== 'cancel' && a.status !== 'no_show');
                  const pending = billable.filter(a => !a.invoiced);
                  const mOpen = !!clInvMonthExp[ym];
                  const toggleM = () => this.setState(st => ({ clInvMonthExp: { ...(st.clInvMonthExp || {}), [ym]: !mOpen } }));
                  const clientIds = [...new Set(monthAppts.map(a => a.client))];
                  return e('div', { key: ym, style: { borderRadius: 12, border: '1px solid var(--border-soft)', overflow: 'hidden' } },
                    e('div', { onClick: toggleM, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', background: mOpen ? 'oklch(0.18 0.02 256 / .6)' : 'var(--surface)' } },
                      e('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
                        e('span', { style: { fontWeight: 700, fontSize: 14, textTransform: 'capitalize' } }, label),
                        pending.length === 0 && billable.length > 0
                          ? e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--up)', background: 'oklch(0.22 0.08 152 / .4)', padding: '2px 9px', borderRadius: 20 } }, '✓ Gefactureerd')
                          : pending.length > 0
                          ? e('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--warn)', background: 'oklch(0.22 0.05 85 / .3)', padding: '2px 9px', borderRadius: 20 } }, pending.length + ' openstaand')
                          : null),
                      e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: mOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
                    mOpen ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)' } },
                      ...clientIds.map((clientId, ci) => {
                        const cl = d.clients.find(c => c.id === clientId);
                        if (!cl) return null;
                        const clAppts = monthAppts.filter(a => a.client === clientId);
                        const clBillable = clAppts.filter(a => a.status !== 'cancel' && a.status !== 'no_show');
                        const clPending = clBillable.filter(a => !a.invoiced);
                        const clIsInvoiced = clPending.length === 0 && clBillable.length > 0;
                        const apptRate = r => { try { const fb = r.clientFeedback ? JSON.parse(r.clientFeedback) : null; if (fb && fb._rn && fb.revenue != null) return fb.revenue; } catch {} if (r.sub && cl.subclients) { const sc = cl.subclients.find(s => s.id === r.sub || s.name === r.sub); if (sc && sc.rate != null) return sc.rate; } return cl.rate || 0; };
                        const clTotal = clBillable.reduce((s2, r) => s2 + apptRate(r), 0);
                        const clPendingTotal = clPending.reduce((s2, r) => s2 + apptRate(r), 0);
                        const openCount = clPending.filter(a => a.status === 'open').length;
                        const showCount = clPending.filter(a => a.status === 'show').length;
                        const cKey = ym + '-' + clientId;
                        const cExp = !!clClientExp[cKey];
                        const toggleC = () => this.setState(st => ({ clClientExp: { ...(st.clClientExp || {}), [cKey]: !cExp } }));
                        return e('div', { key: clientId, style: { borderBottom: ci < clientIds.length - 1 ? '1px solid var(--border-soft)' : 'none' } },
                          e('div', { onClick: toggleC, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 20px', cursor: 'pointer' } },
                            e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                              e('span', { style: { fontWeight: 600, fontSize: 13.5, color: clIsInvoiced ? 'var(--text-mute)' : 'var(--text)' } }, cl.name),
                              e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, clBillable.length + ' afspraken · ' + this.euro(clIsInvoiced ? clTotal : clPendingTotal)),
                              (() => { try { const refs = JSON.parse(localStorage.getItem('inv_refs_' + cl.id) || '{}'); return refs[ym] ? e('span', { style: { fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'oklch(0.20 0.10 194 / .3)', padding: '2px 8px', borderRadius: 20, fontFamily: "'JetBrains Mono'" } }, refs[ym]) : null; } catch(ex) { return null; } })(),
                              (cl.billing_confirmed || {})[ym] ? e('span', { title: 'Overzicht verstuurd op ' + new Date((cl.billing_confirmed || {})[ym]).toLocaleString('nl-BE'), style: { fontSize: 11, fontWeight: 700, color: 'var(--up)', background: 'oklch(0.22 0.08 152 / .35)', padding: '2px 8px', borderRadius: 20, cursor: 'default' } }, '✓ Overzicht verstuurd') : null),
                            e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                              clBillable.length === 0
                                ? UI.Pill('Alleen geannuleerd', 'var(--text-mute)', 'var(--surface)')
                                : clIsInvoiced
                                  ? UI.Pill('Gefactureerd', 'var(--up)', 'oklch(0.28 0.06 152 / .4)')
                                  : UI.Btn('Markeer als gefactureerd', ev => { ev.stopPropagation(); doMarkInvoiced(cl, ym, clPending); }, 'primary', { padding: '5px 13px', fontSize: 12 }),
                              e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: cExp ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›'))),
                          cExp ? e('div', { style: { paddingBottom: 12 } },
                            (() => {
                              const _invKey = 'inv_refs_' + cl.id;
                              const _invRefs = (() => { try { const v = localStorage.getItem(_invKey); return v ? JSON.parse(v) : {}; } catch(ex) { return {}; } })();
                              const _saveInvRef = (val) => { try { const upd = { ..._invRefs, [ym]: val }; localStorage.setItem(_invKey, JSON.stringify(upd)); this.forceUpdate && this.forceUpdate(); } catch(ex) {} };
                              return e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px 6px' } },
                                e('span', { style: { fontSize: 12, color: 'var(--text-mute)', fontWeight: 600, minWidth: 110 } }, 'Factuurnummer:'),
                                e('input', { type: 'text', placeholder: 'bv. 2024-001', defaultValue: _invRefs[ym] || '', onBlur: ev => _saveInvRef(ev.target.value), onClick: ev => ev.stopPropagation(), style: { padding: '5px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12.5, outline: 'none', width: 170 } }));
                            })(),
                            UI.Table([
                              { label: 'Afspraak', render: r => UI.Mono(this.fmtDate(r.dateAppt), { fontSize: 12 }) },
                              { label: 'Gelogd', render: r => UI.Mono(this.fmtDate(r.dateLog), { fontSize: 12, color: 'var(--text-mute)' }) },
                              { label: 'Lead', render: r => e('span', { style: { fontWeight: 600, color: 'var(--text)' } }, r.lead) },
                              { label: 'Agent', render: r => this.agentName(r.agent, d) },
                              cl.subclients && cl.subclients.length > 0 ? { label: 'Subclient', render: r => { if (!r.sub) return e('span', { style: { color: 'var(--text-mute)', fontSize: 12 } }, '—'); const sc = cl.subclients.find(s => s.id === r.sub || s.name === r.sub); return e('span', { style: { color: 'var(--text-dim)', fontSize: 12.5 } }, sc ? sc.name : r.sub); } } : null,
                              { label: 'Status', align: 'center', render: r => UI.statusPill(r.status) },
                              { label: 'Factuur', align: 'center', render: r => r.invoiced ? e('span', { style: { fontSize: 11, fontWeight: 700, color: 'var(--up)' } }, '✓') : (r.status === 'cancel' || r.status === 'no_show') ? e('span', { style: { color: 'var(--text-mute)', fontSize: 11 } }, '—') : e('span', { style: { fontSize: 11, color: 'var(--warn)' } }, '○') },
                              { label: 'Bedrag', align: 'right', render: r => (r.status === 'cancel' || r.status === 'no_show') ? e('span', { style: { color: 'var(--text-mute)' } }, '—') : UI.Mono(this.euro(apptRate(r)), { fontWeight: 700, color: 'var(--info)' }) },
                            ].filter(Boolean), [...clAppts].sort((a, b) => (b.dateAppt || b.dateLog || '') > (a.dateAppt || a.dateLog || '') ? 1 : -1).map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 560 }),
                            !clIsInvoiced && clBillable.length > 0 ? e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '10px 20px 2px', borderTop: '1px solid var(--border-soft)', marginTop: 4 } },
                              e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                                e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--info)', marginRight: 6 } }, 'Totaal: ' + this.euro(clPendingTotal)),
                                UI.Btn('Markeer als gefactureerd', ev => { ev.stopPropagation(); doMarkInvoiced(cl, ym, clPending); }, 'primary', { padding: '7px 16px', fontSize: 13 }))) : null
                          ) : null);
                      })) : null);
                }))) : null);
      })(),
      (() => {
        const invExpanded = s.invExpanded || {};
        const invApproved = s.invApproved || {};
        const activeAgents = d.agents.filter(a => a.active);
        const now2 = new Date();
        const currentYM = now2.getFullYear() + '-' + String(now2.getMonth() + 1).padStart(2, '0');
        const months = [];
        for (let i = 0; i < 12; i++) {
          const m = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
          const ym2 = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
          months.push({ ym: ym2, label: m.toLocaleString('en', { month: 'long', year: 'numeric' }) });
        }
        const agentMonthSummary = (agent, ym) => {
          const appts = d.appointments.filter(a => a.agent === agent.id && a.status === 'show' && (a.dateAppt || a.dateLog || '').startsWith(ym));
          return { count: appts.length, total: appts.reduce((s2, a) => s2 + ((agent.rates || {})[a.sub] || (agent.rates || {})[a.client] || 0) + (a.dealCommission || 0), 0) };
        };
        const agentInvOpen = !!s.agentInvOpen;
        return UI.C({},
          e('div', { onClick: () => this.setState(st => ({ agentInvOpen: !st.agentInvOpen })), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: agentInvOpen ? 14 : 0, cursor: 'pointer', userSelect: 'none' } },
            e('div', null, UI.Hd('Approval of invoicing'), e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginTop: 2 } }, 'Call Agents')),
            e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: agentInvOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
          agentInvOpen ? e('div', { style: { display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-soft)' } },
            ...activeAgents.map((agent, ai) => {
              const expanded = !!invExpanded[agent.id];
              const toggle = () => this.setState(st => ({ invExpanded: { ...(st.invExpanded || {}), [agent.id]: !expanded } }));
              const monthsWithData = months.filter(({ ym }) => ym === currentYM || agentMonthSummary(agent, ym).count > 0);
              return e('div', { key: agent.id },
                e('div', { onClick: toggle, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', background: expanded ? 'oklch(0.18 0.02 256 / .6)' : ai % 2 === 0 ? 'var(--surface)' : 'transparent', borderTop: ai > 0 ? '1px solid var(--border-soft)' : 'none' } },
                  e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                    e('span', { style: { fontWeight: 700, fontSize: 14 } }, agent.name),
                    e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, monthsWithData.length + ' month' + (monthsWithData.length !== 1 ? 's' : ''))),
                  e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
                expanded ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)' } },
                  monthsWithData.length === 0
                    ? e('div', { style: { padding: '14px 24px', color: 'var(--text-mute)', fontSize: 13 } }, 'No appointment data yet.')
                    : monthsWithData.map(({ ym, label }) => {
                        const { count, total } = agentMonthSummary(agent, ym);
                        const approvedKey = agent.id + '-' + ym;
                        const isApproved = !!invApproved[approvedKey];
                        const invState = (d.invoiceStates || {})[approvedKey] || {};
                        return e('div', { key: ym, onClick: () => this.openModal('invoiceReview', { agentId: agent.id, ym, label }), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 26px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' } },
                          e('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                            e('span', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--text)' } }, label),
                            e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, count > 0 ? count + ' shows · ' + this.euro(total) : 'No shows yet')),
                          e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                            invState.invNumber ? e('span', { style: { fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--mono, monospace)' } }, invState.invNumber) : null,
                            invState.invSent ? UI.Pill('Sent', 'var(--warn)', 'oklch(0.25 0.05 85 / .4)') : null,
                            isApproved
                              ? UI.Pill('Approved', 'var(--up)', 'oklch(0.28 0.06 152 / .4)')
                              : ym === currentYM
                                ? UI.Pill('Open', 'var(--info)', 'oklch(0.22 0.05 220 / .4)')
                                : UI.Pill('Open', 'var(--warn)', 'oklch(0.25 0.05 85 / .4)')));
                      })
                ) : null);
            })) : null);
      })());
  },

  _admPnl(d, s) {
    const e = React.createElement;
    const now = new Date();

    const pnlMonthOffset = s.pnlMonthOffset || 0;
    const monthDate = new Date(now.getFullYear(), now.getMonth() + pnlMonthOffset, 1);
    const monthYM = monthDate.getFullYear() + '-' + String(monthDate.getMonth() + 1).padStart(2, '0');
    const monthLabel = monthDate.toLocaleString('nl-BE', { month: 'long', year: 'numeric' });
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();

    // Rate helpers
    const getRate = (a) => {
      try { const fb = a.clientFeedback ? JSON.parse(a.clientFeedback) : null; if (fb && fb._rn && fb.revenue != null) return fb.revenue; } catch {}
      const cl = d.clients.find(c => c.id === a.client);
      if (!cl) return 0;
      if (a.sub && cl.subclients) {
        const sc = cl.subclients.find(s2 => s2.id === a.sub || s2.name === a.sub);
        if (sc && sc.rate != null) return sc.rate;
      }
      return cl.rate || 0;
    };
    const getPayout = (a) => {
      const ag = d.agents.find(x => x.id === a.agent);
      if (!ag) return 0;
      if (a.client === 'c15') return (rnAgentPay(a) ?? 0) + (a.dealCommission || 0);
      return ((ag.rates || {})[a.sub] || (ag.rates || {})[a.client] || 0) + (a.dealCommission || 0);
    };

    const monthAppts = d.appointments.filter(a => {
      const ym = (a.dateLog || '').slice(0, 7);
      return ym === monthYM && a.status !== 'cancel' && a.status !== 'no_show';
    });

    // Fixed costs (defaults = Aug 2026 actuals from Excel)
    const FIXED_COSTS = [
      { label: 'Software - CloudTalk (phone/CRM)', amount: 873.62 },
      { label: 'Software - CRM/Automation (HighLevel)', amount: 272.65 },
      { label: 'Software - Slack', amount: 139.18 },
      { label: 'Software - Skool.com', amount: 111.9 },
      { label: 'Advertising (LinkedIn)', amount: 82.64 },
      { label: 'Software - Anthropic/Claude', amount: 72.73 },
      { label: 'Software - Google Workspace', amount: 62.28 },
      { label: 'Software - Monday.com', amount: 60.61 },
      { label: 'Rent / Office (Huur Media)', amount: 49 },
      { label: 'Software - Lusha (lead data)', amount: 45.03 },
      { label: 'Software - DocuSign', amount: 39.61 },
      { label: 'Software - GoDaddy (domains/hosting)', amount: 38.67 },
      { label: 'Software - CapCut', amount: 29.99 },
      { label: 'Software - Billit (invoicing)', amount: 27.23 },
      { label: 'Software - Zinrai/Copecart', amount: 22.7 },
      { label: 'Software - Veed (video editing)', amount: 22 },
      { label: 'Software - Subscriptions (misc)', amount: 21.07 },
      { label: 'Software - Resend (email API)', amount: 18.59 },
      { label: 'Software - Twilio', amount: 18.2 },
      { label: 'Software - Webdock (hosting)', amount: 12.41 },
      { label: 'Property/Real Estate Fees', amount: 7.5 },
      { label: 'Employee Benefits (Meal Vouchers)', amount: 0 },
      { label: 'Software - Paddle.net', amount: 0 },
      { label: 'Software - Rentumo', amount: 0 },
    ];
    const fixedKey = 'pnl_fixed_costs_' + monthYM;
    const fixedOverrides = (() => { try { return JSON.parse(d.settings[fixedKey] || '{}'); } catch(_) { return {}; } })();
    const saveFixedOverrides = (next) => {
      const val = JSON.stringify(next);
      this.mutLocal(dd => { dd.settings = dd.settings || {}; dd.settings[fixedKey] = val; });
      API.saveSetting(fixedKey, val);
    };
    const FIXED_COSTS_RESOLVED = FIXED_COSTS
      .map(fc => {
        const ov = fixedOverrides[fc.label] || {};
        if (ov._deleted) return null;
        return { originalLabel: fc.label, label: ov.label != null ? ov.label : fc.label, amount: ov.amount != null ? ov.amount : fc.amount, defaultLabel: fc.label, defaultAmount: fc.amount };
      })
      .filter(Boolean)
      .sort((a, b) => b.amount - a.amount);
    const TOTAL_FIXED = FIXED_COSTS_RESOLVED.reduce((s2, x) => s2 + x.amount, 0);
    const extraKey = 'pnl_extra_costs_' + monthYM;
    const extraCosts = (() => { try { return JSON.parse(d.settings[extraKey] || '[]'); } catch(_) { return []; } })();
    const saveExtraCosts = (next) => {
      const val = JSON.stringify(next);
      this.mutLocal(dd => { dd.settings = dd.settings || {}; dd.settings[extraKey] = val; });
      API.saveSetting(extraKey, val);
    };
    const totalExtraCosts = extraCosts.reduce((s2, x) => s2 + (parseFloat(x.amount) || 0), 0);

    // Week number helper
    const wkNum = (dateStr) => {
      const d1 = new Date(dateStr + 'T12:00:00');
      const thu = new Date(d1); thu.setDate(d1.getDate() + (4 - (d1.getDay() || 7)));
      const ys = new Date(thu.getFullYear(), 0, 1);
      return Math.ceil(((thu - ys) / 86400000 + 1) / 7);
    };

    // Build days array (only days with appointments)
    const allDays = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const dayStr = monthYM + '-' + String(i).padStart(2, '0');
      const dayAppts = monthAppts.filter(a => (a.dateLog || '').slice(0, 10) === dayStr);
      if (dayAppts.length === 0) continue;
      const d0 = new Date(dayStr + 'T12:00:00');
      const dayNames = ['zo','ma','di','wo','do','vr','za'];
      allDays.push({ dayStr, dayShort: dayNames[d0.getDay()] + ' ' + i, wk: wkNum(dayStr), appts: dayAppts });
    }

    // Group days by week
    const weeks = [];
    allDays.forEach(day => {
      const last = weeks[weeks.length - 1];
      if (!last || last.wk !== day.wk) weeks.push({ wk: day.wk, days: [day] });
      else last.days.push(day);
    });

    // Clients with appointments this month (excluding EmploAI)
    const activeClients = d.clients.filter(cl => monthAppts.some(a => a.client === cl.id) && cl.name.toLowerCase() !== 'emploai');

    // Per week totals
    const weekTotal = (wk) => dayTotals(wk.days.flatMap(d => d.appts));
    const clientWeek = (cl, wk) => {
      const wkAppts = wk.days.flatMap(d => d.appts).filter(a => a.client === cl.id);
      if (wkAppts.length === 0) return null;
      const omzet = wkAppts.reduce((s2, a) => s2 + getRate(a), 0);
      const kosten = wkAppts.reduce((s2, a) => s2 + getPayout(a), 0);
      return { n: wkAppts.length, omzet, kosten, winst: omzet - kosten };
    };

    // Per day totals
    const dayTotals = (dayAppts) => {
      const omzet = dayAppts.reduce((s2, a) => s2 + getRate(a), 0);
      const kosten = dayAppts.reduce((s2, a) => s2 + getPayout(a), 0);
      return { omzet, kosten, winst: omzet - kosten, n: dayAppts.length };
    };

    // Per client per day
    const clientDay = (cl, dayAppts) => {
      const ca = dayAppts.filter(a => a.client === cl.id);
      if (ca.length === 0) return null;
      const omzet = ca.reduce((s2, a) => s2 + getRate(a), 0);
      const kosten = ca.reduce((s2, a) => s2 + getPayout(a), 0);
      const rate = ca.length > 0 ? Math.round(omzet / ca.length) : 0;
      return { n: ca.length, omzet, kosten, winst: omzet - kosten, rate };
    };

    // Month totals
    const monthOmzet = monthAppts.reduce((s2, a) => s2 + getRate(a), 0);
    const monthKosten = monthAppts.reduce((s2, a) => s2 + getPayout(a), 0);
    const monthWinst = monthOmzet - monthKosten;
    const monthRatio = monthOmzet > 0 ? monthWinst / monthOmzet : 0;
    const netProfit = monthWinst - TOTAL_FIXED - totalExtraCosts;
    const netMargin = monthOmzet > 0 ? Math.round(netProfit / monthOmzet * 100) : null;
    const avgDayOmzet = allDays.length > 0 ? monthOmzet / allDays.length : 0;
    const dayPcts = allDays.map(day => { const dt = dayTotals(day.appts); return avgDayOmzet > 0 ? (dt.omzet - avgDayOmzet) / avgDayOmzet : 0; });
    const bestDayPct = dayPcts.length > 0 ? Math.max(...dayPcts) : null;
    const worstDayPct = dayPcts.length > 0 ? Math.min(...dayPcts) : null;

    // Style helpers
    const css = (...args) => Object.assign({}, ...args);
    const mono = { fontFamily: "'JetBrains Mono'", fontSize: 11.5 };
    const EUR = (v, col) => e('span', { style: css(mono, { color: col || 'var(--text)', fontWeight: 700 }) }, v === 0 ? '—' : '€' + v.toLocaleString('nl-BE', { maximumFractionDigits: 2 }));
    const PCT = (v) => {
      const pct = Math.round(v * 100);
      const col = pct >= 60 ? 'var(--up)' : pct >= 40 ? 'var(--warn)' : 'var(--down)';
      return e('span', { style: css(mono, { color: col, fontWeight: 700, background: pct >= 60 ? 'oklch(0.22 0.08 152/.2)' : pct >= 40 ? 'oklch(0.22 0.05 85/.2)' : 'oklch(0.25 0.1 20/.2)', padding: '1px 5px', borderRadius: 4 }) }, pct + '%');
    };
    const NUM = (v) => e('span', { style: css(mono, { color: 'var(--text)', fontSize: 11, fontWeight: 700 }) }, v || '—');

    const navBtn = (lbl, fn) => e('button', { onClick: fn, style: { padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 15, lineHeight: 1 } }, lbl);

    // Table cell helpers
    const tdBase = { padding: '5px 8px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 12 };
    const TD = (content, style) => e('td', { style: css(tdBase, style || {}) }, content);
    const TH = (content, style) => e('th', { style: css({ padding: '6px 8px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-mute)', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textAlign: 'center' }, style || {}) }, content);
    const stickyL = { position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface)', borderRight: '1px solid var(--border-soft)' };
    const stickyL2 = { position: 'sticky', left: 64, zIndex: 2, background: 'var(--surface)', borderRight: '2px solid var(--border)' };

    const darkBg = 'oklch(0.14 0.03 256)';
    const darkBg2 = 'oklch(0.17 0.03 256)';
    const wkBg = 'oklch(0.16 0.04 256)'; // week total col background

    // Section header row (spans all cols)
    // totalDayCols = day cols (allDays * 3) + week total cols (weeks.length), excl. month total
    const totalDayCols = allDays.length * 3 + weeks.length;

    const sectionHeader = (label, bg, color) => e('tr', null,
      e('td', { colSpan: 2 + totalDayCols, style: { padding: '7px 12px', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', background: bg || 'var(--bg-2)', color: color || 'var(--text-mute)', borderBottom: '2px solid var(--border)', position: 'sticky', left: 0 } }, label),
      e('td', { style: { background: darkBg, borderBottom: '2px solid var(--border)', borderLeft: '2px solid var(--border)' } }));

    // IS TOTAAL metric row
    const isMetricRow = (label, vals, color, isRatio) => {
      const total = isRatio ? (monthOmzet > 0 ? monthWinst / monthOmzet : 0) :
        label === 'Kosten' ? monthKosten : label === 'Omzet' ? monthOmzet : monthWinst;
      const getVal = (appts) => {
        const t = dayTotals(appts);
        return isRatio ? (t.omzet > 0 ? t.winst / t.omzet : null) :
          label === 'Kosten' ? t.kosten : label === 'Omzet' ? t.omzet : t.winst;
      };
      return e('tr', null,
        TD(e('span', { style: { fontWeight: 700, fontSize: 12, color: color || 'var(--text)' } }, label),
          css(tdBase, stickyL, { left: 0, background: darkBg2, paddingLeft: 12 })),
        TD('', css(tdBase, stickyL2, { left: 64, background: darkBg2 })),
        ...weeks.map(wk => [
          ...wk.days.map(day => {
            const v = getVal(day.appts);
            return [
              TD('', { textAlign: 'center', fontSize: 11, borderLeft: '2px solid var(--border)', background: darkBg2 }),
              TD('', { textAlign: 'center', background: darkBg2 }),
              TD(v === null ? e('span', { style: { color: 'var(--text-dim)' } }, '—') : isRatio ? e('span', { style: css(mono, { color: 'white', fontWeight: 700 }) }, Math.round(v * 100) + '%') : EUR(v, 'white'), { textAlign: 'right', background: darkBg2 })
            ];
          }).flat(),
          // Week total
          (() => { const wv = getVal(wk.days.flatMap(d => d.appts)); return TD(wv === null ? '—' : isRatio ? e('span', { style: css(mono, { color: 'white', fontWeight: 700 }) }, Math.round(wv * 100) + '%') : EUR(wv, 'white'), { textAlign: 'right', fontWeight: 800, borderLeft: '3px solid var(--accent)', background: wkBg }); })()
        ]).flat(),
        TD(isRatio ? e('span', { style: css(mono, { color: 'white', fontWeight: 700 }) }, Math.round(total * 100) + '%') : EUR(total, 'white'), { textAlign: 'right', fontWeight: 700, borderLeft: '2px solid var(--border)', background: darkBg }));
    };

    // % vs avg day row for IS Totaal section
    const isPctRow = () => e('tr', null,
      TD(e('span', { style: { fontWeight: 700, fontSize: 11, color: 'var(--text-mute)' } }, '% vs gem. dag'),
        css(tdBase, stickyL, { left: 0, background: darkBg2, paddingLeft: 12 })),
      TD('', css(tdBase, stickyL2, { left: 64, background: darkBg2 })),
      ...weeks.map(wk => [
        ...wk.days.map(day => {
          const dt = dayTotals(day.appts);
          const pct = avgDayOmzet > 0 ? (dt.omzet - avgDayOmzet) / avgDayOmzet : null;
          const isPos = pct !== null && pct >= 0;
          const pctEl = pct === null ? '' : e('span', { style: { fontWeight: 800, fontSize: 12,
            color: isPos ? 'var(--up)' : 'var(--down)',
            background: isPos ? 'oklch(0.22 0.08 152/.3)' : 'oklch(0.25 0.1 20/.3)',
            padding: '2px 5px', borderRadius: 4 } },
            (isPos ? '+' : '') + Math.round(pct * 100) + '%');
          return [
            TD('', { textAlign: 'center', borderLeft: '2px solid var(--border)', background: darkBg2 }),
            TD('', { background: darkBg2 }),
            TD(pctEl, { textAlign: 'right', background: darkBg2 })
          ];
        }).flat(),
        (() => {
          const wkOmzet = wk.days.reduce((acc, d2) => acc + dayTotals(d2.appts).omzet, 0);
          const wkAvg = wk.days.length > 0 ? wkOmzet / wk.days.length : 0;
          const wkPct = avgDayOmzet > 0 ? (wkAvg - avgDayOmzet) / avgDayOmzet : null;
          const isPos = wkPct !== null && wkPct >= 0;
          const wkEl = wkPct === null ? '' : e('span', { style: { fontWeight: 800, fontSize: 12, color: isPos ? 'var(--up)' : 'var(--down)' } },
            (isPos ? '+' : '') + Math.round(wkPct * 100) + '%');
          return TD(wkEl, { textAlign: 'right', fontWeight: 800, borderLeft: '3px solid var(--accent)', background: wkBg });
        })()
      ]).flat(),
      TD('', { textAlign: 'right', borderLeft: '2px solid var(--border)', background: darkBg }));

    // Client header row
    const clHdrBg = 'oklch(0.18 0.02 256 / .5)';
    const clientHeaderRow = (cl) => {
      const clAppts = monthAppts.filter(a => a.client === cl.id);
      const clOmzet = clAppts.reduce((s2, a) => s2 + getRate(a), 0);
      const clKosten = clAppts.reduce((s2, a) => s2 + getPayout(a), 0);
      return e('tr', { style: { background: clHdrBg } },
        e('td', { colSpan: 2, style: css(tdBase, stickyL, { left: 0, padding: '6px 12px', fontWeight: 800, fontSize: 12.5, color: 'var(--accent)', background: clHdrBg, borderRight: '2px solid var(--border)', letterSpacing: '.02em' }) }, cl.name),
        ...weeks.map(wk => {
          const cw = clientWeek(cl, wk);
          return [
            ...wk.days.map(day => {
              const cd = clientDay(cl, day.appts);
              return [
                TD(cd ? NUM(cd.n) : '', { textAlign: 'center', background: clHdrBg, borderLeft: '2px solid var(--border)' }),
                TD('', { background: clHdrBg }),
                TD(cd ? EUR(cd.winst, cd.winst >= 0 ? 'var(--up)' : 'var(--down)') : '', { textAlign: 'right', background: clHdrBg }),
              ];
            }).flat(),
            TD(cw ? EUR(cw.winst, cw.winst >= 0 ? 'var(--up)' : 'var(--down)') : '', { textAlign: 'right', fontWeight: 800, borderLeft: '3px solid var(--accent)', background: wkBg }),
          ];
        }).flat(),
        TD(EUR(clOmzet - clKosten, (clOmzet - clKosten) >= 0 ? 'var(--up)' : 'var(--down)'), { textAlign: 'right', fontWeight: 700, borderLeft: '2px solid var(--border)', background: darkBg }));
    };

    // Client metric rows: Kosten, Omzet, Winst
    const clientMetricRows = (cl) => {
      const clAppts = monthAppts.filter(a => a.client === cl.id);
      const totalOmzet = clAppts.reduce((s2, a) => s2 + getRate(a), 0);
      const totalKosten = clAppts.reduce((s2, a) => s2 + getPayout(a), 0);
      const avgRate = cl.rate || 0;
      const agentRate = (() => {
        const sample = clAppts[0];
        if (!sample) return 0;
        const ag = d.agents.find(x => x.id === sample.agent);
        return ag ? ((ag.rates || {})[sample.sub] || (ag.rates || {})[cl.id] || 0) : 0;
      })();

      const metricRow = (label, valFn, totalVal, col, rateLabel) => e('tr', { style: { background: 'var(--bg)' } },
        TD(e('span', { style: { fontSize: 11.5, color: col || 'var(--text-mute)', fontWeight: 600, paddingLeft: 8 } }, label),
          css(tdBase, stickyL, { left: 0, paddingLeft: 20, background: 'var(--bg)' })),
        TD(rateLabel ? e('span', { style: css(mono, { fontSize: 10.5, color: 'var(--text-dim)' }) }, rateLabel) : '',
          css(tdBase, stickyL2, { left: 64, background: 'var(--bg)' })),
        ...weeks.map(wk => {
          const cw = clientWeek(cl, wk);
          const wkV = cw ? valFn(cw) : null;
          return [
            ...wk.days.map(day => {
              const cd = clientDay(cl, day.appts);
              const v = cd ? valFn(cd) : null;
              return [
                TD(cd ? NUM(cd.n) : '', { textAlign: 'center', fontSize: 11, borderLeft: '2px solid var(--border)' }),
                TD(rateLabel && cd ? e('span', { style: css(mono, { fontSize: 10.5, color: 'var(--text-dim)' }) }, rateLabel) : '', { textAlign: 'center' }),
                TD(v !== null && v !== 0 ? EUR(v, col) : e('span', { style: { color: 'var(--text-dim)', fontSize: 11 } }, '—'), { textAlign: 'right' })
              ];
            }).flat(),
            TD(wkV !== null && wkV !== 0 ? EUR(wkV, col) : '', { textAlign: 'right', fontWeight: 800, borderLeft: '3px solid var(--accent)', background: wkBg }),
          ];
        }).flat(),
        TD(totalVal !== 0 ? EUR(totalVal, col) : '—', { textAlign: 'right', fontWeight: 700, borderLeft: '2px solid var(--border)', background: darkBg }));

      const rLabel = avgRate ? '€' + avgRate : '';
      const aLabel = agentRate ? '€' + agentRate : '';
      return [
        metricRow('Kosten', cd => cd.kosten, totalKosten, 'var(--warn)', aLabel),
        metricRow('Omzet', cd => cd.omzet, totalOmzet, 'var(--info)', rLabel),
        metricRow('Winst', cd => cd.winst, totalOmzet - totalKosten, totalOmzet - totalKosten >= 0 ? 'var(--up)' : 'var(--down)', ''),
      ];
    };

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },

      // Month nav + summary cards
      e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          navBtn('‹', () => this.setState(st => ({ pnlMonthOffset: (st.pnlMonthOffset || 0) - 1 }))),
          e('span', { style: { fontWeight: 700, fontSize: 17, textTransform: 'capitalize', minWidth: 180 } }, monthLabel),
          pnlMonthOffset < 0 ? navBtn('›', () => this.setState(st => ({ pnlMonthOffset: (st.pnlMonthOffset || 0) + 1 }))) : null),
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          [
            { l: 'Omzet', v: this.euro(monthOmzet), c: 'var(--info)' },
            { l: 'Kosten agents', v: this.euro(monthKosten), c: 'var(--warn)' },
            { l: 'Bruto winst', v: this.euro(monthWinst), c: monthWinst >= 0 ? 'var(--up)' : 'var(--down)' },
            { l: 'Marge', v: monthOmzet > 0 ? Math.round(monthRatio * 100) + '%' : '—', c: monthRatio >= 0.6 ? 'var(--up)' : monthRatio >= 0.4 ? 'var(--warn)' : 'var(--down)' },
            { l: 'Vaste kosten', v: this.euro(TOTAL_FIXED), c: 'var(--text-mute)' },
            { l: 'Netto winst', v: this.euro(netProfit), c: netProfit >= 0 ? 'var(--up)' : 'var(--down)' },
            { l: 'Gem. dag', v: this.euro(Math.round(avgDayOmzet)), c: 'var(--text-dim)' },
            { l: 'Beste dag', v: bestDayPct !== null ? (bestDayPct >= 0 ? '+' : '') + Math.round(bestDayPct * 100) + '%' : '—', c: 'var(--up)' },
            { l: 'Slechtste dag', v: worstDayPct !== null ? (worstDayPct >= 0 ? '+' : '') + Math.round(worstDayPct * 100) + '%' : '—', c: 'var(--down)' },
          ].map((c, i) => e('div', { key: i, style: { padding: '8px 12px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border-soft)', borderTop: '3px solid ' + c.c } },
            e('div', { style: { fontSize: 9.5, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 } }, c.l),
            e('div', { style: { fontSize: 16, fontWeight: 700, color: c.c, fontFamily: "'Space Grotesk'" } }, c.v))))),

      // Main P&L table
      UI.C({ padding: 0, overflow: 'hidden' },
        allDays.length === 0
          ? e('div', { style: { padding: 20, color: 'var(--text-mute)', fontSize: 13 } }, 'Geen afspraken in ' + monthLabel + '.')
          : e('div', { style: { overflowX: 'auto' } },
              e('table', { style: { borderCollapse: 'collapse', width: '100%', tableLayout: 'auto' } },

                e('thead', null,
                  // Row 1: Day names + week total headers
                  e('tr', { style: { background: 'var(--bg-2)' } },
                    TH('', css(stickyL, { left: 0, background: 'var(--bg-2)', textAlign: 'left', width: 64, minWidth: 64 })),
                    TH('tarief', css(stickyL2, { left: 64, background: 'var(--bg-2)', width: 64, minWidth: 64 })),
                    ...weeks.map(wk => [
                      ...wk.days.map((day, di) =>
                        e('th', { key: day.dayStr + 'wk', colSpan: 3, style: { padding: '7px 8px 5px', fontSize: 13, fontWeight: 800, color: 'var(--text)', background: 'var(--bg-2)', borderBottom: '1px solid var(--border-soft)', borderLeft: '2px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' } },
                          di === 0 ? e('span', null, e('span', { style: { fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.07em', marginRight: 8 } }, 'Wk ' + wk.wk), day.dayShort) : day.dayShort)
                      ),
                      e('th', { key: 'wkhdr_' + wk.wk, style: { padding: '7px 10px 5px', fontSize: 11, fontWeight: 800, color: 'var(--accent)', background: wkBg, borderBottom: '1px solid var(--border-soft)', borderLeft: '3px solid var(--accent)', textAlign: 'right', whiteSpace: 'nowrap', minWidth: 80 } }, 'Wk ' + wk.wk),
                    ]).flat(),
                    e('th', { style: { padding: '7px 8px 5px', fontSize: 12, fontWeight: 800, color: 'var(--text)', background: darkBg, borderBottom: '1px solid var(--border-soft)', borderLeft: '2px solid var(--border)', textAlign: 'right', minWidth: 90, whiteSpace: 'nowrap' } }, 'Totaal')),

                  // Row 2: # / € sub-headers + week/month sub-labels
                  e('tr', { style: { background: 'var(--bg-2)' } },
                    TH('', css(stickyL, { left: 0, background: 'var(--bg-2)' })),
                    TH('', css(stickyL2, { left: 64, background: 'var(--bg-2)' })),
                    ...weeks.map(wk => [
                      ...wk.days.map(day => [
                        e('th', { key: day.dayStr + 'a', style: { padding: '3px 4px', fontSize: 9.5, fontWeight: 700, color: 'var(--text-dim)', background: 'var(--bg-2)', borderBottom: '2px solid var(--border)', borderLeft: '2px solid var(--border)', textAlign: 'center', width: 36, minWidth: 36 } }, '#'),
                        e('th', { key: day.dayStr + 'b', style: { padding: '3px 4px', fontSize: 9.5, fontWeight: 700, color: 'var(--text-dim)', background: 'var(--bg-2)', borderBottom: '2px solid var(--border)', textAlign: 'center', width: 36, minWidth: 36 } }, '€'),
                        e('th', { key: day.dayStr + 'c', style: { padding: '3px 8px', fontSize: 9, fontWeight: 600, color: 'var(--text-dim)', background: 'var(--bg-2)', borderBottom: '2px solid var(--border)', textAlign: 'right', minWidth: 90 } }, 'totaal'),
                      ]).flat(),
                      e('th', { key: 'wksub_' + wk.wk, style: { padding: '3px 8px', fontSize: 9, fontWeight: 600, color: 'var(--accent)', background: wkBg, borderBottom: '2px solid var(--border)', borderLeft: '3px solid var(--accent)', textAlign: 'right' } }, 'totaal'),
                    ]).flat(),
                    e('th', { style: { padding: '3px 8px', fontSize: 9, fontWeight: 600, color: 'var(--text-dim)', background: darkBg, borderBottom: '2px solid var(--border)', borderLeft: '2px solid var(--border)', textAlign: 'right' } }, ''))),

                e('tbody', null,
                  // IS TOTAAL section
                  sectionHeader('Infinite Scale — Totaal', darkBg, 'var(--info)'),
                  isMetricRow('Kosten', null, 'var(--warn)', false),
                  isMetricRow('Omzet', null, 'var(--info)', false),
                  isMetricRow('Winst', null, 'var(--up)', false),
                  isMetricRow('Ratio', null, 'var(--up)', true),
                  isPctRow(),

                  // Per client sections
                  ...activeClients.map(cl => [
                    sectionHeader(cl.name, 'var(--bg-2)', 'var(--text)'),
                    clientHeaderRow(cl),
                    ...clientMetricRows(cl),
                  ]).flat())))),

      // Bottom: vaste kosten + extra + netto side by side
      e('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' } },

        // Vaste kosten
        e('div', { style: { flex: '1 1 300px' } },
          UI.C({ padding: 0, overflow: 'hidden' },
            e('div', { style: { padding: '12px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
              UI.Hd('Vaste kosten', { fontSize: 13 }),
              e('span', { style: css(mono, { fontSize: 12, color: 'var(--text-mute)' }) }, this.euro(TOTAL_FIXED) + '/mnd')),
            e('div', null, FIXED_COSTS_RESOLVED.map((fc, i) => {
              const isModified = fc.label !== fc.defaultLabel || fc.amount !== fc.defaultAmount;
              const setOv = (patch) => {
                const next = Object.assign({}, fixedOverrides, { [fc.originalLabel]: Object.assign({}, fixedOverrides[fc.originalLabel] || {}, patch) });
                saveFixedOverrides(next);
              };
              const deleteLine = () => {
                const next = Object.assign({}, fixedOverrides, { [fc.originalLabel]: { _deleted: true } });
                saveFixedOverrides(next);
              };
              const resetLine = () => {
                const next = Object.assign({}, fixedOverrides);
                delete next[fc.originalLabel];
                saveFixedOverrides(next);
              };
              return e('div', { key: fc.originalLabel, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px', borderTop: '1px solid var(--border-soft)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-2)' } },
                e('input', {
                  type: 'text', value: fc.label,
                  onChange: ev => setOv({ label: ev.target.value }),
                  style: { flex: 1, fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid transparent', background: 'transparent', color: 'var(--text)', outline: 'none', minWidth: 0 },
                  onFocus: ev => { ev.target.style.border = '1px solid var(--border)'; ev.target.style.background = 'var(--surface)'; },
                  onBlur: ev => { ev.target.style.border = '1px solid transparent'; ev.target.style.background = 'transparent'; }
                }),
                isModified ? e('button', { onClick: resetLine, style: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '0 2px', opacity: 0.6 }, title: 'Reset naar standaard' }, '↺') : null,
                e('input', {
                  type: 'number', min: 0, value: fc.amount,
                  onChange: ev => { const v = parseFloat(ev.target.value); setOv({ amount: isNaN(v) ? 0 : v }); },
                  style: css(mono, { width: 80, padding: '3px 6px', textAlign: 'right', borderRadius: 6, border: '1px solid var(--border)', background: isModified ? 'oklch(0.22 0.06 85 / .15)' : 'var(--surface)', color: 'var(--text)', fontSize: 12 })
                }),
                e('button', { onClick: deleteLine, style: { background: 'none', border: 'none', color: 'var(--text-mute)', cursor: 'pointer', fontSize: 15, padding: '0 2px', lineHeight: 1 }, title: 'Verwijder lijn' }, '×'));
            }))),

        // Extra kosten + netto resultaat
        e('div', { style: { flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 12 } },

          // Extra kosten
          UI.C({},
            e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 } },
              UI.Hd('Extra kosten', { fontSize: 13 }),
              totalExtraCosts > 0 ? e('span', { style: css(mono, { color: 'var(--warn)', fontWeight: 700 }) }, this.euro(totalExtraCosts)) : null),
            extraCosts.length > 0 ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 } },
              ...extraCosts.map((ec, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--bg-2)', borderRadius: 7, border: '1px solid var(--border-soft)' } },
                e('span', { style: { flex: 1, fontSize: 12 } }, ec.desc),
                e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, ec.date),
                e('span', { style: css(mono, { fontSize: 12, color: 'var(--warn)', fontWeight: 700 }) }, this.euro(parseFloat(ec.amount) || 0)),
                e('button', { onClick: () => saveExtraCosts(extraCosts.filter((_, j) => j !== i)), style: { background: 'none', border: 'none', color: 'var(--text-mute)', cursor: 'pointer', fontSize: 15, padding: 0 } }, '×')))) : null,
            e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              e('input', { type: 'date', value: s.pnlNewCostDate || monthYM + '-01', onChange: ev => this.setState({ pnlNewCostDate: ev.target.value }), style: { padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 } }),
              e('input', { type: 'text', placeholder: 'Omschrijving', value: s.pnlNewCostDesc || '', onChange: ev => this.setState({ pnlNewCostDesc: ev.target.value }), style: { flex: 1, minWidth: 110, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 } }),
              e('input', { type: 'number', placeholder: '€', value: s.pnlNewCostAmt || '', onChange: ev => this.setState({ pnlNewCostAmt: ev.target.value }), style: { width: 70, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 } }),
              UI.Btn('+', () => {
                const desc = (s.pnlNewCostDesc || '').trim();
                const amt = parseFloat(s.pnlNewCostAmt);
                if (!desc || isNaN(amt) || amt <= 0) return;
                saveExtraCosts([...extraCosts, { date: s.pnlNewCostDate || monthYM + '-01', desc, amount: amt }]);
                this.setState({ pnlNewCostDesc: '', pnlNewCostAmt: '' });
              }, 'primary', { padding: '5px 12px', fontSize: 13 }))),

          // Netto resultaat
          UI.C({ background: netProfit >= 0 ? 'oklch(0.22 0.08 152 / .1)' : 'oklch(0.25 0.10 20 / .1)', borderColor: netProfit >= 0 ? 'var(--up)' : 'var(--down)' },
            UI.Hd('Netto resultaat', { fontSize: 13, marginBottom: 10 }),
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              [
                { l: 'Omzet', v: monthOmzet, c: 'var(--info)' },
                { l: '− Kosten agents', v: monthKosten, c: 'var(--warn)' },
                { l: '= Bruto winst', v: monthWinst, c: monthWinst >= 0 ? 'var(--up)' : 'var(--down)', bold: true },
                { l: '− Vaste kosten', v: TOTAL_FIXED, c: 'var(--text-mute)' },
                { l: '− Extra kosten', v: totalExtraCosts, c: 'var(--text-mute)' },
                { l: '= Netto winst', v: netProfit, c: netProfit >= 0 ? 'var(--up)' : 'var(--down)', bold: true, big: true },
              ].map((row, i) => e('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', padding: row.big ? '8px 0 0' : '2px 0', borderTop: row.big ? '2px solid var(--border)' : 'none', marginTop: row.big ? 4 : 0 } },
                e('span', { style: { fontSize: row.big ? 13 : 12, color: 'var(--text-mute)', fontWeight: row.bold ? 700 : 400 } }, row.l),
                e('span', { style: css(mono, { fontWeight: row.bold ? 800 : 600, fontSize: row.big ? 17 : 12.5, color: row.c }) }, this.euro(row.v)))),
              netMargin !== null ? e('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 6 } },
                e('span', { style: { fontSize: 11.5, color: 'var(--text-mute)', marginRight: 6 } }, 'Nettomarge:'),
                e('span', { style: css(mono, { fontWeight: 700, fontSize: 13, color: netMargin >= 20 ? 'var(--up)' : netMargin >= 0 ? 'var(--warn)' : 'var(--down)' }) }, netMargin + '%')) : null))))));
  },

  _finCard(label, val, sub, col) {
    return UI.C({ display: 'flex', flexDirection: 'column', gap: 7, borderTop: '3px solid ' + col },
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--text-mute)', fontWeight: 600 } }, label),
      React.createElement('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 26, letterSpacing: '-.02em' } }, val),
      React.createElement('div', { style: { fontSize: 11.5, color: 'var(--text-mute)' } }, sub));
  },

  _admStats(d, s) {
    const e = React.createElement;
    const now = new Date();
    const isoNow = ds => ds.toISOString().slice(0, 10);
    const addDays = (base, n) => { const d2 = new Date(base); d2.setDate(d2.getDate() + n); return d2; };

    // Quick-range helpers
    const todayStr = isoNow(now);
    const dow = (now.getDay() + 6) % 7; // 0=Mon
    const weekStart = isoNow(addDays(now, -dow));
    const lastWeekStart = isoNow(addDays(now, -dow - 7));
    const lastWeekEnd = isoNow(addDays(now, -dow - 1));
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastMonthStart = (() => { const d2 = new Date(now.getFullYear(), now.getMonth() - 1, 1); return isoNow(d2); })();
    const lastMonthEnd = isoNow(addDays(new Date(now.getFullYear(), now.getMonth(), 1), -1));
    const allDialDates = Object.values(d.dials).flatMap(obj => Object.keys(obj));
    const minDialDate = allDialDates.length ? allDialDates.sort()[0] : todayStr;

    const quickRanges = [
      { k: 'today', l: 'Today', from: todayStr, to: todayStr },
      { k: 'yesterday', l: 'Yesterday', from: isoNow(addDays(now, -1)), to: isoNow(addDays(now, -1)) },
      { k: 'thisweek', l: 'This week', from: weekStart, to: todayStr },
      { k: 'lastweek', l: 'Last week', from: lastWeekStart, to: lastWeekEnd },
      { k: 'thismonth', l: 'This month', from: monthStart, to: todayStr },
      { k: 'lastmonth', l: 'Last month', from: lastMonthStart, to: lastMonthEnd },
      { k: 'alltime', l: 'All time', from: minDialDate, to: todayStr },
    ];

    const activeQuick = s.statsQuick !== undefined ? s.statsQuick : 'thisweek';
    const qr = quickRanges.find(r => r.k === activeQuick);
    const rangeFrom = activeQuick === 'custom' ? (s.statsFrom || todayStr) : (qr ? qr.from : weekStart);
    const rangeTo = activeQuick === 'custom' ? (s.statsTo || todayStr) : (qr ? qr.to : todayStr);

    // Build day series for selected range
    const dialSeries = [], apptSeries = [], labels = [], isoLabels = [], apptBreakdowns = [], dialBreakdowns = [];
    const activeAgents = d.agents.filter(a => a.active);
    const agentPalette = ['var(--accent)', 'var(--info)', 'var(--violet)', 'var(--warn)', 'var(--up)', 'var(--down)'];

    const isHourlyMode = (activeQuick === 'today' || activeQuick === 'yesterday') && d.dialsHourly;
    const hourlyDate = rangeFrom; // today or yesterday ISO date
    const hourlyHasData = isHourlyMode && Object.values(d.dialsHourly).some(agMap => agMap[hourlyDate]);

    if (hourlyHasData) {
      // Hourly mode: build one point per working hour (9–19)
      const nowLocalHour = (() => {
        const utcH = now.getUTCHours();
        const m = now.getUTCMonth() + 1;
        return (utcH + (m >= 4 && m <= 9 ? 2 : 1)) % 24;
      })();
      const maxHour = activeQuick === 'today' ? Math.min(nowLocalHour, 19) : 19;
      const dayAppts = d.appointments.filter(a => a.dateLog === hourlyDate);
      for (let h = 9; h <= maxHour; h++) {
        const hourCount = Object.keys(d.dialsHourly).reduce((x, id) => x + (((d.dialsHourly[id] || {})[hourlyDate] || {})[h] || 0), 0);
        dialSeries.push(hourCount);
        apptSeries.push(0); // no per-hour appt data; show as 0
        labels.push(h + ':00');
        isoLabels.push(hourlyDate);
        apptBreakdowns.push([]);
        dialBreakdowns.push(activeAgents.map((ag, ai) => ({ label: ag.name.split(' ')[0], value: ((d.dialsHourly[ag.id] || {})[hourlyDate] || {})[h] || 0, color: agentPalette[ai % agentPalette.length] })).filter(b => b.value > 0));
      }
    } else {
      let cur = new Date(rangeFrom + 'T12:00:00');
      const end = new Date(rangeTo + 'T12:00:00');
      while (cur <= end) {
        const day = isoNow(cur);
        const dayAppts = d.appointments.filter(a => a.dateLog === day);
        const localDials = Object.keys(d.dials).reduce((x, id) => x + ((d.dials[id] || {})[day] || 0), 0);
        dialSeries.push(localDials);
        apptSeries.push(dayAppts.length);
        labels.push(this.fmtDate(day));
        isoLabels.push(day);
        apptBreakdowns.push(activeAgents.map((ag, ai) => ({ label: ag.name.split(' ')[0], value: dayAppts.filter(a => a.agent === ag.id).length, color: agentPalette[ai % agentPalette.length] })).filter(b => b.value > 0));
        dialBreakdowns.push(activeAgents.map((ag, ai) => ({ label: ag.name.split(' ')[0], value: (d.dials[ag.id] || {})[day] || 0, color: agentPalette[ai % agentPalette.length] })).filter(b => b.value > 0));
        cur = addDays(cur, 1);
      }
    }

    const totalDials = dialSeries.reduce((a, b) => a + b, 0);
    const totalAppts = apptSeries.reduce((a, b) => a + b, 0);
    const convPct = totalDials > 0 ? (totalAppts / totalDials * 100).toFixed(1) : '—';

    const ratio = list => {
      const done = list.filter(a => a.status !== 'open');
      const canc = done.filter(a => a.status === 'cancel').length;
      const ns = done.filter(a => a.status === 'no_show').length;
      const shows = done.filter(a => a.status === 'show').length;
      return { total: done.length, shows, canc, ns, cancPct: Math.round(canc / (done.length || 1) * 100), nsPct: Math.round(ns / (done.length || 1) * 100) };
    };
    const rangeAppts = d.appointments.filter(a => a.dateLog >= rangeFrom && a.dateLog <= rangeTo);
    const overall = ratio(rangeAppts);

    const SumCard = (label, val, sub, color) => e('div', { style: { flex: '1 1 0', padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 3 } },
      e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' } }, label),
      e('div', { style: { fontSize: 24, fontWeight: 700, color: color || 'var(--text)', fontFamily: "'Space Grotesk'", letterSpacing: '-.02em' } }, val),
      sub ? e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)' } }, sub) : null);

    // Calendar picker for "Pick range"
    const calOpen = !!s.stCalOpen;
    const calYear = s.stCalYear !== undefined ? s.stCalYear : now.getFullYear();
    const calMonth = s.stCalMonth !== undefined ? s.stCalMonth : now.getMonth();
    const monthNms = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const fmtCal = (y, m, dv) => `${y}-${String(m + 1).padStart(2, '0')}-${String(dv).padStart(2, '0')}`;
    const fmtD = ds => ds ? new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
    const stFrom = s.statsFrom || '';
    const stTo = s.statsTo || '';
    const onCalDay = ds => {
      if (!stFrom || (stFrom && stTo)) {
        this.setState({ statsFrom: ds, statsTo: '', statsQuick: 'custom' });
      } else if (ds < stFrom) {
        this.setState({ statsFrom: ds, statsTo: stFrom, statsQuick: 'custom', stCalOpen: false });
      } else {
        this.setState({ statsTo: ds, statsQuick: 'custom', stCalOpen: false });
      }
    };
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const startDow2 = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
    const C = { bg: '#13191a', bg2: '#1c2526', border: 'rgba(255,255,255,0.08)', text: '#ddeae0', muted: '#5a7060', accent: '#67dcdf', accentBg: 'rgba(103,220,223,0.15)', rangeBg: 'rgba(103,220,223,0.12)' };
    const calCells = [];
    for (let i = 0; i < startDow2; i++) calCells.push(e('div', { key: 'p' + i }));
    for (let dv = 1; dv <= daysInMonth; dv++) {
      const ds = fmtCal(calYear, calMonth, dv);
      const isStart = ds === stFrom;
      const isEnd = ds === stTo;
      const inRng = stFrom && stTo && ds > stFrom && ds < stTo;
      calCells.push(e('div', {
        key: dv, onClick: () => onCalDay(ds),
        style: { width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isStart || isEnd ? C.accent : inRng ? C.rangeBg : 'transparent', color: isStart || isEnd ? '#071a1a' : ds === todayStr ? C.accent : C.text, fontWeight: isStart || isEnd || ds === todayStr ? 700 : 400, cursor: 'pointer', fontSize: 13, boxShadow: ds === todayStr && !isStart && !isEnd ? '0 0 0 1.5px ' + C.accent : 'none' }
      }, String(dv)));
    }
    const pickLabel = activeQuick === 'custom' && stFrom ? fmtD(stFrom) + (stTo && stTo !== stFrom ? ' → ' + fmtD(stTo) : stTo === stFrom ? '' : ' → …') : 'Pick range';

    const quickBar = e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
      quickRanges.map(r => e('button', {
        key: r.k,
        onClick: () => this.setState({ statsQuick: r.k, stCalOpen: false }),
        style: { padding: '5px 13px', borderRadius: 20, border: '1px solid', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', background: activeQuick === r.k ? 'var(--accent)' : 'transparent', color: activeQuick === r.k ? '#071a1a' : 'var(--text)', borderColor: activeQuick === r.k ? 'var(--accent)' : 'var(--border-soft)', fontWeight: activeQuick === r.k ? 700 : 400, transition: 'all .15s' }
      }, r.l)),
      e('div', { style: { position: 'relative' } },
        e('button', {
          onClick: () => this.setState({ stCalOpen: !calOpen }),
          style: { padding: '5px 13px', borderRadius: 20, border: '1px solid', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, background: activeQuick === 'custom' ? 'var(--accent)' : 'transparent', color: activeQuick === 'custom' ? '#071a1a' : 'var(--text)', borderColor: activeQuick === 'custom' ? 'var(--accent)' : 'var(--border-soft)', fontWeight: activeQuick === 'custom' ? 700 : 400 }
        }, e('span', null, '📅'), pickLabel),
        calOpen ? e('div', { style: { position: 'absolute', top: 38, right: 0, zIndex: 200, background: C.bg, border: '1px solid ' + C.border, borderRadius: 14, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,.5)', minWidth: 280 } },
          e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
            e('button', { onClick: () => calMonth === 0 ? this.setState({ stCalMonth: 11, stCalYear: calYear - 1 }) : this.setState({ stCalMonth: calMonth - 1 }), style: { background: 'none', border: 'none', color: C.text, cursor: 'pointer', fontSize: 18, padding: '0 6px' } }, '‹'),
            e('span', { style: { color: C.text, fontWeight: 600, fontSize: 14 } }, monthNms[calMonth] + ' ' + calYear),
            e('button', { onClick: () => calMonth === 11 ? this.setState({ stCalMonth: 0, stCalYear: calYear + 1 }) : this.setState({ stCalMonth: calMonth + 1 }), style: { background: 'none', border: 'none', color: C.text, cursor: 'pointer', fontSize: 18, padding: '0 6px' } }, '›')),
          e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,34px)', gap: 2, justifyContent: 'center', marginBottom: 6 } },
            ['Mo','Tu','We','Th','Fr','Sa','Su'].map(dn => e('div', { key: dn, style: { textAlign: 'center', fontSize: 11, color: C.muted, fontWeight: 600, paddingBottom: 4 } }, dn))),
          e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,34px)', gap: 2, justifyContent: 'center' } }, ...calCells)) : null));

    // Context graph window: wider historical range based on active filter
    const ctxWindow = (() => {
      if (activeQuick === 'today' || activeQuick === 'yesterday') return { days: 14, label: 'Last 2 weeks context' };
      if (activeQuick === 'thisweek' || activeQuick === 'lastweek') return { weeks: 4, label: 'Last 4 weeks context' };
      if (activeQuick === 'thismonth' || activeQuick === 'lastmonth') return { months: 3, label: 'Last 3 months context' };
      return null;
    })();

    let ctxDialSeries = [], ctxApptSeries = [], ctxLabels = [], ctxIsoLabels = [], ctxDialBreakdowns = [], ctxApptBreakdowns = [];
    if (ctxWindow) {
      let ctxFrom, ctxTo = todayStr;
      if (ctxWindow.days) ctxFrom = isoNow(addDays(now, -(ctxWindow.days - 1)));
      else if (ctxWindow.weeks) ctxFrom = isoNow(addDays(now, -(ctxWindow.weeks * 7 - 1)));
      else if (ctxWindow.months) { const m = new Date(now.getFullYear(), now.getMonth() - (ctxWindow.months - 1), 1); ctxFrom = isoNow(m); }
      // For month context, group by week; for day/week context, group by day
      if (ctxWindow.months) {
        // Group by week buckets
        let wCur = new Date(ctxFrom + 'T12:00:00');
        while (wCur <= new Date(ctxTo + 'T12:00:00')) {
          const wEnd = new Date(Math.min(addDays(wCur, 6).getTime(), new Date(ctxTo + 'T12:00:00').getTime()));
          const wFrom = isoNow(wCur), wTo = isoNow(wEnd);
          let dials = 0, appts = 0;
          const dBreak = {}, aBreak = {};
          let dc2 = new Date(wCur);
          while (dc2 <= wEnd) {
            const day2 = isoNow(dc2);
            dials += Object.keys(d.dials).reduce((x, id) => x + ((d.dials[id] || {})[day2] || 0), 0);
            appts += d.appointments.filter(a => a.dateLog === day2).length;
            activeAgents.forEach((ag, ai) => {
              dBreak[ag.id] = (dBreak[ag.id] || 0) + ((d.dials[ag.id] || {})[day2] || 0);
              aBreak[ag.id] = (aBreak[ag.id] || 0) + d.appointments.filter(a => a.dateLog === day2 && a.agent === ag.id).length;
            });
            dc2 = addDays(dc2, 1);
          }
          ctxDialSeries.push(dials); ctxApptSeries.push(appts);
          ctxLabels.push(this.fmtDate(wFrom)); ctxIsoLabels.push(wFrom);
          ctxDialBreakdowns.push(activeAgents.map((ag, ai) => ({ label: ag.name.split(' ')[0], value: dBreak[ag.id] || 0, color: agentPalette[ai % agentPalette.length] })).filter(b => b.value > 0));
          ctxApptBreakdowns.push(activeAgents.map((ag, ai) => ({ label: ag.name.split(' ')[0], value: aBreak[ag.id] || 0, color: agentPalette[ai % agentPalette.length] })).filter(b => b.value > 0));
          wCur = addDays(wEnd, 1);
        }
      } else {
        let dc = new Date(ctxFrom + 'T12:00:00');
        const ctxEnd = new Date(ctxTo + 'T12:00:00');
        while (dc <= ctxEnd) {
          const day = isoNow(dc);
          const dayAppts = d.appointments.filter(a => a.dateLog === day);
          const dials = Object.keys(d.dials).reduce((x, id) => x + ((d.dials[id] || {})[day] || 0), 0);
          ctxDialSeries.push(dials); ctxApptSeries.push(dayAppts.length);
          ctxLabels.push(this.fmtDate(day)); ctxIsoLabels.push(day);
          ctxDialBreakdowns.push(activeAgents.map((ag, ai) => ({ label: ag.name.split(' ')[0], value: (d.dials[ag.id] || {})[day] || 0, color: agentPalette[ai % agentPalette.length] })).filter(b => b.value > 0));
          ctxApptBreakdowns.push(activeAgents.map((ag, ai) => ({ label: ag.name.split(' ')[0], value: dayAppts.filter(a => a.agent === ag.id).length, color: agentPalette[ai % agentPalette.length] })).filter(b => b.value > 0));
          dc = addDays(dc, 1);
        }
      }
    }
    const ctxLabelStep = Math.ceil(ctxLabels.length / 8);

    // Agent leaderboard for selected range
    const agentBoard = activeAgents.map((ag, ai) => {
      let agDials = 0, agAppts = 0;
      let cur2 = new Date(rangeFrom + 'T12:00:00');
      const end2 = new Date(rangeTo + 'T12:00:00');
      while (cur2 <= end2) {
        const day = isoNow(cur2);
        agDials += (d.dials[ag.id] || {})[day] || 0;
        agAppts += d.appointments.filter(a => a.agent === ag.id && a.dateLog === day).length;
        cur2 = addDays(cur2, 1);
      }
      const conv = agDials > 0 ? (agAppts / agDials * 100).toFixed(1) : null;
      return { ag, agDials, agAppts, conv, color: agentPalette[ai % agentPalette.length] };
    }).sort((a, b) => b.agDials - a.agDials);

    const labelStep = Math.ceil(labels.length / 8);
    const periodLabel = rangeFrom === rangeTo ? rangeFrom : rangeFrom + ' → ' + rangeTo;

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        quickBar,
        e('div', { style: { display: 'flex', gap: 10 } },
          SumCard('Dials', String(totalDials), periodLabel, 'var(--accent)'),
          SumCard('Appointments', totalAppts, periodLabel, 'var(--info)'),
          SumCard('Conversion', convPct === '—' ? '—' : convPct + '%', 'dials → appointments', parseFloat(convPct) >= 5 ? 'var(--up)' : convPct === '—' ? 'var(--text-mute)' : 'var(--warn)'))),

      // Context graphs (wider window)
      ctxWindow ? UI.C({},
        UI.Hd(ctxWindow.label, { fontSize: 15, marginBottom: 10 }),
        UI.LineDual(ctxDialSeries, 'var(--accent)', ctxApptSeries, 'var(--info)', ctxLabels.filter((_, i) => i % ctxLabelStep === 0), v => String(v) + ' dials', v => String(v) + ' appts', ctxLabels, { dowLabels: ctxIsoLabels })) : null,

      // Agent leaderboard
      UI.C({},
        UI.Hd('Agent leaderboard', { fontSize: 15, marginBottom: 14 }),
        e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px 0', fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', padding: '0 10px 8px', borderBottom: '1px solid var(--border-soft)' } },
          e('span', null, 'Agent'), e('span', { style: { textAlign: 'right' } }, 'Dials'), e('span', { style: { textAlign: 'right' } }, 'Appts'), e('span', { style: { textAlign: 'right' } }, 'Conv.')),
        e('div', { style: { display: 'flex', flexDirection: 'column' } },
          agentBoard.map((b, i) => e('div', { key: b.ag.id, style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px 0', alignItems: 'center', padding: '10px 10px', borderBottom: i < agentBoard.length - 1 ? '1px solid var(--border-soft)' : 'none', background: i === 0 ? 'oklch(0.20 0.05 194 / .2)' : 'transparent', borderRadius: i === 0 ? 8 : 0 } },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              e('span', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 13, color: i === 0 ? 'var(--accent)' : 'var(--text-mute)', minWidth: 22 } }, '#' + (i + 1)),
              e('div', { style: { width: 8, height: 8, borderRadius: '50%', background: b.color, flex: 'none' } }),
              e('span', { style: { fontWeight: 600, fontSize: 13.5, color: 'var(--text)' } }, b.ag.name.split(' ')[0])),
            e('div', { style: { textAlign: 'right' } }, UI.Mono(b.agDials, { fontWeight: 700, color: 'var(--accent)' })),
            e('div', { style: { textAlign: 'right' } }, UI.Mono(b.agAppts, { fontWeight: 700, color: 'var(--info)' })),
            e('div', { style: { textAlign: 'right' } }, b.conv ? UI.Mono(b.conv + '%', { fontWeight: 700, color: parseFloat(b.conv) >= 5 ? 'var(--up)' : 'var(--warn)' }) : e('span', { style: { color: 'var(--text-mute)', fontSize: 12 } }, '—')))))),

      UI.C({},
        UI.Row({ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
          UI.Hd('Dials & Appointments', { fontSize: 15 }),
          UI.C({ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'none', border: 'none', boxShadow: 'none' },
            UI.Donut(overall.nsPct, 'var(--down)', overall.nsPct + '%', 'No-show rate · selected range'))),
        UI.LineDual(dialSeries, 'var(--accent)', apptSeries, 'var(--info)', labels.filter((_, i) => i % labelStep === 0), v => String(v) + ' dials', v => String(v) + ' appts', labels, { dowLabels: isoLabels, hourMarkers: (activeQuick === 'today' || activeQuick === 'yesterday') && !hourlyHasData })),

      UI.C({},
        UI.Row({ justifyContent: 'space-between', marginBottom: 16 },
          UI.Hd('Quality overview', { fontSize: 15 }),
          UI.Btn('Full breakdown', () => this.openModal('qualityBreakdown', {}), 'soft', { padding: '5px 14px', fontSize: 12 })),
        e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
          [
            { label: 'Show rate', val: Math.round(overall.shows / (overall.total || 1) * 100) + '%', sub: overall.shows + ' shows / ' + overall.total + ' done', color: 'var(--up)' },
            { label: 'No-show rate', val: overall.nsPct + '%', sub: overall.ns + ' no-shows', color: 'var(--down)' },
            { label: 'Cancel rate', val: overall.cancPct + '%', sub: overall.canc + ' cancellations', color: 'var(--text-mute)' },
          ].map((c, i) => e('div', { key: i, style: { flex: '1 1 150px', padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border-soft)' } },
            e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 } }, c.label),
            e('div', { style: { fontSize: 26, fontWeight: 700, color: c.color, fontFamily: "'Space Grotesk'" } }, c.val),
            e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginTop: 3 } }, c.sub))))),

      // Client revenue / deal stats
      (() => {
        const rangeAppts = d.appointments.filter(a => a.dateLog >= rangeFrom && a.dateLog <= rangeTo);
        const clientRows = d.clients.map(cl => {
          const appts = rangeAppts.filter(a => a.client === cl.id);
          const shows = appts.filter(a => a.status === 'show');
          const deals = shows.filter(a => a.quoteApproved);
          const revenue = deals.reduce((s, a) => s + (a.dealAmount || 0), 0);
          const showRate = appts.length ? Math.round(shows.length / appts.length * 100) : 0;
          const showToDeal = shows.length ? Math.round(deals.length / shows.length * 100) : 0;
          const leadToDeal = appts.length ? Math.round(deals.length / appts.length * 100) : 0;
          return { cl, booked: appts.length, shows: shows.length, deals: deals.length, revenue, showRate, showToDeal, leadToDeal };
        }).filter(r => r.booked > 0).sort((a, b) => b.revenue - a.revenue || b.booked - a.booked);
        if (!clientRows.length) return null;
        const totalRevenue = clientRows.reduce((s, r) => s + r.revenue, 0);
        const Pct = (v) => e('span', { style: { fontFamily: "'JetBrains Mono'", fontSize: 12.5, color: v > 0 ? 'var(--text)' : 'var(--text-mute)' } }, v + '%');
        return UI.C({},
          UI.Row({ justifyContent: 'space-between', marginBottom: 14 },
            UI.Hd('Client revenue & deals', { fontSize: 15 }),
            e('div', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 15, color: 'var(--up)' } }, totalRevenue > 0 ? this.euro(totalRevenue) + ' total' : 'No deals yet')),
          e('div', { style: { overflowX: 'auto' } },
            e('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
              e('thead', null,
                e('tr', null,
                  ['Client', 'Booked', 'Shows', 'Deals', 'Show rate', 'Show→Deal', 'Lead→Deal', 'Revenue'].map((h, i) =>
                    e('th', { key: h, style: { padding: '6px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' } }, h)))),
              e('tbody', null,
                clientRows.map((r, i) =>
                  e('tr', { key: r.cl.id, style: { borderBottom: i < clientRows.length - 1 ? '1px solid var(--border-soft)' : 'none' } },
                    e('td', { style: { padding: '10px 10px', fontWeight: 600, color: 'var(--text)' } }, r.cl.name),
                    e('td', { style: { padding: '10px 10px', textAlign: 'right' } }, UI.Mono(r.booked)),
                    e('td', { style: { padding: '10px 10px', textAlign: 'right' } }, UI.Mono(r.shows, { color: 'var(--up)' })),
                    e('td', { style: { padding: '10px 10px', textAlign: 'right' } }, UI.Mono(r.deals, { color: r.deals > 0 ? 'var(--accent)' : 'var(--text-mute)', fontWeight: 700 })),
                    e('td', { style: { padding: '10px 10px', textAlign: 'right' } }, Pct(r.showRate)),
                    e('td', { style: { padding: '10px 10px', textAlign: 'right' } }, Pct(r.showToDeal)),
                    e('td', { style: { padding: '10px 10px', textAlign: 'right' } }, Pct(r.leadToDeal)),
                    e('td', { style: { padding: '10px 10px', textAlign: 'right', fontFamily: "'JetBrains Mono'", fontWeight: 700, color: r.revenue > 0 ? 'var(--up)' : 'var(--text-mute)' } }, r.revenue > 0 ? this.euro(r.revenue) : '—')))))));
      })());
  },

  _admAppointments(d, s) {
    const e = React.createElement;
    const period = s.apptPeriod || 'daily';
    const today = this.iso(this.today());
    const now = new Date();

    // Date range helpers
    const startOf = (p, offset = 0) => {
      const d2 = new Date(now);
      if (p === 'daily') { d2.setDate(d2.getDate() - offset); return this.iso(d2); }
      if (p === 'weekly') { const day = d2.getDay() || 7; d2.setDate(d2.getDate() - (day - 1) - offset * 7); return this.iso(d2); }
      if (p === 'monthly') { d2.setDate(1); d2.setMonth(d2.getMonth() - offset); return this.iso(d2); }
    };
    const endOf = (p, offset = 0) => {
      const d2 = new Date(now);
      if (p === 'daily') { d2.setDate(d2.getDate() - offset); return this.iso(d2); }
      if (p === 'weekly') { const day = d2.getDay() || 7; d2.setDate(d2.getDate() - (day - 1) + 6 - offset * 7); return this.iso(d2); }
      if (p === 'monthly') { d2.setDate(1); d2.setMonth(d2.getMonth() - offset + 1); d2.setDate(d2.getDate() - 1); return this.iso(d2); }
    };

    const inRange = (dateStr, s2, e2) => dateStr >= s2 && dateStr <= e2;
    const cur = d.appointments.filter(a => inRange(a.dateLog, startOf(period), endOf(period)));
    const prev = d.appointments.filter(a => inRange(a.dateLog, startOf(period, 1), endOf(period, 1)));

    const pct = (a, b) => {
      if (!b) return a > 0 ? '+100%' : '0%';
      const diff = Math.round((a - b) / b * 100);
      return (diff >= 0 ? '+' : '') + diff + '%';
    };
    const pctColor = (a, b) => a >= b ? 'var(--up)' : 'var(--down)';

    const curBooked = cur.length;
    const prevBooked = prev.length;
    const curShows = cur.filter(a => a.status === 'show').length;
    const prevShows = prev.filter(a => a.status === 'show').length;
    const curRate = curBooked ? Math.round(curShows / curBooked * 100) : 0;
    const prevRate = prevBooked ? Math.round(prevShows / prevBooked * 100) : 0;
    const agentRate = (ag) => { const ag2 = cur.filter(a => a.agent === ag); return ag2.length ? Math.round(ag2.filter(a => a.status === 'show').length / ag2.length * 100) : 0; };

    const Stat = (label, val, delta, deltaVal, sub) => e('div', { style: { padding: '18px 22px', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', flex: '1 1 160px' } },
      e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' } }, label),
      e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
        e('span', { style: { fontSize: 28, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' } }, val),
        delta != null ? e('span', { style: { fontSize: 13, fontWeight: 700, color: pctColor(deltaVal[0], deltaVal[1]) } }, delta) : null),
      sub ? e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginTop: 4 } }, sub) : null);

    // Month options (last 18 months)
    const monthOpts = [{ v: 'all', l: 'All months' }];
    for (let i = 0; i < 18; i++) {
      const d2 = new Date(now); d2.setDate(1); d2.setMonth(d2.getMonth() - i);
      const ym = d2.toISOString().slice(0, 7);
      monthOpts.push({ v: ym, l: d2.toLocaleString('en', { month: 'long', year: 'numeric' }) });
    }

    // Date range helpers
    const isoDate = d2 => d2.toISOString().slice(0, 10);
    const startOfWeek = () => { const d2 = new Date(now); d2.setDate(d2.getDate() - ((d2.getDay() || 7) - 1)); return isoDate(d2); };
    const endOfWeek = () => { const d2 = new Date(now); d2.setDate(d2.getDate() + (7 - (d2.getDay() || 7))); return isoDate(d2); };
    const lastMonday = () => { const d2 = new Date(now); d2.setDate(d2.getDate() - ((d2.getDay() || 7) - 1) - 7); return isoDate(d2); };
    const lastSunday = () => { const d2 = new Date(now); d2.setDate(d2.getDate() - ((d2.getDay() || 7))); return isoDate(d2); };
    const startOfMonth = () => { const d2 = new Date(now); d2.setDate(1); return isoDate(d2); };
    const yesterday = () => { const d2 = new Date(now); d2.setDate(d2.getDate() - 1); return isoDate(d2); };

    const quickRanges = [
      { l: 'Today', from: isoDate(now), to: isoDate(now) },
      { l: 'Yesterday', from: yesterday(), to: yesterday() },
      { l: 'This week', from: startOfWeek(), to: endOfWeek() },
      { l: 'Last week', from: lastMonday(), to: lastSunday() },
      { l: 'This month', from: startOfMonth(), to: isoDate(now) },
      { l: 'Last month', from: (() => { const d2 = new Date(now); d2.setDate(1); d2.setMonth(d2.getMonth() - 1); return isoDate(d2); })(), to: (() => { const d2 = new Date(now); d2.setDate(0); return isoDate(d2); })() },
      { l: 'All time', from: '', to: '' },
    ];

    // Filters
    const q = (s.q || '').toLowerCase();
    const fs = s.fstatus || 'all';
    const fagent = s.fagent || 'all';
    const fclient = s.fclient || 'all';
    const fsub = s.fsub || 'all';
    const fmonth = s.fmonth || 'all';
    const fDateFrom = s.fDateFrom !== undefined ? s.fDateFrom : '';
    const fDateTo = s.fDateTo !== undefined ? s.fDateTo : '';
    const activeQuick = quickRanges.find(r => r.from === fDateFrom && r.to === fDateTo);
    const selectedClient = fclient !== 'all' ? d.clients.find(c => c.id === fclient) : null;
    const subclients = selectedClient && selectedClient.type === 'agency' ? (selectedClient.subclients || []) : [];

    let list = d.appointments.slice();
    if (fagent !== 'all') list = list.filter(a => a.agent === fagent);
    if (fclient !== 'all') list = list.filter(a => a.client === fclient);
    if (fsub !== 'all') list = list.filter(a => a.sub === fsub);
    if (fs !== 'all') list = list.filter(a => a.status === fs);
    if (fDateFrom || fDateTo) {
      if (fDateFrom) list = list.filter(a => (a.dateAppt || a.dateLog) >= fDateFrom);
      if (fDateTo) list = list.filter(a => (a.dateAppt || a.dateLog) <= fDateTo);
    } else if (fmonth !== 'all') {
      list = list.filter(a => (a.dateAppt || a.dateLog || '').startsWith(fmonth));
    }
    if (q) list = list.filter(a => a.lead.toLowerCase().includes(q) || (a.phone || '').replace(/\s/g,'').includes(q.replace(/\s/g,'')));
    list.sort((a, b) => {
      const ta = a.loggedAt || (a.dateLog ? a.dateLog + 'T00:00:00Z' : '');
      const tb = b.loggedAt || (b.dateLog ? b.dateLog + 'T00:00:00Z' : '');
      return tb.localeCompare(ta);
    });

    const cols = [
      { label: 'Logged', render: r => e('div', null, UI.Mono(this.fmtDate(r.dateLog), { fontSize: 12, color: 'var(--text-mute)' }), r.loggedAt ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 1 } }, new Date(r.loggedAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })) : null) },
      { label: 'Appt date', render: r => UI.Mono(this.fmtDate(r.dateAppt), { fontSize: 12.5, color: 'var(--text-dim)' }) },
      { label: 'Lead', render: r => e('span', { style: { color: 'var(--text)', fontWeight: 600 } }, r.lead) },
      { label: 'Agent', render: r => e('span', { style: { color: 'var(--text-dim)', fontWeight: 500 } }, this.agentName(r.agent, d).split(' ')[0]) },
      { label: 'Client', render: r => this.clientName(r.client, d) },
      { label: 'Subclient', render: r => {
        if (!r.sub) return null;
        const cl = d.clients.find(c => c.id === r.client);
        const sc = cl && cl.subclients ? cl.subclients.find(s => s.id === r.sub) : null;
        return sc ? e('span', { style: { color: 'var(--text-dim)', fontSize: 12.5 } }, sc.name) : null;
      }},
      { label: 'Status', align: 'center', render: r => {
        const sc = { open: { bg: 'oklch(0.24 0.05 240 / .7)', border: 'oklch(0.42 0.10 240)', color: 'oklch(0.78 0.12 220)' }, show: { bg: 'oklch(0.22 0.08 152 / .7)', border: 'oklch(0.42 0.14 152)', color: 'var(--up)' }, no_show: { bg: 'oklch(0.24 0.07 25 / .7)', border: 'oklch(0.42 0.14 25)', color: 'var(--down)' }, cancel: { bg: 'oklch(0.20 0.01 256 / .6)', border: 'var(--border)', color: 'var(--text-mute)' } }[r.status] || { bg: 'var(--surface)', border: 'var(--border)', color: 'var(--text)' };
        return e('select', {
          value: r.status,
          onChange: ev => { ev.stopPropagation(); this.setApptStatus(r.id, ev.target.value); },
          onClick: ev => ev.stopPropagation(),
          style: { padding: '4px 10px', borderRadius: 20, border: '1px solid ' + sc.border, background: sc.bg, color: sc.color, fontSize: 12, cursor: 'pointer', outline: 'none', fontWeight: 700, appearance: 'none', WebkitAppearance: 'none', paddingRight: 22, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%23888\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 7px center' },
        }, e('option', { value: 'open' }, 'Open'), e('option', { value: 'show' }, 'Show'), e('option', { value: 'no_show' }, 'No-show'), e('option', { value: 'cancel' }, 'Cancel'));
      } },
      { label: 'Factuur', align: 'center', render: r => {
        if (r.status === 'cancel' || r.status === 'no_show') return e('span', { style: { fontSize: 11.5, color: 'var(--text-mute)' } }, '—');
        return e('select', {
          value: r.invoiced ? 'invoiced' : 'pending',
          onChange: async ev => { const inv = ev.target.value === 'invoiced'; this.mutLocal(dd => { const f = dd.appointments.find(x => x.id === r.id); if (f) f.invoiced = inv; }); try { await SB.patch('appointments', `?id=eq.${r.id}`, { invoiced: inv }); } catch(e) { this.mutLocal(dd => { const f = dd.appointments.find(x => x.id === r.id); if (f) f.invoiced = !inv; }); this.toast('Fout', 'Factuurstatus kon niet worden opgeslagen', 'var(--down)'); } },
          onClick: ev => ev.stopPropagation(),
          style: { padding: '4px 8px', borderRadius: 7, border: '1px solid ' + (r.invoiced ? 'oklch(0.35 0.10 152)' : 'var(--border)'), background: r.invoiced ? 'oklch(0.22 0.08 152 / .4)' : 'var(--surface)', color: r.invoiced ? 'var(--up)' : 'var(--warn)', fontSize: 12.5, cursor: 'pointer', outline: 'none', fontWeight: 600 },
        }, e('option', { value: 'pending' }, 'Te factureren'), e('option', { value: 'invoiced' }, 'Gefactureerd'));
      } },
      { label: 'Client rate', align: 'right', render: r => {
        const ag = d.agents.find(a => a.id === r.agent);
        const agentRate = r.agentRate != null ? r.agentRate : (r.client === 'c15' ? (rnAgentPay(r) ?? 0) : (ag && ag.rates ? ((ag.rates[r.sub] || ag.rates[r.client]) || 0) : 0));
        const cl = d.clients.find(c => c.id === r.client);
        const sub = r.sub ? (cl?.subclients || []).find(s => s.id === r.sub || s.name === r.sub) : null;
        const displayAmt = (() => { try { const fb = r.clientFeedback ? JSON.parse(r.clientFeedback) : null; if (fb && fb._rn && fb.revenue != null) return fb.revenue; } catch {} return (sub ? sub.rate : 0) || (cl ? cl.rate : 0) || 0; })();
        return e('div', { style: { textAlign: 'right' } },
          UI.Mono(displayAmt ? this.euro(displayAmt) : '—', { fontWeight: 700, color: displayAmt ? 'var(--text)' : 'var(--text-mute)' }),
          agentRate ? e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 1 } }, 'Agent: ' + this.euro(agentRate) + (r.agentRate != null ? ' ✱' : '')) : null,
          r.dealAmount != null ? e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 1 } }, 'Deal: ' + this.euro(r.dealAmount)) : null,
          r.dealCommission != null ? e('div', { style: { fontSize: 10.5, color: 'var(--up)', fontFamily: "'JetBrains Mono'", marginTop: 1, fontWeight: 700 } }, '💰 ' + this.euro(r.dealCommission)) : null);
      } },
    ];

    const periodLabel = { daily: 'yesterday', weekly: 'last week', monthly: 'last month' }[period];

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      // Period toggle + stats
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        e('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
          UI.Seg(period, v => this.setState({ apptPeriod: v }), [{ v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' }])),
        e('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
          Stat('Booked', String(curBooked), pct(curBooked, prevBooked), [curBooked, prevBooked], 'vs ' + prevBooked + ' ' + periodLabel),
          Stat('Shows', String(curShows), pct(curShows, prevShows), [curShows, prevShows], 'vs ' + prevShows + ' ' + periodLabel),
          Stat('Show rate', curRate + '%', (curRate - prevRate >= 0 ? '+' : '') + (curRate - prevRate) + 'pp', [curRate, prevRate], 'vs ' + prevRate + '% ' + periodLabel),
          ...d.agents.filter(a => a.active).map(ag => Stat(ag.name.split(' ')[0], String(cur.filter(a => a.agent === ag.id).length), null, null, agentRate(ag.id) + '% show rate')))),
      // Filters
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        // Row 1: search + status + agent + client
        e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
          e('div', { style: { position: 'relative', flex: '1 1 180px', minWidth: 140 } },
            e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--text-mute)', strokeWidth: 2, style: { position: 'absolute', left: 11, top: 11 } }, e('circle', { cx: 11, cy: 11, r: 7 }), e('path', { d: 'M21 21l-4-4' })),
            e('input', { value: q, placeholder: 'Search lead or phone…', onChange: ev => this.setState({ q: ev.target.value }), style: { width: '100%', padding: '9px 12px 9px 34px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13.5, outline: 'none', boxSizing: 'border-box' } })),
          e('select', { value: fs, onChange: ev => this.setState({ fstatus: ev.target.value }), style: { padding: '9px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer' } },
            e('option', { value: 'all' }, 'All statuses'),
            e('option', { value: 'open' }, 'Open'),
            e('option', { value: 'show' }, 'Show'),
            e('option', { value: 'no_show' }, 'No-show'),
            e('option', { value: 'cancel' }, 'Cancelled')),
          e('select', { value: fagent, onChange: ev => this.setState({ fagent: ev.target.value }), style: { padding: '9px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer' } },
            e('option', { value: 'all' }, 'All agents'),
            ...d.agents.filter(a => a.active).map(ag => e('option', { key: ag.id, value: ag.id }, ag.name))),
          e('select', { value: fclient, onChange: ev => this.setState({ fclient: ev.target.value, fsub: 'all' }), style: { padding: '9px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer' } },
            e('option', { value: 'all' }, 'All clients'),
            ...d.clients.map(c => e('option', { key: c.id, value: c.id }, c.name))),
          subclients.length > 0
            ? e('select', { value: fsub, onChange: ev => this.setState({ fsub: ev.target.value }), style: { padding: '9px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer' } },
                e('option', { value: 'all' }, 'All subclients'),
                ...subclients.map(sc => e('option', { key: sc.id, value: sc.id }, sc.name)))
            : null),
        // Row 2: date quick-select + custom range
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          quickRanges.map(r => e('button', {
            key: r.l,
            onClick: () => this.setState({ fDateFrom: r.from, fDateTo: r.to, fmonth: 'all' }),
            style: { padding: '6px 13px', borderRadius: 8, border: '1px solid ' + (activeQuick && activeQuick.l === r.l ? 'var(--accent)' : 'var(--border)'), background: activeQuick && activeQuick.l === r.l ? 'oklch(0.22 0.06 194 / .5)' : 'var(--surface)', color: activeQuick && activeQuick.l === r.l ? 'var(--accent)' : 'var(--text-mute)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', transition: 'all .12s' }
          }, r.l)),
          (() => {
            const calOpen = !!s.calOpen;
            const calYear = s.calYear !== undefined ? s.calYear : now.getFullYear();
            const calMonth = s.calMonth !== undefined ? s.calMonth : now.getMonth();
            const monthNms = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const dayNms = ['Mo','Tu','We','Th','Fr','Sa','Su'];
            const fmtCal = (y, m, dv) => `${y}-${String(m+1).padStart(2,'0')}-${String(dv).padStart(2,'0')}`;
            const todayStr = isoDate(now);
            const prevM = () => calMonth === 0 ? this.setState({ calMonth: 11, calYear: calYear - 1 }) : this.setState({ calMonth: calMonth - 1 });
            const nextM = () => calMonth === 11 ? this.setState({ calMonth: 0, calYear: calYear + 1 }) : this.setState({ calMonth: calMonth + 1 });
            const onDay = (ds) => {
              if (!fDateFrom || (fDateFrom && fDateTo)) {
                this.setState({ fDateFrom: ds, fDateTo: '', fmonth: 'all' });
              } else if (ds < fDateFrom) {
                this.setState({ fDateFrom: ds, fDateTo: fDateFrom, fmonth: 'all', calOpen: false });
              } else {
                this.setState({ fDateTo: ds, fmonth: 'all', calOpen: false });
              }
            };
            const fmtD = ds => ds ? new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
            const displayLabel = fDateFrom ? fmtD(fDateFrom) + (fDateTo && fDateTo !== fDateFrom ? ' → ' + fmtD(fDateTo) : fDateTo === fDateFrom ? '' : ' → …') : 'Pick range';
            const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
            const startDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
            // Dark theme hardcoded for popup (CSS vars can resolve light in some contexts)
            const C = { bg: '#13191a', bg2: '#1c2526', border: 'rgba(255,255,255,0.08)', text: '#ddeae0', muted: '#5a7060', accent: '#67dcdf', accentBg: 'rgba(103,220,223,0.15)', rangeBg: 'rgba(103,220,223,0.12)' };
            const cells = [];
            for (let i = 0; i < startDow; i++) cells.push(e('div', { key: 'p'+i }));
            for (let dv = 1; dv <= daysInMonth; dv++) {
              const ds = fmtCal(calYear, calMonth, dv);
              const isStart = ds === fDateFrom;
              const isEnd = ds === fDateTo;
              const inRng = fDateFrom && fDateTo && ds > fDateFrom && ds < fDateTo;
              const isToday = ds === todayStr;
              cells.push(e('div', {
                key: dv, onClick: () => onDay(ds),
                style: {
                  width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%',
                  background: isStart || isEnd ? C.accent : inRng ? C.rangeBg : 'transparent',
                  color: isStart || isEnd ? '#071a1a' : isToday ? C.accent : C.text,
                  fontWeight: isStart || isEnd || isToday ? 700 : 400,
                  cursor: 'pointer', fontSize: 13.5,
                  boxShadow: isToday && !isStart && !isEnd ? '0 0 0 1.5px ' + C.accent : 'none',
                  transition: 'background .1s, color .1s',
                }
              }, String(dv)));
            }
            const hasRange = fDateFrom && !activeQuick;
            return e('div', { style: { position: 'relative', marginLeft: 4 } },
              e('button', {
                onClick: () => this.setState({ calOpen: !calOpen, calMonth: calMonth, calYear: calYear }),
                style: {
                  padding: '7px 14px', borderRadius: 9, border: '1px solid ' + (hasRange ? C.accent : 'rgba(255,255,255,0.12)'),
                  background: hasRange ? C.accentBg : C.bg2,
                  color: hasRange ? C.accent : C.muted,
                  fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', fontWeight: 500,
                }
              },
                e('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
                  e('rect', { x: 3, y: 4, width: 18, height: 18, rx: 3 }),
                  e('path', { d: 'M16 2v4M8 2v4M3 10h18' })),
                displayLabel),
              calOpen ? e('div', { onClick: () => this.setState({ calOpen: false }), style: { position: 'fixed', inset: 0, zIndex: 199 } }) : null,
              calOpen ? e('div', { style: { position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 200, background: C.bg, border: '1px solid ' + C.border, borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)', padding: '18px 16px 14px', minWidth: 288, userSelect: 'none' } },
                e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 } },
                  e('button', { onClick: ev => { ev.stopPropagation(); prevM(); }, style: { background: C.bg2, border: '1px solid ' + C.border, color: C.text, width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, '‹'),
                  e('span', { style: { fontWeight: 700, fontSize: 15, color: C.text, letterSpacing: '-.01em' } }, monthNms[calMonth] + ' ' + calYear),
                  e('button', { onClick: ev => { ev.stopPropagation(); nextM(); }, style: { background: C.bg2, border: '1px solid ' + C.border, color: C.text, width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, '›')),
                fDateFrom ? e('div', { style: { background: C.bg2, border: '1px solid ' + C.border, borderRadius: 9, padding: '7px 12px', marginBottom: 12, fontSize: 12.5, color: C.accent, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 } },
                  e('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5 }, e('path', { d: 'M8 6L2 12l6 6M16 6l6 6-6 6' })),
                  fDateFrom ? fmtD(fDateFrom) : '', fDateTo ? ' → ' + fmtD(fDateTo) : e('span', { style: { color: C.muted, fontWeight: 400 } }, ' → pick end date')) : null,
                e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 36px)', gap: 1, marginBottom: 6 } },
                  dayNms.map(d2 => e('div', { key: d2, style: { textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.muted, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '.04em' } }, d2))),
                e('div', { onClick: ev => ev.stopPropagation(), style: { display: 'grid', gridTemplateColumns: 'repeat(7, 36px)', gap: 1 } }, ...cells),
                e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid ' + C.border } },
                  e('button', { onClick: ev => { ev.stopPropagation(); this.setState({ fDateFrom: '', fDateTo: '', fmonth: 'all', calOpen: false }); }, style: { background: 'transparent', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', fontWeight: 600, padding: '4px 8px' } }, 'Clear'),
                  e('button', { onClick: ev => { ev.stopPropagation(); onDay(todayStr); }, style: { background: C.accentBg, border: '1px solid rgba(103,220,223,0.3)', color: C.accent, fontSize: 13, cursor: 'pointer', fontWeight: 700, padding: '5px 14px', borderRadius: 7 } }, 'Today'))
              ) : null);
          })())),
      // Table
      UI.C({ padding: 0, overflow: 'hidden' },
        e('div', { style: { padding: '15px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          UI.Hd(list.length + ' appointments', { fontSize: 15 }),
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
            (() => {
              const totalRev = list.reduce((s2, r) => {
                const cl = d.clients.find(c => c.id === r.client);
                const sub = r.sub ? (cl?.subclients || []).find(s => s.id === r.sub || s.name === r.sub) : null;
                return s2 + ((sub ? sub.rate : 0) || (cl ? cl.rate : 0) || 0);
              }, 0);
              return totalRev > 0 ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                e('span', { style: { fontSize: 12.5, color: 'var(--text-mute)', fontWeight: 600 } }, 'Revenue'),
                e('span', { style: { fontSize: 16, fontWeight: 700, color: 'var(--accent)', fontFamily: "'Space Grotesk'" } }, this.euro(totalRev))) : null;
            })(),
            e('button', {
              onClick: () => {
                const rows = [['Appt Date', 'Logged', 'Lead', 'Phone', 'Agent', 'Client', 'Subclient', 'Status', 'Client Rate', 'Agent Rate']];
                list.forEach(r => {
                  const cl = d.clients.find(c => c.id === r.client);
                  const sub = r.sub ? (cl?.subclients || []).find(s => s.id === r.sub || s.name === r.sub) : null;
                  const ag = d.agents.find(a => a.id === r.agent);
                  const clientRate = (sub ? sub.rate : 0) || (cl ? cl.rate : 0) || 0;
                  const agentRate = r.agentRate != null ? r.agentRate : (r.client === 'c15' ? (rnAgentPay(r) ?? 0) : (ag && ag.rates ? ((ag.rates[r.sub] || ag.rates[r.client]) || 0) : 0));
                  rows.push([r.dateAppt || '', r.dateLog || '', r.lead || '', r.phone || '', ag ? ag.name : '', cl ? cl.name : '', sub ? sub.name : '', r.status || '', clientRate, agentRate]);
                });
                const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                a.download = 'appointments.csv';
                a.click();
              },
              style: { padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mute)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }
            }, '↓ Export CSV'))),
        UI.Table(cols, list.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 800, empty: 'No appointments match.' })));
  },

  _admClients(d, s) {
    const e = React.createElement;
    const agencies = d.clients.filter(x => x.type === 'agency');
    const directs = d.clients.filter(x => x.type !== 'agency');
    const directCols = [
      { label: 'Client', render: x => e('span', { style: { color: 'var(--text)', fontWeight: 700 } }, x.name) },
      { label: 'Status', align: 'center', render: x => e('button', { onClick: ev => { ev.stopPropagation(); this.cycleClientStatus(x.id); }, style: { background: 'none', border: 'none', cursor: 'pointer', padding: 0 } }, UI.statusPill(x.status || 'inactive')) },
      { label: 'Agents', render: x => d.agents.filter(a => (a.clients || []).includes(x.id)).map(a => this.agentName(a.id, d).split(' ')[0]).join(', ') || '—' },
      { label: 'Vergoeding', align: 'right', render: x => e('span', { style: { fontSize: 12, fontWeight: 600, color: UI.rateStr(x) === '—' ? 'var(--text-dim)' : 'var(--up)' } }, UI.rateStr(x)) },
      { label: 'Month appts', align: 'right', render: x => String(d.appointments.filter(a => a.client === x.id && !a.invoiced).length) },
      { label: 'Billing', align: 'center', render: x => e('button', { onClick: ev => { ev.stopPropagation(); x.billStatus === 'paid' ? this.unmarkPaid(x.id) : this.markPaid(x.id); }, style: { background: 'none', border: 'none', cursor: 'pointer', padding: 0 } }, UI.statusPill(x.billStatus || 'pending')) },
      { label: '', align: 'right', render: x => UI.Btn('Open', () => this.openModal('clientProfile', { id: x.id }), 'soft', { padding: '5px 12px', fontSize: 12 }) },
    ];
    const agencyCols = [
      { label: 'Agency', render: x => UI.Row({ gap: 8 }, e('span', { style: { color: 'var(--text)', fontWeight: 700 } }, x.name), UI.Pill('Agency', 'var(--info)', 'oklch(0.30 0.05 240)')) },
      { label: 'Sub-clients', render: x => (x.subclients || []).length ? e('span', { style: { fontSize: 12.5, color: 'var(--text-mute)' } }, (x.subclients || []).map(sc => sc.name || sc).join(' · ')) : e('span', { style: { fontSize: 12, color: 'var(--text-dim)' } }, '—') },
      { label: 'Vergoeding', align: 'right', render: x => e('span', { style: { fontSize: 12, fontWeight: 600, color: UI.rateStr(x) === '—' ? 'var(--text-dim)' : 'var(--up)' } }, UI.rateStr(x)) },
      { label: 'Status', align: 'center', render: x => e('button', { onClick: ev => { ev.stopPropagation(); this.cycleClientStatus(x.id); }, style: { background: 'none', border: 'none', cursor: 'pointer', padding: 0 } }, UI.statusPill(x.status || 'inactive')) },
      { label: 'Billing', align: 'center', render: x => e('button', { onClick: ev => { ev.stopPropagation(); x.billStatus === 'paid' ? this.unmarkPaid(x.id) : this.markPaid(x.id); }, style: { background: 'none', border: 'none', cursor: 'pointer', padding: 0 } }, UI.statusPill(x.billStatus || 'pending')) },
      { label: '', align: 'right', render: x => UI.Btn('Open', () => this.openModal('clientProfile', { id: x.id }), 'soft', { padding: '5px 12px', fontSize: 12 }) },
    ];
    // Subclient accounts section
    const scPending = s.scPending || {};
    const subAccountsBlock = agencies.length ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      UI.SectionHd('Subclient accounts'),
      UI.C({},
        e('div', { style: { fontSize: 13, color: 'var(--text-mute)', marginBottom: 14 } }, 'Create login accounts for subclients of lead agencies. Password is always InfiniteScale2026!'),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          agencies.map(ag => {
            const subs = (ag.subclients || []).filter(sc => sc.id);
            if (!subs.length) return null;
            return e('div', { key: ag.id },
              e('div', { style: { fontWeight: 700, fontSize: 13.5, color: 'var(--text)', marginBottom: 8 } }, ag.name),
              e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                subs.map(sc => {
                  const hasAccount = !!sc.user_id;
                  const pendingKey = ag.id + sc.id;
                  const pendingEmail = scPending[pendingKey] !== undefined ? scPending[pendingKey] : (sc.email || '');
                  return e('div', { key: sc.id, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border-soft)' } },
                    e('span', { style: { flex: '0 0 200px', fontSize: 13.5, fontWeight: 600, color: 'var(--text)' } }, sc.name),
                    hasAccount
                      ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: 1 } },
                          e('span', { style: { fontSize: 12.5, color: 'var(--up)', fontWeight: 600 } }, '✓ ' + sc.email),
                          UI.Btn('Delete account', async () => {
                            if (!confirm('Remove login access for ' + sc.name + '?')) return;
                            await scDeleteAccount(this, ag.id, sc.id);
                          }, 'soft', { padding: '4px 11px', fontSize: 11.5, color: 'var(--down)' }))
                      : e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 } },
                          e('input', { type: 'email', placeholder: 'Email address…', value: pendingEmail, onChange: ev => this.setState(st => ({ scPending: { ...(st.scPending || {}), [pendingKey]: ev.target.value } })), style: { flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none', maxWidth: 280 } }),
                          UI.Btn('Create account', async () => {
                            const email = (scPending[pendingKey] || '').trim();
                            if (!email) return this.toast('Error', 'Enter an email address first', 'var(--down)');
                            try {
                              await scCreateAccount(this, ag.id, sc.id, email, sc.name);
                              this.setState(st => { const p = { ...(st.scPending || {}) }; delete p[pendingKey]; return { scPending: p }; });
                            } catch(err) { this.toast('Error', err.message, 'var(--down)'); }
                          }, 'primary', { padding: '6px 14px', fontSize: 12 })));
                })));
          }).filter(Boolean)))) : null;

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
      UI.Row({ justifyContent: 'space-between' }, UI.Hd('Clients & lead agencies'), UI.Row({ gap: 8 }, UI.Btn('↑ Upload contract', () => this.openModal('uploadClientContract'), 'soft'), UI.Btn('Add client', () => this.openModal('createClient'), 'primary'))),
      agencies.length ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        UI.SectionHd('Lead agencies'),
        UI.C({ padding: 0, overflow: 'hidden' }, UI.Table(agencyCols, agencies, { min: 580, empty: 'No agencies yet.' }))) : null,
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        agencies.length ? UI.SectionHd('Direct clients') : null,
        UI.C({ padding: 0, overflow: 'hidden' }, UI.Table(directCols, directs, { min: 680, empty: 'No clients yet.' }))),
      subAccountsBlock);
  },

  _admAgents(d, s) {
    const e = React.createElement; const today = this.iso(this.today());
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      UI.Row({ justifyContent: 'space-between' }, UI.Hd('Call agents'), UI.Btn('Create agent', () => this.openModal('createAgent'), 'primary')),
      UI.C({ padding: 0, overflow: 'hidden' }, UI.Table([
        { label: 'Agent', render: x => e('span', { style: { color: x.active ? 'var(--text)' : 'var(--text-mute)', fontWeight: 700 } }, x.name) },
        { label: 'Status', render: x => !x.active ? UI.Pill('Deactivated', 'var(--text-mute)', 'var(--bg-2)') : UI.Row({}, e('span', { style: { width: 8, height: 8, borderRadius: '50%', background: x.working ? 'var(--up)' : 'var(--text-mute)' } }), e('span', { style: { fontSize: 12.5, color: x.working ? 'var(--up)' : 'var(--text-mute)', fontWeight: 600 } }, x.working ? 'Working' : 'Offline')) },
        { label: 'Stage', align: 'center', render: x => UI.Pill({ launched: 'Launched', started: 'Started', signed: 'Signed' }[x.status] || x.status, 'var(--violet)', 'oklch(0.30 0.05 295)') },
        { label: 'Clients', render: x => [...new Set((x.clients || []).filter(c => d.clients.find(cl => cl.id === c)).map(c => this.clientName(c, d).split(' ')[0]))].join(', ') },
        { label: 'Dials today', align: 'right', render: x => UI.Mono((d.dials[x.id] || {})[today] || 0, { fontWeight: 700 }) },
        { label: '', align: 'right', render: x => UI.Btn('Open', () => this.openModal('agentProfile', { id: x.id }), 'soft', { padding: '5px 12px', fontSize: 12 }) },
      ], d.agents, { min: 720 })));
  },

  _admEod(d, s) {
    const e = React.createElement;
    const activeAgents = d.agents.filter(a => a.active);
    // Show last 14 working days regardless of submissions — so days with zero reports still appear
    const today = new Date(); today.setHours(0,0,0,0);
    const localISO = dt => { const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), day = String(dt.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
    const dateSet = new Set();
    for (let i = 0; i < 30 && dateSet.size < 14; i++) {
      const d2 = new Date(today); d2.setDate(today.getDate() - i);
      const dow = d2.getDay();
      if (dow !== 0 && dow !== 6) dateSet.add(localISO(d2)); // skip weekends
    }
    d.eods.forEach(r => dateSet.add(r.date)); // also include any older dates with submissions
    const dates = [...dateSet].sort((a, b) => b.localeCompare(a));
    if (!activeAgents.length) return UI.C({}, UI.SectionHd('End-of-day reports'), e('div', { style: { padding: 24, textAlign: 'center', color: 'var(--text-mute)', fontStyle: 'italic' } }, 'No active agents.'));
    const expandedDates = s.eodDateOpen || {};
    const expandedAgents = s.eodAgentOpen || {};
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      UI.SectionHd('End-of-day reports'),
      ...dates.map(date => {
        const dateOpen = !!expandedDates[date];
        const dayEods = d.eods.filter(r => r.date === date);
        const submittedIds = new Set(dayEods.map(r => r.agent));
        const missingCount = activeAgents.filter(a => !submittedIds.has(a.id)).length;
        return e('div', { key: date, style: { borderRadius: 14, border: '1px solid var(--border-soft)', overflow: 'hidden' } },
          e('div', { onClick: () => this.setState(st => ({ eodDateOpen: { ...(st.eodDateOpen || {}), [date]: !st.eodDateOpen?.[date] } })),
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', cursor: 'pointer', background: dateOpen ? 'var(--bg-2)' : 'var(--surface)', userSelect: 'none' } },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
              e('span', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 15 } }, this.fmtFull(date)),
              missingCount > 0 ? e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--down)', background: 'oklch(0.22 0.08 0 / .3)', border: '1px solid var(--down)', borderRadius: 20, padding: '2px 9px' } }, missingCount + ' missing') : e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--up)', background: 'oklch(0.22 0.08 152 / .3)', borderRadius: 20, padding: '2px 9px' } }, 'All submitted ✓')),
            e('span', { style: { fontSize: 16, color: 'var(--text-mute)', transform: dateOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
          dateOpen ? e('div', { style: { borderTop: '1px solid var(--border-soft)' } },
            activeAgents.map((agent, ai) => {
              const eod = dayEods.find(r => r.agent === agent.id);
              const agentOpen = !!expandedAgents[date + agent.id];
              const hasMissing = !eod;
              return e('div', { key: agent.id, style: { borderBottom: ai < activeAgents.length - 1 ? '1px solid var(--border-soft)' : 'none' } },
                e('div', { onClick: () => eod && this.setState(st => ({ eodAgentOpen: { ...(st.eodAgentOpen || {}), [date + agent.id]: !st.eodAgentOpen?.[date + agent.id] } })),
                  style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 22px', cursor: eod ? 'pointer' : 'default', background: agentOpen ? 'oklch(0.16 0.015 256 / .5)' : 'transparent' } },
                  e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    e('span', { style: { fontWeight: 600, fontSize: 13.5, color: hasMissing ? 'var(--down)' : 'var(--text)' } }, agent.name),
                    hasMissing ? e('span', { style: { fontSize: 11, color: 'var(--down)', fontStyle: 'italic' } }, 'No report submitted') :
                      e('span', { style: { fontSize: 11.5, color: 'var(--text-mute)' } }, (eod.clients || []).length + ' clients · ' + Object.values(eod.calls || {}).reduce((x, v) => x + v, 0) + ' calls · ' + Object.values(eod.appts || {}).reduce((x, v) => x + v, 0) + ' appts')),
                  eod ? e('span', { style: { fontSize: 15, color: 'var(--text-mute)', transform: agentOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block' } }, '›') : null),
                agentOpen && eod ? e('div', { style: { padding: '12px 22px 16px', borderTop: '1px solid var(--border-soft)', background: 'var(--bg-2)' } },
                  (() => {
                    const blocks = eod.callBlocks || [];
                    const totalMins = blocks.reduce((sum, b) => {
                      if (!b.from || !b.to) return sum;
                      const [fh, fm] = b.from.split(':').map(Number);
                      const [th, tm] = b.to.split(':').map(Number);
                      return sum + Math.max(0, (th * 60 + tm) - (fh * 60 + fm));
                    }, 0);
                    const hoursStr = totalMins > 0 ? Math.floor(totalMins / 60) + 'h ' + (totalMins % 60 > 0 ? totalMins % 60 + 'm' : '') : null;
                    const agentDials = (d.dials[agent.id] || {})[date] || 0;
                    return e('div', null,
                      e('div', { style: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
                        hoursStr ? e('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'oklch(0.30 0.10 194 / .2)', border: '1px solid oklch(0.45 0.18 194 / .4)', borderRadius: 8, padding: '3px 10px', fontFamily: "'JetBrains Mono'" } }, '⏱ ' + hoursStr) : null,
                        agentDials > 0 ? e('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--text-mute)', background: 'var(--surface)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '3px 10px', fontFamily: "'JetBrains Mono'" } }, agentDials + ' CloudTalk dials') : null,
                        blocks.length > 0 ? blocks.map((b, i) => e('span', { key: i, style: { fontSize: 12, fontFamily: "'JetBrains Mono'", color: 'var(--accent)', background: 'oklch(0.30 0.10 194 / .1)', border: '1px solid oklch(0.45 0.18 194 / .25)', padding: '3px 9px', borderRadius: 6 } }, b.from + ' – ' + b.to)) : null),
                      (eod.clients || []).length > 0 ? e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginBottom: 10 } },
                        (eod.clients || []).map(cid => e('div', { key: cid, style: { padding: '9px 12px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border-soft)' } },
                          e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 600, marginBottom: 3 } }, this.clientName(cid, d)),
                          e('div', { style: { display: 'flex', gap: 8 } },
                            e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'JetBrains Mono'" } }, (eod.calls[cid] || 0) + ' calls'),
                            e('span', { style: { color: 'var(--text-mute)' } }, '·'),
                            e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--info)', fontFamily: "'JetBrains Mono'" } }, (eod.appts[cid] || 0) + ' appts'))))) : null,
                      e('div', { style: { fontSize: 12.5, color: 'var(--text-mute)', lineHeight: 1.6 } },
                        eod.well ? e('div', null, e('b', { style: { color: 'var(--text-dim)' } }, 'Win: '), eod.well) : null,
                        eod.bad ? e('div', null, e('b', { style: { color: 'var(--text-dim)' } }, 'Bad: '), eod.bad) : null,
                        eod.goal ? e('div', null, e('b', { style: { color: 'var(--text-dim)' } }, 'Goal tomorrow: '), eod.goal) : null));
                  })()) : null);
            })) : null);
      }));
  },

  _admTimeline(d, s) {
    const e = React.createElement;
    const todayStr = this.iso(this.today());

    const STAGES = [
      { id: 'kickoff_call',       label: 'Kickoff call',       days: 'Dag 0–1', color: 'var(--info)',   num: 1 },
      { id: 'kickoff_briefing',   label: 'Kickoff briefing',   days: 'Dag 1–2', color: 'var(--accent)', num: 2 },
      { id: 'agent_matching',     label: 'Agent matching',     days: 'Dag 2',   color: 'var(--warn)',   num: 3 },
      { id: 'briefing_training',  label: 'Briefing & training',days: 'Dag 2–3', color: '#a78bfa',      num: 4 },
      { id: 'test_calls',         label: 'Testbelrondes',      days: 'Dag 3–4', color: 'var(--up)',     num: 5 },
    ];

    const moveStage = (clientId, stageId) => {
      this.mutLocal(dd => { const c = dd.clients.find(x => x.id === clientId); if (c) c.timelineStage = stageId; });
      API.updateClient(clientId, { timeline_stage: stageId });
    };

    const dragOver = s._tlDragOver || null;
    const onDragStart = (ev, id) => { ev.dataTransfer.effectAllowed = 'move'; this._tlDragId = id; };
    const onDragOver = (ev, stageId) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; if (dragOver !== stageId) this.setState({ _tlDragOver: stageId }); };
    const onDrop = (ev, stageId) => { ev.preventDefault(); const id = this._tlDragId; this._tlDragId = null; this.setState({ _tlDragOver: null }); if (id) moveStage(id, stageId); };
    const onDragEnd = () => { this._tlDragId = null; this.setState({ _tlDragOver: null }); };

    const activeClients = d.clients.filter(c => c.kickoff || c.timelineStage);
    const noKickoff = d.clients.filter(c => !c.kickoff && !c.timelineStage && c.status === 'active');

    // Progress bar at top
    const stageProgress = e('div', { style: { display: 'flex', alignItems: 'stretch', borderRadius: 10, overflow: 'hidden', height: 8, marginBottom: 20, gap: 2 } },
      STAGES.map(sg => e('div', { key: sg.id, style: { flex: 1, background: sg.color, opacity: 0.7 } })));

    // Stage header strip
    const stageStrip = e('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 8, marginBottom: 8 } },
      STAGES.map(sg => e('div', { key: sg.id, style: { textAlign: 'center' } },
        e('div', { style: { fontSize: 11, fontWeight: 700, color: sg.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 } }, sg.label),
        e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)' } }, sg.days))));

    // Kanban columns
    const columns = e('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 8, alignItems: 'start' } },
      STAGES.map(sg => {
        const cards = activeClients.filter(c => (c.timelineStage || 'kickoff_call') === sg.id);
        const isOver = dragOver === sg.id;
        return e('div', {
          key: sg.id,
          onDragOver: ev => onDragOver(ev, sg.id),
          onDrop: ev => onDrop(ev, sg.id),
          style: { minHeight: 120, borderRadius: 10, padding: '8px 6px', background: isOver ? 'oklch(0.22 0.05 240 / .18)' : 'var(--surface)', border: `1.5px solid ${isOver ? sg.color : 'var(--border-soft)'}`, transition: 'border-color 0.15s, background 0.15s', display: 'flex', flexDirection: 'column', gap: 8 } },
          cards.length === 0 ? e('div', { style: { textAlign: 'center', color: 'var(--text-mute)', fontSize: 11.5, padding: '18px 4px', fontStyle: 'italic' } }, 'Drop here') : null,
          cards.map(c => {
            const linkedAgent = c.linkedAgentId ? d.agents.find(a => a.id === c.linkedAgentId) : null;
            const linkedRecruit = c.linkedRecruitId ? (d.recruits || []).find(r => r.id === c.linkedRecruitId) : null;
            const linkedName = linkedAgent ? linkedAgent.name : linkedRecruit ? linkedRecruit.name : null;
            const koDate = c.kickoff ? c.kickoff.slice(0, 10) : null;
            const daysSinceKo = koDate ? Math.round((new Date(todayStr) - new Date(koDate)) / 86400000) : null;
            const hasAgent = !!(linkedAgent || linkedRecruit);
            const needsAgent = !hasAgent && sg.id === 'agent_matching';
            const cardBorder = hasAgent ? '1.5px solid var(--up)' : needsAgent ? '1.5px solid var(--down)' : '1px solid var(--border-soft)';
            const timelineSubclient = (c.subclients || []).find(sc => sc.timeline_selected);
            return e('div', {
              key: c.id,
              draggable: true,
              onDragStart: ev => onDragStart(ev, c.id),
              onDragEnd: onDragEnd,
              onClick: () => this.openModal('timelineDetail', { clientId: c.id }),
              style: { background: 'var(--bg)', borderRadius: 8, padding: '10px 10px 8px', cursor: 'grab', boxShadow: '0 1px 4px oklch(0 0 0 / .12)', border: cardBorder, userSelect: 'none' } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 } },
                e('div', null,
                  e('div', { style: { fontWeight: 700, fontSize: 13, color: 'var(--text)' } }, c.name),
                  timelineSubclient ? e('div', { style: { fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginTop: 1 } }, '↳ ' + timelineSubclient.name) : null),
                e('button', { onClick: ev => { ev.stopPropagation(); if (confirm('Project van timeline verwijderen?')) { API.updateClient(c.id, { kickoff: null, timeline_stage: null }); this.mutLocal(dd => { const cl = dd.clients.find(x => x.id === c.id); if (cl) { cl.kickoff = null; cl.timelineStage = null; } }); } }, style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', fontSize: 14, padding: '0 0 0 4px', lineHeight: 1 } }, '×')),
              koDate ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginBottom: 3 } }, '📅 Kickoff: ' + this.fmtFull(koDate)) : null,
              c.agentStartDate ? e('div', { style: { fontSize: 11, color: 'var(--up)', marginBottom: 3, fontWeight: 600 } }, '🚀 Start agent: ' + this.fmtFull(c.agentStartDate)) : null,
              linkedName ? e('div', { style: { fontSize: 11.5, color: linkedAgent ? 'var(--up)' : 'var(--accent)', fontWeight: 600, marginBottom: 3 } }, '→ ' + linkedName + (linkedAgent ? '' : ' (recruit)')) : e('div', { style: { fontSize: 11, color: 'var(--warn)', marginBottom: 3 } }, '⚠ Geen agent'),
              daysSinceKo !== null ? e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)' } }, `Dag ${daysSinceKo}`) : null,
              c.needsLeadlist ? e('div', { style: { marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: 'var(--warn)', background: 'oklch(0.20 0.06 60 / .25)', border: '1px solid var(--warn)', borderRadius: 5, padding: '2px 6px' } }, '📋 Leadlist') : null);
          })
        );
      }));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
        e('div', null,
          e('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--text)' } }, 'Project Timeline'),
          e('div', { style: { fontSize: 12.5, color: 'var(--text-mute)', marginTop: 2 } }, activeClients.length + ' actieve projecten · sleep kaarten tussen stages')),
        UI.Btn('+ Client toevoegen aan timeline', () => this.openModal('timelineAdd', {}), 'primary', { fontSize: 12.5 })),
      stageProgress,
      stageStrip,
      activeClients.length === 0
        ? e('div', { style: { padding: 40, textAlign: 'center', color: 'var(--text-mute)', fontStyle: 'italic', background: 'var(--surface)', borderRadius: 12 } }, 'Geen actieve projecten. Stel een kickoff datum in op een client.')
        : columns,
      noKickoff.length > 0 ? e('div', { style: { marginTop: 16, fontSize: 12, color: 'var(--text-mute)', fontStyle: 'italic' } }, 'Zonder kickoff: ' + noKickoff.map(c => c.name).join(', ')) : null);
  },

  _admProspects(d, s) {
    const e = React.createElement;
    const stageColors = { new: 'var(--text-mute)', first: 'var(--info)', meeting: 'var(--warn)', followup: 'var(--accent)', closed: 'var(--up)', lost: 'var(--down)' };
    const stageLabel = { new: 'New lead', first: 'First contact', meeting: 'Meeting booked', followup: 'Follow-up', closed: 'Closed', lost: 'Lost' };
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      UI.Row({ justifyContent: 'space-between' }, UI.Hd('Prospect CRM — acquisition'), UI.Btn('+ Add prospect', () => this.openModal('prospectAdd'), 'primary')),
      UI.C({ padding: 0, overflow: 'hidden' }, UI.Table([
        { label: 'Company', render: x => e('div', null,
            e('span', { style: { color: 'var(--text)', fontWeight: 700 } }, x.company),
            x.last_followup ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 2 } }, 'Last FU: ' + x.last_followup) : null) },
        { label: 'Contact', render: x => e('div', null, e('div', { style: { color: 'var(--text-dim)' } }, x.contact || '—'), x.email ? UI.Mono(x.email, { fontSize: 11, color: 'var(--text-mute)' }) : UI.Mono(x.phone || '', { fontSize: 11, color: 'var(--text-mute)' })) },
        { label: 'Owner', render: x => e('span', { style: { color: 'var(--text-dim)' } }, x.assigned || '—') },
        { label: 'Source', render: x => UI.Pill(x.source, 'var(--text-dim)', 'var(--bg-2)') },
        { label: 'Stage', render: x => e('span', { style: { fontWeight: 700, fontSize: 12.5, color: stageColors[x.stage] || 'var(--text-mute)' } }, stageLabel[x.stage] || x.stage) },
        { label: 'Next', render: x => e('div', { onClick: ev => ev.stopPropagation(), style: { position: 'relative' } },
            e('input', { type: 'date', value: x.next_date || '', onChange: ev => { ev.stopPropagation(); this.updateProspectDetail(x.id, { next_date: ev.target.value }); },
              style: { position: 'absolute', opacity: 0, inset: 0, width: '100%', cursor: 'pointer' } }),
            x.next_date ? e('span', { style: { fontSize: 12, color: new Date(x.next_date) < new Date() ? 'var(--down)' : 'var(--accent)', fontFamily: "'JetBrains Mono'", pointerEvents: 'none' } }, x.next_date)
                        : e('span', { style: { color: 'var(--text-mute)', fontSize: 12, pointerEvents: 'none' } }, 'Set date')) },
        { label: '', align: 'right', render: x => e('div', { onClick: ev => ev.stopPropagation(), style: { display: 'flex', gap: 6 } },
            UI.Btn('Follow-up', () => this.openModal('prospectFollowup', { prospect: x }), 'soft', { padding: '4px 10px', fontSize: 11.5 }),
            UI.Btn('Contract', () => this.openModal('wizard', { step: 0, partyType: 'client', company: x.company, contact: x.contact, email: x.email || '', phone: x.phone || '' }), 'ghost', { padding: '4px 10px', fontSize: 11.5 })) },
      ], d.prospects.map(x => ({ ...x, _onClick: () => this.openModal('prospectDetail', { prospect: x }) })), { min: 860 })));
  },

  _admRecruit(d, s) {
    const e = React.createElement;

    const defaultStages = [
      { id: 'new', label: 'New', color: 'var(--info)' },
      { id: 'qualified', label: 'Qualified', color: 'var(--accent)' },
      { id: 'interview', label: 'Interview', color: 'var(--warn)' },
      { id: 'hired', label: 'Hired', color: 'var(--up)' },
      { id: 'not_qualified', label: 'Not qualified', color: 'var(--text-mute)' },
    ];
    // Stages are shared across all admins — stored in platform_settings, loaded into state
    const saveStages = (next) => {
      this.setState({ _recruitStages: next, _recruitStageTick: (s._recruitStageTick || 0) + 1 });
      this.mutLocal(dd => { dd.settings = dd.settings || {}; dd.settings.recruit_stages = JSON.stringify(next); });
      API.saveSetting('recruit_stages', JSON.stringify(next));
    };
    // Use state if loaded, else use data from platform_settings, else defaults
    const stages = s._recruitStages || (() => {
      const raw = (d.settings || {}).recruit_stages;
      if (raw) { try { return JSON.parse(raw); } catch(e) {} }
      // No DB entry yet — migrate from localStorage if present, else use defaults
      const lsRaw = (() => { try { return localStorage.getItem('is_recruit_stages_v2') || localStorage.getItem('is_recruit_stages'); } catch(e) { return null; } })();
      if (lsRaw) { try { const ls = JSON.parse(lsRaw); if (Array.isArray(ls) && ls.length) { API.saveSetting('recruit_stages', lsRaw); return ls; } } catch(e) {} }
      return defaultStages;
    })();

    const dragOver = s._recruitDragOver || null;

    const onDragStart = id => { this._recruitDragId = id; this._stageDragIdx = null; };
    const onDragOver = (ev, stageId) => { ev.preventDefault(); if (dragOver !== stageId) this.setState({ _recruitDragOver: stageId }); };
    const onDrop = (ev, stageId) => {
      ev.preventDefault();
      const id = this._recruitDragId;
      this._recruitDragId = null;
      this.setState({ _recruitDragOver: null });
      if (!id) return;
      const recruit = d.recruits.find(r => r.id === id);
      if (!recruit || recruit.stage === stageId) return;
      this.advanceRecruit(id, stageId);
    };
    const onDragEnd = () => { this._recruitDragId = null; this._stageDragIdx = null; this.setState({ _recruitDragOver: null, _stageDragOverIdx: null }); };

    // Stage reordering drag
    const stageDragOverIdx = s._stageDragOverIdx != null ? s._stageDragOverIdx : null;
    const onStageDragStart = (ev, idx) => { ev.stopPropagation(); this._stageDragIdx = idx; this._recruitDragId = null; ev.dataTransfer.effectAllowed = 'move'; };
    const onStageDragOver = (ev, idx) => { ev.preventDefault(); ev.stopPropagation(); if (stageDragOverIdx !== idx) this.setState({ _stageDragOverIdx: idx }); };
    const onStageDrop = (ev, idx) => {
      ev.preventDefault(); ev.stopPropagation();
      const from = this._stageDragIdx;
      this._stageDragIdx = null;
      this.setState({ _stageDragOverIdx: null });
      if (from == null || from === idx) return;
      const next = [...stages];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      saveStages(next);
    };
    const onStageDragEnd = () => { this._stageDragIdx = null; this.setState({ _stageDragOverIdx: null }); };

    const renameStage = (id, newLabel) => saveStages(stages.map(sg => sg.id === id ? { ...sg, label: newLabel } : sg));
    const recolorStage = (id, color) => saveStages(stages.map(sg => sg.id === id ? { ...sg, color } : sg));
    const removeStage = id => saveStages(stages.filter(sg => sg.id !== id));
    const addStage = () => { const id = 'stage_' + Date.now(); saveStages([...stages, { id, label: 'New stage', color: '#6366f1' }]); };

    const collapsed = s._recruitCollapsed || {};
    const toggleCollapse = id => this.setState(st => { const c = { ...(st._recruitCollapsed || {}) }; c[id] = !c[id]; return { _recruitCollapsed: c }; });

    const toggleSalesExp = (id, cur) => {
      const val = !cur;
      this.mutLocal(dd => {
        const r = dd.recruits.find(x => x.id === id);
        if (r) r.salesExp = val;
        // Also update settings map so it survives re-renders without a full reload
        dd.settings = dd.settings || {};
        const raw = dd.settings.recruit_sales_exp;
        let map = {};
        try { map = raw ? JSON.parse(raw) : {}; } catch(_) {}
        if (val) map[id] = true; else delete map[id];
        dd.settings.recruit_sales_exp = JSON.stringify(map);
      });
      API.saveSalesExp(id, val);
    };

    // Table column definitions
    const cols = [
      { label: 'Name', key: 'name', w: 150, bold: true },
      { label: 'Sales', key: 'salesExp', w: 54, salesExp: true },
      { label: 'Role', key: 'position', w: 130 },
      { label: 'Country', key: 'country', w: 90 },
      { label: 'Age', key: 'age', w: 55 },
      { label: 'Gender', key: 'gender', w: 75 },
      { label: 'Source', key: 'source', w: 120, pill: true },
      { label: 'Language', key: 'lang', w: 130 },
      { label: 'Phone', key: 'phone', w: 130, mono: true },
      { label: 'Email', key: 'email', w: 180, mono: true },
      { label: 'Experience', key: 'experience', w: 110 },
      { label: 'Start', key: 'start', w: 90 },
      { label: 'Availability', key: 'avail', w: 130, arr: true },
      { label: 'Motivation', key: 'motivation', w: 220 },
    ];

    const totalW = 28 + cols.reduce((s, c) => s + c.w, 0);
    const cellStyle = (col) => ({
      width: col.w + 'px', minWidth: col.w + 'px', maxWidth: col.w + 'px',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      fontSize: 11.5, padding: '0 8px', boxSizing: 'border-box', flexShrink: 0,
    });

    const headerRow = e('div', {
      style: { display: 'flex', alignItems: 'center', borderBottom: '2px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 2, paddingLeft: 0, minWidth: totalW + 'px' },
    },
      e('div', { style: { width: 28, flexShrink: 0 } }),
      cols.map(col => e('div', { key: col.key, style: { ...cellStyle(col), fontSize: 10, fontWeight: 700, color: 'var(--text-mute)', letterSpacing: '.06em', textTransform: 'uppercase', padding: '5px 8px' } }, col.label)));

    const candidateRow = (it, stageColor) => e('div', {
      key: it.id,
      draggable: true,
      onDragStart: () => onDragStart(it.id),
      onDragEnd,
      onClick: () => this.openModal('recruitProfile', { id: it.id }),
      style: { display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-soft)', cursor: 'grab', minHeight: 27, transition: 'background .1s', minWidth: totalW + 'px' },
      onMouseEnter: ev => { ev.currentTarget.style.background = 'var(--surface-2)'; },
      onMouseLeave: ev => { ev.currentTarget.style.background = 'transparent'; },
    },
      e('div', { style: { width: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        e('span', { style: { width: 3, height: 14, borderRadius: 2, background: stageColor, display: 'inline-block', opacity: 0.7 } })),
      cols.map(col => {
        if (col.salesExp) {
          const hasSales = !!it.salesExp;
          return e('div', {
            key: col.key,
            style: { ...cellStyle(col), display: 'flex', alignItems: 'center', justifyContent: 'center' },
            onClick: ev => { ev.stopPropagation(); toggleSalesExp(it.id, it.salesExp); },
            title: hasSales ? 'Has sales experience (click to toggle)' : 'No sales experience (click to toggle)',
          }, hasSales
            ? e('span', { style: { fontSize: 9.5, fontWeight: 700, color: 'var(--up)', background: 'oklch(0.22 0.08 152 / .25)', border: '1px solid var(--up)', borderRadius: 3, padding: '1px 5px', letterSpacing: '.03em', cursor: 'pointer' } }, 'SALES')
            : null);
        }
        let val = it[col.key];
        if (col.arr && Array.isArray(val)) val = val.join(', ');
        val = val || '';
        if (col.pill && val) {
          return e('div', { key: col.key, style: { ...cellStyle(col), display: 'flex', alignItems: 'center' } },
            e('span', { style: { fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', background: 'var(--bg-2)', border: '1px solid var(--border-soft)', borderRadius: 3, padding: '1px 5px' } }, val));
        }
        const style = { ...cellStyle(col), color: col.bold ? 'var(--text)' : 'var(--text-dim)', fontWeight: col.bold ? 600 : 400, fontFamily: col.mono ? "'JetBrains Mono', monospace" : undefined };
        return e('div', { key: col.key, style }, val || e('span', { style: { color: 'var(--border-soft)' } }, '—'));
      }));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
      // Top bar
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
        e('div', null, UI.Hd('Recruitment'), UI.Sub('Applications flow in from the platform intake form.', { marginTop: 3 })),
        e('div', { style: { display: 'flex', gap: 8 } },
          UI.Btn('Preview intake form', () => this.openModal('intakeForm'), 'ghost'))),

      // Scrollable table
      e('div', { style: { border: '1px solid var(--border)', borderRadius: 8, overflowX: 'auto', overflowY: 'visible' } },
        headerRow,

        // Stages stacked vertically
        stages.map((sg, si) => {
          const items = d.recruits.filter(r => r.stage === sg.id);
          const isOver = dragOver === sg.id;
          const isStageOver = stageDragOverIdx === si;
          const isCollapsed = collapsed[sg.id];
          return e('div', {
            key: sg.id,
            onDragOver: ev => { onDragOver(ev, sg.id); onStageDragOver(ev, si); },
            onDrop: ev => { onDrop(ev, sg.id); onStageDrop(ev, si); },
            style: { borderTop: si > 0 ? `2px solid ${isStageOver ? sg.color : 'var(--border)'}` : 'none', background: isOver ? 'oklch(0.18 0.04 256 / .4)' : 'transparent', transition: 'background .15s, border-color .15s' },
          },
            // Stage header
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 4px 4px', background: 'var(--surface)', cursor: 'pointer', userSelect: 'none', minWidth: totalW + 'px' }, onClick: () => toggleCollapse(sg.id) },
              e('span', {
                draggable: true,
                onDragStart: ev => onStageDragStart(ev, si),
                onDragEnd: onStageDragEnd,
                onClick: ev => ev.stopPropagation(),
                style: { fontSize: 12, color: 'var(--text-mute)', width: 16, textAlign: 'center', cursor: 'grab', opacity: 0.5, flexShrink: 0 },
                title: 'Drag to reorder stage',
              }, '⠿'),
              e('span', { style: { fontSize: 10, color: 'var(--text-mute)', width: 16, textAlign: 'center', transition: 'transform .15s', display: 'inline-block', transform: isCollapsed ? 'rotate(-90deg)' : 'none' } }, '▾'),
              e('label', {
                style: { width: 12, height: 12, borderRadius: '50%', background: sg.color, display: 'inline-block', flexShrink: 0, cursor: 'pointer', position: 'relative', overflow: 'hidden' },
                title: 'Change color',
                onClick: ev => ev.stopPropagation(),
              },
                e('input', {
                  type: 'color',
                  value: sg.color.startsWith('#') ? sg.color : '#6366f1',
                  onChange: ev => { ev.stopPropagation(); recolorStage(sg.id, ev.target.value); },
                  onClick: ev => ev.stopPropagation(),
                  style: { position: 'absolute', opacity: 0, width: '100%', height: '100%', top: 0, left: 0, cursor: 'pointer', padding: 0, border: 'none' },
                })),
              e('input', {
                value: sg.label,
                onChange: ev => { ev.stopPropagation(); renameStage(sg.id, ev.target.value); },
                onClick: ev => ev.stopPropagation(),
                style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text)', background: 'transparent', border: 'none', outline: 'none', cursor: 'text', padding: 0, width: Math.max(60, sg.label.length * 7) + 'px' },
              }),
              e('span', { style: { fontSize: 10.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'" } }, items.length),
              e('button', {
                onClick: ev => { ev.stopPropagation(); removeStage(sg.id); },
                style: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-mute)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 4px', opacity: 0.4 },
                title: 'Remove stage',
              }, '×')),

            // Candidate rows
            isCollapsed ? null : e('div', null, items.map(it => candidateRow(it, sg.color)),
              // Drop zone hint when empty
              items.length === 0 ? e('div', { style: { padding: '6px 32px', fontSize: 11, color: 'var(--border)', fontStyle: 'italic' } }, 'Drop here') : null));
        }),

        // Add stage row at bottom
        e('div', { style: { borderTop: '2px solid var(--border)', padding: '5px 8px' } },
          e('button', {
            onClick: addStage,
            style: { fontSize: 11.5, color: 'var(--text-mute)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4 },
          }, '+ Add stage'))));
  },

  _admContracts(d, s) {
    const e = React.createElement;
    const statusColor = { sent: 'var(--info)', overdue: 'var(--down)', signed: 'var(--up)', canceled: 'var(--text-mute)', void: 'var(--down)' };
    const statusBg2 = { sent: 'oklch(0.22 0.05 220 / .25)', overdue: 'oklch(0.22 0.08 0 / .25)', signed: 'oklch(0.22 0.08 152 / .25)', canceled: 'oklch(0.18 0.02 256 / .25)', void: 'oklch(0.22 0.08 0 / .25)' };
    const statusPill = st => e('span', { style: { fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: statusBg2[st] || 'var(--bg-2)', color: statusColor[st] || 'var(--text-mute)', border: '1px solid ' + (statusColor[st] || 'var(--border)') } }, (st || 'sent').charAt(0).toUpperCase() + (st || 'sent').slice(1));
    const cols = [
      { label: 'Party', render: x => e('div', null, e('span', { style: { color: 'var(--text)', fontWeight: 700 } }, x.party), x.email ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'" } }, x.email) : null) },
      { label: 'Type', render: x => e('span', { style: { color: 'var(--text-dim)' } }, x.type || '—') },
      { label: 'Terms', render: x => e('span', { style: { color: 'var(--text-dim)' } }, x.value || '—') },
      { label: 'Sent', render: x => UI.Mono(this.fmtDate(x.sent), { fontSize: 12 }) },
      { label: 'Status', align: 'center', render: x => statusPill(x.status) },
    ];
    const mkSection = (title, contracts, partyType) => {
      const open = s['contractSection_' + partyType] !== false;
      return UI.C({ padding: 0, overflow: 'hidden' },
        e('div', { onClick: () => this.setState(st => ({ ['contractSection_' + partyType]: !open })), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer' } },
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transition: 'transform .2s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none' } }, '›'),
            UI.Hd(title, { fontSize: 15 }),
            e('span', { style: { fontSize: 12, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'" } }, contracts.length + ' contracts')),
          e('div', { onClick: ev => ev.stopPropagation(), style: { display: 'flex', gap: 8 } },
            partyType === 'agent' ? UI.Btn('+ Addendum', () => this.openModal('wizard', { step: 0, partyType: 'addendum' }), 'soft', { padding: '6px 14px', fontSize: 12.5 }) : null,
            UI.Btn('+ New contract', () => this.openModal('wizard', { step: 0, partyType }), 'primary', { padding: '6px 14px', fontSize: 12.5 }))),
        open ? UI.Table(cols, contracts.map(x => ({ ...x, _onClick: () => this.openModal('contractDetail', { contract: x }) })), { min: 680, empty: 'No contracts yet.' }) : null);
    };
    if (s.contractsView === 'templates') {
      // Pre-load all overrides if not already loaded
      if (!window.__ctplOverridesLoaded && !window.__ctplOverridesLoading) {
        window.__ctplOverridesLoading = true;
        fetch(SC_DB + '/rest/v1/contract_templates?select=slug,name,body,updated_at', {
          headers: { apikey: SC_KEY, Authorization: 'Bearer ' + SC_KEY }
        }).then(r => r.json()).then(rows => {
          window.__ctplOverrides = {};
          window.__ctplDbRows = rows || [];
          (rows || []).forEach(r => { window.__ctplOverrides[r.slug] = r.body; });
          window.__ctplOverridesLoaded = true;
          window.__ctplOverridesLoading = false;
          this.setState({ ctplDbRows: rows || [] });
        }).catch(() => {
          window.__ctplOverrides = window.__ctplOverrides || {};
          window.__ctplDbRows = window.__ctplDbRows || [];
          window.__ctplOverridesLoaded = true;
          window.__ctplOverridesLoading = false;
          this.setState({ ctplDbRows: window.__ctplDbRows || [] });
        });
      }
      return this._admContractTemplates(d, s);
    }
    const clientContracts = d.contracts.filter(x => x.party_type !== 'agent');
    const agentContracts = d.contracts.filter(x => x.party_type === 'agent');
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      UI.Hd('Contracts'),
      mkSection('Client contracts', clientContracts, 'client'),
      mkSection('Agent contracts', agentContracts, 'agent'),
      e('div', { style: { marginTop: 8 } },
        UI.Btn('Templates', () => this.setState({ contractsView: 'templates', ctplEditing: null }), 'soft', { fontSize: 12, padding: '5px 14px' })));
  },

  _admContractTemplates(d, s) {
    const e = React.createElement;

    const CLIENT_SLUGS = [
      { slug: 'client-cold-calling', name: 'Cold Calling', vars: ['party', 'contact', 'email', 'vat', 'address', 'rate', 'rateStr', 'duration', 'paymentTerm', 'termDays', 'notes', 'setupFee', 'ctypeLabel', 'duurText', 'aiScopeAddition', 'aiDurationNote', 'aiSpecialConditions'] },
      { slug: 'client-pay-per-appointment', name: 'Pay per Appointment', vars: ['party', 'contact', 'email', 'vat', 'address', 'rate', 'rateStr', 'duration', 'paymentTerm', 'termDays', 'notes', 'setupFee', 'ctypeLabel', 'duurText', 'aiScopeAddition', 'aiDurationNote', 'aiSpecialConditions'] },
      { slug: 'client-commissie', name: 'Commissie', vars: ['party', 'contact', 'email', 'vat', 'address', 'rate', 'rateStr', 'duration', 'paymentTerm', 'termDays', 'notes', 'setupFee', 'ctypeLabel', 'duurText', 'aiScopeAddition', 'aiDurationNote', 'aiSpecialConditions'] },
      { slug: 'client-pilot-leadopvolging', name: 'Pilot — Leadopvolging', vars: ['party', 'contact', 'email', 'vat', 'address', 'pilotMonths', 'paymentTerm', 'pilotPaySel', 'pilotPayVals', 'hasBellijst', 'bellijstPrice', 'bellijstBron', 'validApptDef'] },
      { slug: 'client-pilot-cold-calling', name: 'Pilot — Cold Calling', vars: ['party', 'contact', 'email', 'vat', 'address', 'pilotMonths', 'paymentTerm', 'pilotPaySel', 'pilotPayVals', 'hasBellijst', 'bellijstPrice', 'bellijstBron', 'doelsector', 'doelgroep', 'herkomstLeads', 'qualCriteria'] },
      { slug: 'client-maandelijks', name: 'Maandelijks abonnement', vars: ['party', 'contact', 'email', 'vat', 'address', 'rate', 'rateStr', 'duration', 'paymentTerm', 'termDays', 'notes', 'setupFee', 'ctypeLabel', 'duurText', 'aiScopeAddition', 'aiDurationNote', 'aiSpecialConditions'] },
    ];
    const AGENT_SLUGS = [
      { slug: 'agent-standard', name: 'Standaardcontract (Raamovereenkomst)', vars: ['agentName', 'agentAddress', 'agentVat'] },
      { slug: 'addendum-per-afspraak', name: 'Addendum — Per Afspraak', vars: ['agentName', 'agentAddress', 'agentVat', 'rate', 'rateStr', 'duration', 'paymentTerm', 'termDays', 'notes'] },
      { slug: 'addendum-commissie', name: 'Addendum — Commissie', vars: ['agentName', 'agentAddress', 'agentVat', 'rate', 'commStr', 'duration', 'paymentTerm', 'termDays', 'notes'] },
      { slug: 'addendum-uurtarief', name: 'Addendum — Uurtarief', vars: ['agentName', 'agentAddress', 'agentVat', 'rate', 'rateStr', 'duration', 'paymentTerm', 'termDays', 'notes'] },
      { slug: 'addendum', name: 'Volledig Addendum', vars: ['agentName', 'project', 'endClient', 'mainContractDate', 'startDate', 'services', 'minDials', 'availabilityDays', 'availabilityHours', 'hasNda'] },
    ];
    const ALL_SLUGS = [...CLIENT_SLUGS, ...AGENT_SLUGS];

    // Merge hardcoded slugs with DB-only slugs (custom templates)
    const dbRows = s.ctplDbRows || window.__ctplDbRows || [];
    const hardcodedSet = new Set(ALL_SLUGS.map(x => x.slug));
    const dbOnlyClient = dbRows.filter(r => !hardcodedSet.has(r.slug) && r.slug.startsWith('client-'));
    const dbOnlyAgent = dbRows.filter(r => !hardcodedSet.has(r.slug) && !r.slug.startsWith('client-'));
    const effectiveClientSlugs = [...CLIENT_SLUGS, ...dbOnlyClient.map(r => ({ slug: r.slug, name: r.name || r.slug, vars: [], _dbOnly: true }))];
    const effectiveAgentSlugs = [...AGENT_SLUGS, ...dbOnlyAgent.map(r => ({ slug: r.slug, name: r.name || r.slug, vars: [], _dbOnly: true }))];
    const effectiveAll = [...effectiveClientSlugs, ...effectiveAgentSlugs];

    // Helper: reload DB rows after mutations
    const reloadDbRows = () => {
      window.__ctplOverridesLoaded = false;
      window.__ctplOverridesLoading = false;
      window.__ctplDbRows = [];
      this.setState({ ctplDbRows: [] });
    };

    // Inject contract document CSS once (scoped to .ctpl-doc-editor)
    if (!window.__ctplDocCssInjected) {
      window.__ctplDocCssInjected = true;
      const st = document.createElement('style');
      st.id = 'ctpl-doc-css';
      st.textContent = [
        '.ctpl-doc-editor{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.65;color:#1a1a1a;background:#fff;}',
        '.ctpl-doc-editor .doc-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;padding-bottom:18px;border-bottom:2px solid #1a1a1a;}',
        '.ctpl-doc-editor .doc-header-logo{display:flex;align-items:center;gap:10px;}',
        '.ctpl-doc-editor .doc-header-logo img{width:36px;height:36px;}',
        '.ctpl-doc-editor .doc-header-logo span{font-size:17px;font-weight:700;}',
        '.ctpl-doc-editor .doc-header-meta{font-size:9pt;color:#555;text-align:right;line-height:1.5;}',
        '.ctpl-doc-editor .doc-title{font-size:15pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:center;margin-bottom:4px;}',
        '.ctpl-doc-editor .doc-subtitle{font-size:11pt;color:#444;text-align:center;margin-bottom:28px;}',
        '.ctpl-doc-editor .parties-box{border:1px solid #ccc;border-radius:4px;margin-bottom:28px;overflow:hidden;}',
        '.ctpl-doc-editor .parties-box-title{background:#1a1a1a;color:#fff;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:8px 16px;}',
        '.ctpl-doc-editor .party-row{display:flex;border-top:1px solid #e0e0e0;}',
        '.ctpl-doc-editor .party-row:first-of-type{border-top:none;}',
        '.ctpl-doc-editor .party-num{width:26px;background:#f5f5f5;display:flex;align-items:flex-start;justify-content:center;padding:12px 4px;font-weight:700;font-size:10pt;color:#333;border-right:1px solid #e0e0e0;flex-shrink:0;}',
        '.ctpl-doc-editor .party-info{padding:12px 16px;font-size:10pt;line-height:1.55;flex:1;}',
        '.ctpl-doc-editor .party-label{display:inline-block;background:#1a1a1a;color:#fff;font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:.07em;padding:2px 7px;border-radius:2px;margin-top:4px;}',
        '.ctpl-doc-editor .article{margin-bottom:20px;}',
        '.ctpl-doc-editor .article-title{font-size:10.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.07em;padding-bottom:5px;border-bottom:1.5px solid #1a1a1a;margin-bottom:10px;}',
        '.ctpl-doc-editor .art-num{margin-right:8px;}',
        '.ctpl-doc-editor p{margin-bottom:8px;}',
        '.ctpl-doc-editor ul{margin:6px 0 8px 20px;}',
        '.ctpl-doc-editor ul li{margin-bottom:4px;}',
        '.ctpl-doc-editor .highlight{background:#f7f7f0;border-left:3px solid #b8a000;padding:10px 14px;margin:10px 0;font-size:10.5pt;}',
        '.ctpl-doc-editor .sig-section{margin-top:40px;}',
        '.ctpl-doc-editor .sig-title{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px;color:#555;}',
        '.ctpl-doc-editor .sig-block{display:inline-block;min-width:260px;}',
        '.ctpl-doc-editor .sig-label{font-size:10pt;font-weight:700;margin-bottom:6px;}',
        '.ctpl-doc-editor .sig-sublabel{font-size:9.5pt;color:#555;margin-bottom:50px;}',
        '.ctpl-doc-editor .sig-line{border-top:1px solid #333;padding-top:6px;font-size:9.5pt;color:#444;}',
        '.ctpl-doc-editor .dated{font-size:9.5pt;color:#555;margin-top:20px;}',
        '.ctpl-doc-editor .notes-block{background:#f0f7ff;border-left:3px solid #3a7bd5;padding:10px 14px;margin:10px 0;font-size:10.5pt;white-space:pre-wrap;}',
      ].join('');
      document.head.appendChild(st);
    }

    // WYSIWYG helpers
    const VAR_STYLE = 'background:oklch(0.35 0.18 250/0.15);border:1px solid oklch(0.55 0.18 250/0.4);border-radius:4px;padding:1px 5px;font-size:0.85em;color:#2563eb;user-select:none;cursor:default;white-space:nowrap;';
    const renderBodyToWysiwyg = (body) => body
      .replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, v, c) =>
        `<span class="tpl-if" data-var="${v}">${c}</span>`)
      .replace(/\{\{(\w+)\}\}/g, (_, v) =>
        `<span class="tpl-var" contenteditable="false" data-var="${v}" style="${VAR_STYLE}">[${v}]</span>`);
    const serializeWysiwyg = (html) => html
      .replace(/<span[^>]*class="tpl-var"[^>]*data-var="([^"]+)"[^>]*>[\s\S]*?<\/span>/g, '{{$1}}')
      .replace(/<span[^>]*class="tpl-if"[^>]*data-var="([^"]+)"[^>]*>([\s\S]*?)<\/span>/g, '{{#if $1}}$2{{/if}}');

    if (s.ctplEditing) {
      const tplInfo = effectiveAll.find(x => x.slug === s.ctplEditing);
      const slug = s.ctplEditing;
      const overrides = window.__ctplOverrides || {};
      const hasCustom = !!overrides[slug];

      // Load body from DB if not loaded yet
      if (!s['ctplBody_loaded_' + slug] && !s['ctplBody_loading_' + slug]) {
        this.setState({ ['ctplBody_loading_' + slug]: true });
        const KEY = SC_KEY;
        fetch('https://database.infinite-scale.be/rest/v1/contract_templates?slug=eq.' + slug, {
          headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY }
        }).then(r => r.json()).then(rows => {
          const body = (rows && rows[0] && rows[0].body) ? rows[0].body : (ContractTemplates._defaults[slug] || '');
          this.setState({
            ['ctplBody_' + slug]: body,
            ['ctplBody_loaded_' + slug]: true,
            ['ctplBody_loading_' + slug]: false,
          });
        }).catch(() => {
          this.setState({
            ['ctplBody_' + slug]: ContractTemplates._defaults[slug] || '',
            ['ctplBody_loaded_' + slug]: true,
            ['ctplBody_loading_' + slug]: false,
          });
        });
      }

      const loaded = s['ctplBody_loaded_' + slug];
      const bodyVal = s['ctplBody_' + slug] != null ? s['ctplBody_' + slug] : (ContractTemplates._defaults[slug] || '');
      const saving = s.ctplSaving;
      const saveMsg = s.ctplSaveMsg;

      const doSave = async () => {
        const editorEl = document.getElementById('ctpl-editor');
        const rawHtml = editorEl ? editorEl.innerHTML : '';
        const body = serializeWysiwyg(rawHtml);
        this.setState({ ['ctplBody_' + slug]: body, ctplSaving: true, ctplSaveMsg: null });
        const KEY = SC_KEY;
        try {
          await fetch('https://database.infinite-scale.be/rest/v1/contract_templates', {
            method: 'POST',
            headers: {
              'apikey': KEY,
              'Authorization': 'Bearer ' + KEY,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates',
            },
            body: JSON.stringify({ slug, name: tplInfo ? tplInfo.name : slug, body, updated_at: new Date().toISOString() }),
          });
          window.__ctplOverrides = window.__ctplOverrides || {};
          window.__ctplOverrides[slug] = body;
          this.setState({ ctplSaving: false, ctplSaveMsg: 'Opgeslagen!' });
          setTimeout(() => this.setState({ ctplSaveMsg: null }), 2500);
        } catch(err) {
          this.setState({ ctplSaving: false, ctplSaveMsg: 'Fout: ' + err.message });
        }
      };

      const doReset = async () => {
        if (!confirm('Template "' + (tplInfo ? tplInfo.name : slug) + '" terugzetten naar standaard? Dit verwijdert de aangepaste versie.')) return;
        const KEY = SC_KEY;
        try {
          await fetch('https://database.infinite-scale.be/rest/v1/contract_templates?slug=eq.' + slug, {
            method: 'DELETE',
            headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY },
          });
          if (window.__ctplOverrides) delete window.__ctplOverrides[slug];
          const defBody = ContractTemplates._defaults[slug] || '';
          this.setState({
            ['ctplBody_' + slug]: defBody,
            ['ctplBody_loaded_' + slug]: true,
            ctplSaveMsg: 'Standaard hersteld.',
          });
          setTimeout(() => this.setState({ ctplSaveMsg: null }), 2500);
        } catch(err) {
          alert('Fout: ' + err.message);
        }
      };

      const doPreview = () => {
        const editorEl = document.getElementById('ctpl-editor');
        const rawHtml = editorEl ? editorEl.innerHTML : '';
        const body = serializeWysiwyg(rawHtml);
        const dummyVars = {
          party: 'Voorbeeld BV', contact: 'Jan Janssen', email: 'jan@voorbeeld.be', vat: 'BE0123456789',
          address: 'Voorbeeldstraat 1, 9000 Gent', rate: '75', rateStr: '€ 75,00 excl. btw per effectief doorgegane afspraak',
          duration: 'Onbepaalde duur, opzegbaar met 30 dagen.', paymentTerm: 14, termDays: 14,
          notes: '', setupFee: '', ctypeLabel: 'Dienstverleningsovereenkomst',
          duurText: 'Onbepaalde duur, opzegbaar met 30 dagen schriftelijke opzegging.',
          agentName: 'Marie Peeters', agentAddress: 'Agentstraat 5, 2000 Antwerpen', agentVat: 'BE0987654321',
          commStr: '15% commissie op gefactureerde omzet',
          endClient: 'Klant XYZ', project: 'Klant XYZ', mainContractDate: '01/01/2026',
          startDate: '01/02/2026', services: 'Telefonische prospectie en appointment setting.',
          minDials: '50', availabilityDays: 'Ma–Vr', availabilityHours: '4u',
          pilotMonths: '2', pilotPaySel: { perAfspraak: true }, pilotPayVals: { perAfspraak: '75' },
          hasBellijst: false, bellijstPrice: '', bellijstBron: '',
          validApptDef: 'Een afspraak is factureerbaar wanneer de lead aanwezig was op het afgesproken tijdstip (show-up) en voldeed aan de kwalificatiecriteria.',
          doelsector: 'Thuisbatterijen / zonnepanelen', doelgroep: 'B2B — KMO, Vlaanderen, beslisser',
          herkomstLeads: 'eigen leads (opdrachtgever)', qualCriteria: [{ text: 'Bedrijf actief in doelsector' }, { text: 'Beslisser aan de lijn' }],
        };
        const rendered = ContractTemplates._renderTpl(body, dummyVars);
        const html = ContractTemplates._wrap(rendered, {});
        const w = window.open('', '_blank', 'width=900,height=700');
        if (w) { w.document.write(html); w.document.close(); }
      };

      const tbtnStyle = {
        padding: '5px 12px', fontSize: 13, fontWeight: 700, border: '1px solid var(--border)',
        borderRadius: 5, background: 'var(--bg-2)', color: 'var(--text)', cursor: 'pointer',
      };

      return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, height: '100%' } },
        UI.Row({ justifyContent: 'space-between', alignItems: 'center' },
          UI.Row({ gap: 12, alignItems: 'center' },
            UI.Btn('← Terug', () => this.setState({ ctplEditing: null }), 'soft', { fontSize: 12 }),
            UI.Hd(tplInfo ? tplInfo.name : slug, { fontSize: 17 }),
            e('span', {
              onClick: () => {
                const cur = tplInfo ? tplInfo.name : slug;
                const nieuw = window.prompt('Nieuwe naam:', cur);
                if (!nieuw || nieuw.trim() === cur) return;
                const KEY = SC_KEY;
                fetch('https://database.infinite-scale.be/rest/v1/contract_templates?slug=eq.' + slug, {
                  method: 'PATCH',
                  headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                  body: JSON.stringify({ name: nieuw.trim() }),
                }).then(() => {
                  const updated = (window.__ctplDbRows || []).map(r => r.slug === slug ? { ...r, name: nieuw.trim() } : r);
                  window.__ctplDbRows = updated;
                  this.setState({ ctplDbRows: updated });
                }).catch(err => alert('Fout: ' + err.message));
              },
              style: { fontSize: 11, color: 'var(--text-mute)', cursor: 'pointer', textDecoration: 'underline', marginLeft: 4 },
            }, 'Naam wijzigen'),
            hasCustom ? e('span', { style: { fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: 'oklch(0.28 0.06 194 / .3)', color: 'var(--info)', border: '1px solid var(--info)' } }, 'Aangepast') : null),
          UI.Row({ gap: 8, alignItems: 'center' },
            saveMsg ? e('span', { style: { fontSize: 12.5, color: saveMsg.startsWith('Fout') ? 'var(--down)' : 'var(--up)', fontWeight: 600 } }, saveMsg) : null,
            UI.Btn('Preview', doPreview, 'soft', { fontSize: 12 }),
            e('span', {
              onClick: doReset,
              style: { fontSize: 12, color: 'var(--down)', cursor: 'pointer', textDecoration: 'underline', opacity: 0.7 },
            }, 'Standaard herstellen'),
            UI.Btn(saving ? 'Bezig…' : 'Opslaan', saving ? null : doSave, 'primary', { fontSize: 12, opacity: saving ? 0.6 : 1 }))),
        !loaded
          ? e('div', { style: { color: 'var(--text-mute)', fontSize: 13, padding: 24 } }, 'Laden…')
          : e('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
              // Formatting toolbar
              e('div', { style: { display: 'flex', gap: 6, padding: '8px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '8px 8px 0 0', alignItems: 'center' } },
                e('button', { onMouseDown: ev => { ev.preventDefault(); document.execCommand('bold'); }, style: tbtnStyle }, e('b', null, 'V')),
                e('button', { onMouseDown: ev => { ev.preventDefault(); document.execCommand('italic'); }, style: tbtnStyle }, e('i', null, 'S')),
                e('button', { onMouseDown: ev => { ev.preventDefault(); document.execCommand('underline'); }, style: { ...tbtnStyle } }, e('u', null, 'O')),
                e('div', { style: { width: 1, height: 20, background: 'var(--border)', margin: '0 4px' } }),
                e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, 'Klik op tekst om te bewerken. Variabelen ([naam]) zijn niet aanpasbaar.')),
              // Contenteditable WYSIWYG editor
              e('div', {
                id: 'ctpl-editor',
                key: slug + '_' + (loaded ? 'loaded' : 'loading'),
                contentEditable: true,
                suppressContentEditableWarning: true,
                dangerouslySetInnerHTML: { __html: renderBodyToWysiwyg(bodyVal) },
                className: 'ctpl-doc-editor',
                style: {
                  flex: 1, overflowY: 'auto', padding: '40px 56px', background: '#fff',
                  border: '1px solid var(--border)', borderRadius: '0 0 8px 8px',
                  boxShadow: '0 2px 16px rgba(0,0,0,0.07)', minHeight: 500, outline: 'none',
                },
              })));
    }

    // Template list grid — two sections
    const overrides = window.__ctplOverrides || {};
    const dbSlugsSet = new Set(dbRows.map(r => r.slug));

    const doDeleteTemplate = async (tpl) => {
      if (!dbSlugsSet.has(tpl.slug)) {
        alert('Dit is een standaard template en kan niet verwijderd worden.');
        return;
      }
      if (!confirm('Weet je zeker dat je \'' + tpl.name + '\' wil verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
      const KEY = SC_KEY;
      try {
        await fetch('https://database.infinite-scale.be/rest/v1/contract_templates?slug=eq.' + tpl.slug, {
          method: 'DELETE',
          headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY },
        });
        if (window.__ctplOverrides) delete window.__ctplOverrides[tpl.slug];
        reloadDbRows();
      } catch(err) {
        alert('Fout: ' + err.message);
      }
    };

    const doCreateTemplate = async () => {
      const naam = window.prompt('Template naam:');
      if (!naam || !naam.trim()) return;
      const cat = window.prompt('Categorie (klant/agent):');
      if (!cat) return;
      const isAgent = cat.trim().toLowerCase().startsWith('agent');
      const slug = (isAgent ? 'agent-' : 'client-') + naam.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const body = '<p>Voer hier de inhoud van het template in.</p>';
      const KEY = SC_KEY;
      try {
        const res = await fetch('https://database.infinite-scale.be/rest/v1/contract_templates', {
          method: 'POST',
          headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ slug, name: naam.trim(), body, updated_at: new Date().toISOString() }),
        });
        if (!res.ok) throw new Error(await res.text());
        window.__ctplOverrides = window.__ctplOverrides || {};
        window.__ctplOverrides[slug] = body;
        const newRow = { slug, name: naam.trim(), body, updated_at: new Date().toISOString() };
        const updated = [...(window.__ctplDbRows || []).filter(r => r.slug !== slug), newRow];
        window.__ctplDbRows = updated;
        this.setState({ ctplDbRows: updated, ctplEditing: slug, ['ctplBody_' + slug]: body, ['ctplBody_loaded_' + slug]: true, ['ctplBody_loading_' + slug]: false });
      } catch(err) {
        alert('Fout: ' + err.message);
      }
    };

    const renderSection = (title, slugs) => e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      e('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.06em' } }, title),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 } },
        slugs.map(tpl => {
          const canDelete = dbSlugsSet.has(tpl.slug);
          return UI.C({ padding: '14px 16px', key: tpl.slug },
            UI.Row({ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
              e('div', { style: { flex: 1 } },
                e('div', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 4 } }, tpl.name),
                e('div', { style: { fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-mute)' } }, tpl.slug)),
              overrides[tpl.slug] ? e('span', { style: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'oklch(0.28 0.06 194 / .3)', color: 'var(--info)', border: '1px solid var(--info)', flexShrink: 0 } }, 'Aangepast') : null),
            UI.Row({ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
              UI.Btn('Bewerken', () => this.setState({ ctplEditing: tpl.slug, ['ctplBody_loaded_' + tpl.slug]: false, ['ctplBody_loading_' + tpl.slug]: false }), 'primary', { fontSize: 12, padding: '5px 14px' }),
              canDelete ? e('span', {
                onClick: () => doDeleteTemplate(tpl),
                style: { fontSize: 11, color: 'var(--down)', cursor: 'pointer', textDecoration: 'underline' },
              }, 'Verwijderen') : null));
        })));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 24 } },
      UI.Row({ justifyContent: 'space-between', alignItems: 'center' },
        UI.Row({ gap: 12, alignItems: 'center' },
          UI.Btn('← Contracts', () => this.setState({ contractsView: null }), 'soft', { fontSize: 12 }),
          UI.Hd('Contract Templates', { fontSize: 17 })),
        UI.Btn('+ Nieuw template', doCreateTemplate, 'primary', { fontSize: 12, padding: '5px 14px' })),
      renderSection('Klantcontracten', effectiveClientSlugs),
      renderSection('Agentcontracten', effectiveAgentSlugs));
  },

  _admRooster(d, s) {
    const e = React.createElement;
    const HOUR_START = 7, HOUR_END = 20; // 07:00–20:00 range
    const HOURS  = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
    const DAYS   = [0,1,2,3,4,5,6];
    const DAY_S  = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
    const DAY_FULL = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];
    const COLORS = ['#0891b2','#7c3aed','#059669','#d97706','#dc2626','#db2777','#2563eb','#0e7490','#b45309','#0f766e'];

    const today     = this.iso(this.today());
    const weekStart = s.rosterWeek || this._weekStart(today);
    const view      = s.rosterView || 'week';

    const weekDates = DAYS.map(i => {
      const dt = new Date(weekStart + 'T12:00:00');
      dt.setDate(dt.getDate() + i);
      return dt.toISOString().slice(0, 10);
    });

    const navWeek = delta => {
      const dt = new Date(weekStart + 'T12:00:00');
      dt.setDate(dt.getDate() + delta * 7);
      this.setState({ rosterWeek: dt.toISOString().slice(0, 10) });
    };

    const ws = new Date(weekStart + 'T12:00:00');
    const we = new Date(weekStart + 'T12:00:00');
    we.setDate(we.getDate() + 6);
    const weekLabel = ws.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) + ' – ' + we.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });

    const activeAgents = (d.agents || []).filter(a => a.active !== false);

    const getAgentSlots = agId => {
      const sc = (d.schedules || []).find(sc2 => sc2.agent_id === agId && sc2.week_start === weekStart);
      return sc ? (sc.slots || []).filter(sl => sl.clientId !== '__off__') : [];
    };

    const getAgentClients = agent => (d.clients || []).filter(c => (agent.clients || []).includes(c.id));

    const getColor = (cid, clients) => {
      const i = clients.findIndex(c => c.id === cid);
      return i >= 0 ? COLORS[i % COLORS.length] : '#888';
    };

    // Compute time range string for a set of slots: "09:00 – 17:00"
    const timeRange = daySlots => {
      if (!daySlots.length) return null;
      const hours = daySlots.map(sl => sl.hour).filter(h => typeof h === 'number');
      if (!hours.length) return null;
      const mn = Math.min(...hours);
      const mx = Math.max(...hours);
      return mn + ':00 – ' + (mx + 1) + ':00';
    };

    const openDayDetail = (agent, dayIdx) => {
      this.openModal('rosterDayDetail', { agentId: agent.id, dayIdx, weekDates, weekStart });
    };

    // Render a timeline bar for one agent×day
    const dayCell = (agent, dayIdx) => {
      const allSlots = getAgentSlots(agent.id);
      const agCl     = getAgentClients(agent);
      const daySlots = allSlots.filter(sl => sl.day === dayIdx && typeof sl.hour === 'number');
      const isToday  = weekDates[dayIdx] === today;
      const range    = HOUR_END - HOUR_START; // 13 slots wide

      const baseBg = isToday ? 'oklch(0.18 0.04 256 / .5)' : 'var(--bg-2)';
      const baseBorder = isToday ? '1px solid oklch(0.38 0.09 194 / .5)' : '1px solid var(--border-soft)';

      if (!daySlots.length) {
        return e('div', { key: dayIdx, style: { borderRadius: 10, background: baseBg, border: baseBorder, padding: '10px 12px', minHeight: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default', opacity: 0.5 } },
          e('span', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 500 } }, '—'));
      }

      const hours = daySlots.map(sl => sl.hour);
      const minH = Math.min(...hours);
      const maxH = Math.max(...hours) + 1;
      const totalH = maxH - minH;

      // Build contiguous color segments
      const segments = [];
      let segStart = minH, segClient = daySlots.find(sl => sl.hour === minH)?.clientId;
      for (let h = minH + 1; h <= maxH; h++) {
        const sl = daySlots.find(s => s.hour === h);
        const cid = sl ? sl.clientId : null;
        if (cid !== segClient || h === maxH) {
          if (segStart < h) segments.push({ start: segStart, end: h, clientId: segClient });
          segStart = h; segClient = cid;
        }
      }

      // Position bar: left% and width% relative to full range
      const leftPct  = ((minH - HOUR_START) / range) * 100;
      const widthPct = ((maxH - minH) / range) * 100;

      // Unique clients in this day
      const dayCids = [...new Set(daySlots.map(sl => sl.clientId))];

      return e('div', { key: dayIdx, onClick: () => openDayDetail(agent, dayIdx), style: { borderRadius: 10, background: baseBg, border: baseBorder, padding: '10px 12px', minHeight: 72, display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', transition: 'border-color .15s' } },
        // Time label
        e('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.01em' } },
          minH + ':00 – ' + maxH + ':00',
          e('span', { style: { fontSize: 10.5, fontWeight: 500, color: 'var(--text-mute)', marginLeft: 6 } }, totalH + 'u')),
        // Timeline bar with position + color segments
        e('div', { style: { position: 'relative', height: 14, borderRadius: 4, background: 'var(--border-soft)' } },
          e('div', { style: { position: 'absolute', left: leftPct + '%', width: widthPct + '%', height: '100%', borderRadius: 4, overflow: 'hidden', display: 'flex' } },
            segments.length === 1
              ? e('div', { style: { flex: 1, background: getColor(segments[0].clientId, agCl) } })
              : segments.map((seg, si) =>
                  e('div', { key: si, style: { flex: seg.end - seg.start, background: seg.clientId ? getColor(seg.clientId, agCl) : 'var(--border)' } })))),
        // Hour tick marks below bar
        e('div', { style: { display: 'flex', position: 'relative', height: 8 } },
          [HOUR_START, 9, 11, 13, 15, 17, 19, HOUR_END].map(h =>
            e('div', { key: h, style: { position: 'absolute', left: ((h - HOUR_START) / range * 100) + '%', fontSize: 8.5, color: 'var(--text-mute)', transform: 'translateX(-50%)' } }, h))),
        // Client tags
        dayCids.length > 0 ? e('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          dayCids.map(cid => {
            const cl = agCl.find(c => c.id === cid);
            const col = getColor(cid, agCl);
            return e('span', { key: cid, style: { fontSize: 10, background: col + '22', color: col, borderRadius: 4, padding: '1px 6px', fontWeight: 700, border: '1px solid ' + col + '44' } },
              cl ? cl.name.slice(0, 14) : '?');
          })) : null);
    };

    // Per-agent week summary (total hours + days active)
    const agentSummary = agent => {
      const slots    = getAgentSlots(agent.id);
      const agCl     = getAgentClients(agent);
      const totalH   = slots.length;
      const daysOn   = new Set(slots.map(sl => sl.day)).size;
      const cids     = [...new Set(slots.map(sl => sl.clientId))];
      return e('div', { style: { minWidth: 160, paddingRight: 12 } },
        e('div', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 2 } }, agent.name),
        e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginBottom: 6 } },
          totalH ? daysOn + (daysOn === 1 ? ' dag' : ' dagen') + ' · ' + totalH + 'u/week' : 'Geen rooster'),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          cids.slice(0, 4).map(cid => {
            const cl  = agCl.find(c => c.id === cid);
            const col = getColor(cid, agCl);
            const hrs = slots.filter(sl => sl.clientId === cid).length;
            return e('div', { key: cid, style: { display: 'flex', alignItems: 'center', gap: 5 } },
              e('div', { style: { width: 8, height: 8, borderRadius: 2, background: col, flexShrink: 0 } }),
              e('span', { style: { fontSize: 10.5, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, cl ? cl.name : '?'),
              e('span', { style: { fontSize: 10, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", flexShrink: 0 } }, hrs + 'u'));
          })));
    };

    const btnSt = { border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 14, background: 'var(--surface-2)', color: 'var(--text)', padding: '6px 12px' };
    const tabBtn = (label, active) => ({ padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: active ? 'var(--bg)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-mute)', boxShadow: active ? '0 1px 3px rgba(0,0,0,.2)' : 'none' });

    const navBar = e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        e('button', { onClick: () => navWeek(-1), style: btnSt }, '‹'),
        e('span', { style: { fontSize: 14, fontWeight: 600, minWidth: 200, textAlign: 'center', color: 'var(--text)' } }, weekLabel),
        e('button', { onClick: () => navWeek(1), style: btnSt }, '›'),
        e('button', { onClick: () => this.setState({ rosterWeek: this._weekStart(today) }), style: { ...btnSt, fontSize: 12, padding: '6px 11px', color: 'var(--text-mute)' } }, 'Vandaag')),
      e('div', { style: { display: 'flex', gap: 2, background: 'var(--surface-2)', padding: 3, borderRadius: 9 } },
        e('button', { onClick: () => this.setState({ rosterView: 'week' }), style: tabBtn('Week', view === 'week') }, 'Week'),
        e('button', { onClick: () => this.setState({ rosterView: 'month' }), style: tabBtn('Maand', view === 'month') }, 'Maand')));

    // ── Month view ──────────────────────────────────────────────
    if (view === 'month') {
      const dt2  = new Date(weekStart + 'T12:00:00');
      const year = dt2.getFullYear(), month = dt2.getMonth();
      const first = new Date(year, month, 1);
      const last  = new Date(year, month + 1, 0);
      const offset = (first.getDay() + 6) % 7;
      const cells = [...Array(offset).fill(null), ...Array.from({ length: last.getDate() }, (_, i) => i + 1)];
      while (cells.length % 7) cells.push(null);

      const monthGrid = e('div', null,
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 } },
          ...DAY_S.map(l => e('div', { key: l, style: { textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', padding: '6px 0' } }, l))),
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 } },
          ...cells.map((dayNum, i) => {
            if (!dayNum) return e('div', { key: 'x' + i });
            const ds  = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const isT = ds === today;
            const dow = (new Date(ds + 'T12:00:00').getDay() + 6) % 7;
            const wSt = this._weekStart(ds);
            const working = activeAgents.map(agent => {
              const sc = (d.schedules || []).find(sc2 => sc2.agent_id === agent.id && sc2.week_start === wSt);
              const daySlots = sc ? (sc.slots || []).filter(sl => sl.day === dow && typeof sl.hour === 'number') : [];
              if (!daySlots.length) return null;
              const agCl = getAgentClients(agent);
              const hrs = daySlots.map(sl => sl.hour);
              const cid = daySlots[0]?.clientId;
              return { agent, color: getColor(cid, agCl), minH: Math.min(...hrs), maxH: Math.max(...hrs) + 1, count: daySlots.length };
            }).filter(Boolean);
            return e('div', { key: dayNum, onClick: () => this.setState({ rosterView: 'week', rosterWeek: this._weekStart(ds) }),
              style: { minHeight: 100, borderRadius: 10, padding: '7px 9px', cursor: 'pointer', border: '1px solid ' + (isT ? 'var(--accent)' : 'var(--border-soft)'), background: isT ? 'oklch(0.20 0.08 194 / .20)' : 'var(--surface)', transition: 'background .1s' } },
              e('div', { style: { fontSize: 13, fontWeight: 700, color: isT ? 'var(--accent)' : 'var(--text)', marginBottom: 5 } }, dayNum),
              ...working.slice(0, 5).map(({ agent, color, minH, maxH }) =>
                e('div', { key: agent.id, style: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 } },
                  e('div', { style: { width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 } }),
                  e('span', { style: { fontSize: 9.5, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 } }, agent.name.split(' ')[0]),
                  e('span', { style: { fontSize: 8.5, color: 'var(--text-mute)', flexShrink: 0, fontFamily: "'JetBrains Mono'" } }, minH + '–' + maxH))),
              working.length > 5 ? e('div', { style: { fontSize: 9, color: 'var(--text-mute)', marginTop: 2 } }, '+' + (working.length - 5) + ' meer') : null);
          })));

      const monthLabel2 = new Date(year, month, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
      const monthNavBar = e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          e('button', { onClick: () => { const d2 = new Date(year, month - 1, 1); this.setState({ rosterWeek: this._weekStart(d2.toISOString().slice(0, 10)) }); }, style: btnSt }, '‹'),
          e('span', { style: { fontSize: 14, fontWeight: 600, minWidth: 180, textAlign: 'center', color: 'var(--text)' } }, monthLabel2),
          e('button', { onClick: () => { const d2 = new Date(year, month + 1, 1); this.setState({ rosterWeek: this._weekStart(d2.toISOString().slice(0, 10)) }); }, style: btnSt }, '›')),
        e('div', { style: { display: 'flex', gap: 2, background: 'var(--surface-2)', padding: 3, borderRadius: 9 } },
          e('button', { onClick: () => this.setState({ rosterView: 'week' }), style: tabBtn('Week', false) }, 'Week'),
          e('button', { onClick: () => this.setState({ rosterView: 'month' }), style: tabBtn('Maand', true) }, 'Maand')));

      return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        UI.Hd('Roosters Call Agents'),
        monthNavBar,
        UI.C({ padding: 16 }, monthGrid));
    }

    // ── Week view ────────────────────────────────────────────────
    // Day column headers
    const dayHeaders = e('div', { style: { display: 'grid', gridTemplateColumns: '172px repeat(7, 1fr)', gap: 8, marginBottom: 8 } },
      e('div'),
      ...DAYS.map((_, i) => {
        const isT = weekDates[i] === today;
        const dt  = new Date(weekDates[i] + 'T12:00:00');
        return e('div', { key: i, style: { textAlign: 'center', padding: '6px 8px', borderRadius: 8, background: isT ? 'oklch(0.20 0.08 194 / .25)' : 'transparent', border: isT ? '1px solid oklch(0.38 0.09 194 / .4)' : '1px solid transparent' } },
          e('div', { style: { fontSize: 13, fontWeight: 700, color: isT ? 'var(--accent)' : 'var(--text)' } }, DAY_S[i]),
          e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 1 } }, dt.getDate() + ' ' + dt.toLocaleDateString('nl-BE', { month: 'short' })));
      }));

    // Agent rows with timeline cells
    const agentRows = activeAgents.map((agent, ai) =>
      e('div', { key: agent.id, style: { display: 'grid', gridTemplateColumns: '172px repeat(7, 1fr)', gap: 8, alignItems: 'start', paddingTop: ai === 0 ? 0 : 12, borderTop: ai === 0 ? 'none' : '1px solid var(--border-soft)' } },
        agentSummary(agent),
        ...DAYS.map(di => dayCell(agent, di))));

    // Hour scale ruler at top of week view
    const hourRuler = e('div', { style: { display: 'grid', gridTemplateColumns: '172px 1fr', gap: 8, marginBottom: 4, opacity: 0.6 } },
      e('div'),
      e('div', { style: { position: 'relative', height: 16 } },
        [7, 9, 11, 13, 15, 17, 19, 20].map(h =>
          e('div', { key: h, style: { position: 'absolute', left: ((h - HOUR_START) / (HOUR_END - HOUR_START) * 100) + '%', fontSize: 9.5, color: 'var(--text-mute)', transform: 'translateX(-50%)' } }, h + ':00'))));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      UI.Hd('Roosters Call Agents'),
      navBar,
      UI.C({ padding: 20 },
        e('div', { style: { overflowX: 'auto' } },
          e('div', { style: { minWidth: 820 } },
            dayHeaders,
            hourRuler,
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
              ...agentRows)))));
  },

  _admActivity(d, s) {
    const e = React.createElement;
    const roleFilter = s.activityRoleFilter || 'all';
    const timeFilter = s.activityTimeFilter || 'today';
    const searchQ = (s.activitySearch || '').toLowerCase();

    const roleColor = { agent: 'var(--accent)', client: '#60a5fa', admin: '#c084fc', agency: '#fb923c' };

    // Online threshold: last seen within 2 minutes
    const onlineThresholdMs = 2 * 60 * 1000;
    const nowMs = Date.now();
    const onlineUsers = (d.presence || []).filter(p => {
      if (!p.last_seen) return false;
      return nowMs - new Date(p.last_seen).getTime() < onlineThresholdMs;
    });
    const recentUsers = (d.presence || []).filter(p => {
      if (!p.last_seen) return false;
      const diffMs = nowMs - new Date(p.last_seen).getTime();
      return diffMs >= onlineThresholdMs && diffMs < 30 * 60 * 1000;
    });

    const routeLabels = { dashboard: 'Dashboard', log: 'Appointment Log', appointments: 'Appointments', eod: 'End of Day', payments: 'Payments', clients: 'Clients', agents: 'Call Agents', rooster: 'Rooster', stats: 'Statistics', settings: 'Settings', contracts: 'Contracts', finances: 'Finances', eodadmin: 'EOD Reports', timeline: 'Timeline', prospects: 'Prospect CRM', recruitment: 'Recruitment', apptadmin: 'Appointments', activity: 'Activity', legal: 'Legal', billing: 'Billing', support: 'Support' };

    const presenceCard = (p, isOnline) => {
      const color = roleColor[p.user_role] || 'var(--text-mute)';
      const label = routeLabels[p.route] || p.route || '—';
      const diffMin = Math.floor((nowMs - new Date(p.last_seen).getTime()) / 60000);
      const timeStr = isOnline ? 'now' : (diffMin < 60 ? diffMin + 'm ago' : Math.floor(diffMin / 60) + 'h ago');
      return e('div', { key: p.user_id, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border-soft)' } },
        e('div', { style: { width: 9, height: 9, borderRadius: '50%', background: isOnline ? 'var(--up)' : 'var(--text-mute)', flexShrink: 0, boxShadow: isOnline ? '0 0 0 3px rgba(var(--up-rgb,34,197,94),.25)' : 'none' } }),
        e('div', { style: { flex: 1, minWidth: 0 } },
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
            e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.user_name || '—'),
            e('span', { style: { fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: color + '22', color, flexShrink: 0 } }, p.user_role)),
          e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', marginTop: 1 } }, label)),
        e('div', { style: { fontSize: 11, color: isOnline ? 'var(--up)' : 'var(--text-mute)', fontWeight: 600, flexShrink: 0 } }, timeStr));
    };

    const presenceSection = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        e('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--text)' } }, 'Live aanwezigheid'),
        e('span', { style: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8, background: onlineUsers.length > 0 ? 'rgba(34,197,94,.15)' : 'var(--surface-2)', color: onlineUsers.length > 0 ? 'var(--up)' : 'var(--text-mute)' } }, onlineUsers.length + ' online')),
      onlineUsers.length === 0 && recentUsers.length === 0
        ? e('div', { style: { fontSize: 12.5, color: 'var(--text-mute)', padding: '12px 0' } }, 'Niemand is momenteel actief.')
        : e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            onlineUsers.map(p => presenceCard(p, true)),
            recentUsers.length > 0 && e('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', margin: '4px 0 2px', textTransform: 'uppercase', letterSpacing: '.08em' } }, 'Recent actief'),
            recentUsers.map(p => presenceCard(p, false))));
    const actionIcon = {
      login: '→', navigate: '◈', appointment_logged: '✓', appointment_updated: '↻',
      eod_submitted: '📋', dials_updated: '☎', contract_sent: '📄', contract_updated: '✎',
      ticket_submitted: '🎫', rooster_saved: '📅', default: '·'
    };
    const actionLabel = {
      login: 'Login', navigate: 'Navigation', appointment_logged: 'Appointment', appointment_updated: 'Appt update',
      eod_submitted: 'EOD Report', dials_updated: 'Dials', contract_sent: 'Contract sent', contract_updated: 'Contract update',
      ticket_submitted: 'Support ticket', rooster_saved: 'Schedule saved',
    };

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now - 7 * 86400000).toISOString();
    const monthAgo = new Date(now - 30 * 86400000).toISOString();

    const timeLabel = { login: 'Logged in', navigate: 'Navigated', appointment_logged: 'Logged appointment', appointment_updated: 'Updated appointment', eod_submitted: 'Submitted EOD', dials_updated: 'Updated dials', contract_sent: 'Sent contract', contract_updated: 'Updated contract', ticket_submitted: 'Submitted ticket', rooster_saved: 'Saved schedule' };

    const fmtTime = (iso) => {
      if (!iso) return '';
      const d2 = new Date(iso);
      const diffMs = now - d2;
      const diffMin = Math.floor(diffMs / 60000);
      const diffH = Math.floor(diffMs / 3600000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return diffMin + 'm ago';
      if (diffH < 24) return diffH + 'h ago';
      return d2.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) + ' ' + d2.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
    };

    const allLogs = (d.activityLog || []);
    const clickLogs = allLogs.filter(l => l.action === 'click');
    let logs = allLogs.filter(l => l.action !== 'click');
    if (roleFilter !== 'all') logs = logs.filter(l => l.user_role === roleFilter);
    if (timeFilter === 'today') logs = logs.filter(l => (l.created_at || '').startsWith(todayStr));
    else if (timeFilter === 'week') logs = logs.filter(l => l.created_at >= weekAgo);
    else if (timeFilter === 'month') logs = logs.filter(l => l.created_at >= monthAgo);
    if (searchQ) logs = logs.filter(l => (l.user_name || '').toLowerCase().includes(searchQ) || (l.details || '').toLowerCase().includes(searchQ) || (l.action || '').includes(searchQ));

    const getClickTrail = (log) => {
      if (log.session_id) return clickLogs.filter(c => c.session_id === log.session_id && c.created_at >= log.created_at).slice(0, 30);
      // fallback: same user within 30 min after event
      const t0 = new Date(log.created_at).getTime();
      return clickLogs.filter(c => c.user_id === log.user_id && new Date(c.created_at).getTime() >= t0 && new Date(c.created_at).getTime() < t0 + 30 * 60000).slice(0, 30);
    };
    const expandedKey = s.activityExpanded || null;

    const segBtn = (label, val, stateKey, current) => e('button', {
      onClick: () => this.setState({ [stateKey]: val }),
      style: { padding: '5px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, transition: 'all .12s', background: current === val ? 'var(--surface)' : 'transparent', color: current === val ? 'var(--text)' : 'var(--text-mute)', boxShadow: current === val ? '0 1px 3px rgba(0,0,0,.2)' : 'none' }
    }, label);

    const groupedByDay = {};
    logs.forEach(l => {
      const day = (l.created_at || '').slice(0, 10) || 'unknown';
      if (!groupedByDay[day]) groupedByDay[day] = [];
      groupedByDay[day].push(l);
    });
    const days = Object.keys(groupedByDay).sort().reverse();

    const dayLabel = (d3) => {
      if (d3 === todayStr) return 'Today';
      const y = new Date(now - 86400000).toISOString().slice(0, 10);
      if (d3 === y) return 'Yesterday';
      return new Date(d3 + 'T12:00:00').toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    };

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
      // Presence panel
      presenceSection,
      e('div', { style: { borderTop: '1px solid var(--border-soft)', margin: '0 0 4px' } }),
      // Header
      e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 } },
        e('div', null,
          UI.Hd('Activity Feed'),
          UI.Sub((logs.length) + ' events' + (roleFilter !== 'all' || timeFilter !== 'all' ? ' (filtered)' : ''), { marginTop: 3 })),
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          e('input', { placeholder: 'Search user or action…', value: s.activitySearch || '', onInput: ev => this.setState({ activitySearch: ev.target.value }), style: { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-soft)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, width: 200, outline: 'none' } }),
          e('div', { style: { display: 'flex', gap: 2, background: 'var(--surface-2)', padding: 3, borderRadius: 9 } },
            segBtn('Today', 'today', 'activityTimeFilter', timeFilter),
            segBtn('Week', 'week', 'activityTimeFilter', timeFilter),
            segBtn('Month', 'month', 'activityTimeFilter', timeFilter),
            segBtn('All', 'all', 'activityTimeFilter', timeFilter)))),
      // Role filter
      e('div', { style: { display: 'flex', gap: 6 } },
        ['all', 'agent', 'client', 'admin'].map(r => e('button', {
          key: r, onClick: () => this.setState({ activityRoleFilter: r }),
          style: { padding: '5px 14px', borderRadius: 20, border: '1px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .12s', borderColor: roleFilter === r ? (roleColor[r] || 'var(--accent)') : 'var(--border-soft)', background: roleFilter === r ? (roleColor[r] || 'var(--accent)') + '22' : 'transparent', color: roleFilter === r ? (roleColor[r] || 'var(--accent)') : 'var(--text-mute)' }
        }, r === 'all' ? 'All users' : r.charAt(0).toUpperCase() + r.slice(1) + 's'))),
      // Timeline
      logs.length === 0
        ? UI.C({}, e('div', { style: { textAlign: 'center', padding: '40px 20px', color: 'var(--text-mute)', fontSize: 14 } }, 'No activity found for these filters.'))
        : e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          days.map(day => e('div', { key: day },
            e('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text-mute)', padding: '2px 0 10px', borderBottom: '1px solid var(--border-soft)', marginBottom: 2 } }, dayLabel(day)),
            e('div', { style: { display: 'flex', flexDirection: 'column' } },
              groupedByDay[day].map((log, i) => {
                const color = roleColor[log.user_role] || 'var(--text-mute)';
                const label = timeLabel[log.action] || log.action || '—';
                const rowKey = log.id || i;
                const isExpanded = expandedKey === rowKey;
                const trail = getClickTrail(log);
                const hasTrail = trail.length > 0;
                return e('div', { key: rowKey, style: { borderBottom: i < groupedByDay[day].length - 1 ? '1px solid var(--border-soft)' : 'none' } },
                  // Main row
                  e('div', {
                    onClick: hasTrail ? () => this.setState({ activityExpanded: isExpanded ? null : rowKey }) : undefined,
                    style: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '9px 0', cursor: hasTrail ? 'pointer' : 'default', borderRadius: 6, transition: 'background .1s' }
                  },
                    e('div', { style: { width: 72, flexShrink: 0, fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", paddingTop: 2, textAlign: 'right' } }, fmtTime(log.created_at)),
                    e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, flexShrink: 0 } },
                      e('div', { style: { width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 } })),
                    e('div', { style: { flex: 1, minWidth: 0 } },
                      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
                        e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--text)' } }, log.user_name || '—'),
                        e('span', { style: { fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: color + '22', color } }, log.user_role || ''),
                        hasTrail ? e('span', { style: { fontSize: 10, color: 'var(--text-mute)', marginLeft: 4 } }, (isExpanded ? '▾ ' : '▸ ') + trail.length + ' clicks') : null),
                      e('div', { style: { fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, marginBottom: log.details ? 2 : 0 } }, label),
                      log.details ? e('div', { style: { fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.4, wordBreak: 'break-word' } }, log.details) : null)),
                  // Click trail expansion
                  isExpanded && hasTrail ? e('div', { style: { marginLeft: 96, marginBottom: 10, background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border-soft)', overflow: 'hidden' } },
                    e('div', { style: { padding: '8px 14px', borderBottom: '1px solid var(--border-soft)', fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.08em' } }, 'Click trail — ' + trail.length + ' actions'),
                    trail.map((c, ci) => {
                      const extra = c.extra || {};
                      const routeLabel = extra.route ? ({ dashboard: 'Dashboard', appointments: 'Appointments', billing: 'Billing', contracts: 'Contracts', support: 'Support', legal: 'Legal', log: 'Appointment Log', eod: 'End of Day', payments: 'Payments', rooster: 'Rooster' }[extra.route] || extra.route) : null;
                      return e('div', { key: ci, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: ci < trail.length - 1 ? '1px solid var(--border-soft)' : 'none' } },
                        e('span', { style: { fontFamily: "'JetBrains Mono'", fontSize: 10, color: 'var(--text-mute)', flexShrink: 0, width: 50 } }, fmtTime(c.created_at)),
                        routeLabel ? e('span', { style: { fontSize: 10, background: 'var(--surface-2)', color: 'var(--accent)', borderRadius: 5, padding: '1px 6px', fontWeight: 700, flexShrink: 0 } }, routeLabel) : null,
                        e('span', { style: { fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.details || '—'));
                    })) : null);
              }))))));
  },

  // ─── To-Do board ──────────────────────────────────────────────────────────
  _admTodos(d, s) {
    const e = React.createElement;
    const SB_KEY = SC_KEY;
    const SB_URL = SC_DB;

    const USERS = [
      { id: 'quinten', label: 'Quinten' },
      { id: 'senne.db', label: 'Senne' },
    ];

    const today = new Date().toISOString().slice(0, 10);
    const day = s.todosDay || today;

    const session = typeof SB !== 'undefined' ? SB.getSession() : null;
    const myEmail = session?.user?.email || 'quinten@infinite-scale.be';
    const myId = myEmail.split('@')[0];

    const todos = s._todosLoaded ? (s.todosList || []) : null;

    const loadDay = async (targetDay) => {
      this.setState({ todosLoading: true, todosList: null, _todosLoaded: false });
      const res = await fetch(`${SB_URL}/rest/v1/todos?day=eq.${targetDay}&order=order_idx.asc,created_at.asc`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
      });
      let list = await res.json();
      if (targetDay >= today) {
        const prevDay = new Date(targetDay);
        prevDay.setDate(prevDay.getDate() - 1);
        const prevStr = prevDay.toISOString().slice(0, 10);
        const prevRes = await fetch(`${SB_URL}/rest/v1/todos?day=eq.${prevStr}&completed_at=is.null&order=order_idx.asc,created_at.asc`, {
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
        });
        const prevUndone = await prevRes.json();
        // Prune already-carried tasks whose source is now done (edge case: user navigated to tomorrow before marking done)
        const staleCarried = list.filter(t => t.carried_from === prevStr && !t.completed_at && !prevUndone.some(pt => pt.title === t.title && pt.created_by === t.created_by));
        for (const sc of staleCarried) {
          await fetch(`${SB_URL}/rest/v1/todos?id=eq.${sc.id}`, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
          list = list.filter(t => t.id !== sc.id);
        }
        // Assign carry indices per user, preserving source order
        const carryIdxByUser = {};
        const getCarryIdx = (userId) => {
          if (carryIdxByUser[userId] === undefined) {
            carryIdxByUser[userId] = list.filter(t => t.created_by === userId && !t.carried_from && !t.completed_at).reduce((m, t) => Math.max(m, t.order_idx || 0), -1);
          }
          carryIdxByUser[userId] += 1;
          return carryIdxByUser[userId];
        };
        for (const pt of prevUndone) {
          const existing = list.find(t => t.carried_from === prevStr && t.title === pt.title && t.created_by === pt.created_by);
          const targetIdx = getCarryIdx(pt.created_by);
          if (!existing) {
            const upsertRes = await fetch(`${SB_URL}/rest/v1/todos`, {
              method: 'POST',
              headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify({ title: pt.title, category: pt.category || null, deadline: pt.deadline || null, notes: pt.notes || null, created_by: pt.created_by, day: targetDay, order_idx: targetIdx, carried_from: prevStr })
            });
            const newRow = await upsertRes.json();
            if (Array.isArray(newRow) && newRow[0]) list.push(newRow[0]);
          }
          // Never re-sync order_idx for already-existing carried items — user's manual drag-reorder must be preserved
        }
        list.sort((a, b) => (a.order_idx || 0) - (b.order_idx || 0) || a.created_at.localeCompare(b.created_at));
      }
      this.setState({ todosList: list, todosLoading: false, _todosLoaded: true });
    };

    if (!s._todosLoaded && !s.todosLoading) loadDay(day);

    const navDay = delta => {
      const d2 = new Date(day); d2.setDate(d2.getDate() + delta);
      this.setState({ todosDay: d2.toISOString().slice(0, 10), todosList: null, todosLoading: false, _todosLoaded: false });
    };

    const fmtDay = ds => {
      const d2 = new Date(ds + 'T00:00:00');
      const lbl = d2.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      return ds === today ? lbl + ' — today' : lbl;
    };

    const CAT_COLORS = ['var(--accent)', 'var(--up)', 'var(--info)', 'var(--warn)', '#a78bfa', '#f472b6', '#fb923c', '#34d399'];
    const allCats = [...new Set((todos || []).map(t => t.category).filter(Boolean))];
    const catColor = cat => CAT_COLORS[allCats.indexOf(cat) % CAT_COLORS.length] || 'var(--text-mute)';

    const catPill = cat => cat ? e('span', { style: { fontSize: 10.5, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: catColor(cat) + '22', color: catColor(cat), flexShrink: 0 } }, cat) : null;
    const deadlinePill = dl => {
      if (!dl) return null;
      const overdue = dl < today;
      const soonDate = new Date(today); soonDate.setDate(soonDate.getDate() + 3);
      const soon = !overdue && dl <= soonDate.toISOString().slice(0, 10);
      const color = overdue ? 'var(--down)' : soon ? 'var(--warn)' : 'var(--text-mute)';
      return e('span', { style: { fontSize: 10.5, fontWeight: 600, color, flexShrink: 0, fontFamily: "\'JetBrains Mono\'" } }, '\u23F0 ' + dl);
    };
    const carriedBadge = from => from ? e('span', { style: { fontSize: 10, fontWeight: 600, color: 'var(--info)', background: 'var(--info)11', borderRadius: 6, padding: '1px 6px', flexShrink: 0 } }, '\u21A9 ' + from) : null;

    const checkTodo = async todo => {
      const now = todo.completed_at ? null : new Date().toISOString();
      const by = todo.completed_at ? null : myId;
      await fetch(`${SB_URL}/rest/v1/todos?id=eq.${todo.id}`, {
        method: 'PATCH',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ completed_at: now, completed_by: by })
      });
      this.setState(st => ({ todosList: (st.todosList || []).map(t => t.id === todo.id ? { ...t, completed_at: now, completed_by: by } : t) }));
    };

    const deleteTodo = async id => {
      await fetch(`${SB_URL}/rest/v1/todos?id=eq.${id}`, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
      this.setState(st => ({ todosList: (st.todosList || []).filter(t => t.id !== id) }));
    };

    const addTodoFor = async ownerId => {
      const tk = 'todosAddTitle_' + ownerId, ck = 'todosAddCat_' + ownerId, dk = 'todosAddDl_' + ownerId, nk = 'todosAddNotes_' + ownerId;
      const title = (s[tk] || '').trim(); if (!title) return;
      const userActive = (todos || []).filter(t => t.created_by === ownerId && !t.completed_at);
      const maxIdx = userActive.reduce((m, t) => Math.max(m, t.order_idx || 0), -1);
      const res = await fetch(`${SB_URL}/rest/v1/todos`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ title, category: s[ck] || null, deadline: s[dk] || null, notes: (s[nk] || '').trim() || null, created_by: ownerId, day, order_idx: maxIdx + 1 })
      });
      const rows = await res.json();
      if (Array.isArray(rows) && rows[0]) {
        const clear = { [tk]: '', [ck]: '', [dk]: '', [nk]: '', ['todosAddOpen_' + ownerId]: false };
        this.setState(st => ({ todosList: [...(st.todosList || []), rows[0]], ...clear }));
      }
    };

    const reorderForUser = async (newList, allTodos) => {
      const otherTodos = allTodos.filter(t => !newList.find(n => n.id === t.id));
      this.setState({ todosList: [...newList, ...otherTodos] });
      for (let i = 0; i < newList.length; i++) {
        if ((newList[i].order_idx || 0) !== i) {
          fetch(`${SB_URL}/rest/v1/todos?id=eq.${newList[i].id}`, {
            method: 'PATCH',
            headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ order_idx: i })
          });
        }
      }
    };

    const renderColumn = user => {
      const isMe = user.id === myId;
      const col = user.id;
      const userActive = (todos || []).filter(t => t.created_by === col && !t.completed_at);
      const userDone = (todos || []).filter(t => t.created_by === col && !!t.completed_at);
      const doneOpenKey = 'todosDoneOpen_' + col;
      const addOpenKey = 'todosAddOpen_' + col;
      const dragIdxKey = '_tdDragIdx_' + col;
      const dragOverKey = '_tdDragOver_' + col;
      const dragOver = this[dragOverKey];

      const onDragStart2 = idx => { this[dragIdxKey] = idx; };
      const onDragOver2 = (ev, idx) => { ev.preventDefault(); if (this[dragOverKey] !== idx) { this[dragOverKey] = idx; this.setState({ _tdTick: Date.now() }); } };
      const onDrop2 = (ev, dropIdx) => {
        ev.preventDefault();
        const from = this[dragIdxKey];
        if (from == null || from === dropIdx) { this[dragIdxKey] = null; this[dragOverKey] = null; return; }
        const list = [...userActive]; const [moved] = list.splice(from, 1); list.splice(dropIdx, 0, moved);
        this[dragIdxKey] = null; this[dragOverKey] = null;
        reorderForUser(list, todos || []);
      };
      const onDragEnd2 = () => { this[dragIdxKey] = null; this[dragOverKey] = null; this.setState({ _tdTick: Date.now() }); };

      const saveTodoEdit = async (todo) => {
        const ek = 'todoEdit_' + todo.id;
        const fields = {
          title: (s[ek + '_title'] || '').trim() || todo.title,
          category: s[ek + '_cat'] || null,
          deadline: s[ek + '_dl'] || null,
          notes: (s[ek + '_notes'] || '').trim() || null,
        };
        await fetch(`${SB_URL}/rest/v1/todos?id=eq.${todo.id}`, {
          method: 'PATCH',
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(fields)
        });
        this.setState(st => ({
          todosList: (st.todosList || []).map(t => t.id === todo.id ? { ...t, ...fields } : t),
          [ek + '_open']: false,
        }));
      };

      const todoRow = (todo, idx, isDone) => {
        const isDragging = this[dragIdxKey] === idx;
        const isTop = !isDone && idx === 0;
        const ek = 'todoEdit_' + todo.id;
        const isEditing = !!s[ek + '_open'];
        const rowBg = isDragging ? 'transparent' : dragOver === idx ? 'var(--surface-2)' : isTop ? 'oklch(0.20 0.04 250 / 0.55)' : 'transparent';
        const rowStyle = {
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: isTop ? '13px 14px 13px 10px' : '11px 14px',
          borderBottom: '1px solid var(--border-soft)',
          background: rowBg,
          opacity: isDragging ? 0.4 : 1,
          cursor: !isDone && !isEditing ? 'grab' : 'default',
          borderLeft: isTop ? '3px solid var(--accent)' : '3px solid transparent',
          boxShadow: isTop ? '0 2px 12px oklch(0.50 0.18 250 / 0.12)' : 'none',
          transition: 'background .15s',
        };

        if (isEditing) {
          const inputStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' };
          return e('div', { key: todo.id, style: { ...rowStyle, cursor: 'default', flexDirection: 'column', gap: 8 } },
            e('input', { autoFocus: true, value: s[ek + '_title'] !== undefined ? s[ek + '_title'] : todo.title, onChange: ev => this.setState({ [ek + '_title']: ev.target.value }), onKeyDown: ev => { if (ev.key === 'Enter') saveTodoEdit(todo); if (ev.key === 'Escape') this.setState({ [ek + '_open']: false }); }, style: { ...inputStyle, fontWeight: 700 }, placeholder: 'Task title\u2026' }),
            e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 } },
              e('input', { placeholder: 'Category', value: s[ek + '_cat'] !== undefined ? s[ek + '_cat'] : (todo.category || ''), onChange: ev => this.setState({ [ek + '_cat']: ev.target.value }), list: 'todo-cats-' + col, style: { ...inputStyle, fontSize: 12 } }),
              e('input', { type: 'date', value: s[ek + '_dl'] !== undefined ? s[ek + '_dl'] : (todo.deadline || ''), onChange: ev => this.setState({ [ek + '_dl']: ev.target.value }), style: { ...inputStyle, fontSize: 12 } })),
            e('input', { placeholder: 'Notes', value: s[ek + '_notes'] !== undefined ? s[ek + '_notes'] : (todo.notes || ''), onChange: ev => this.setState({ [ek + '_notes']: ev.target.value }), style: { ...inputStyle, fontSize: 12 } }),
            e('div', { style: { display: 'flex', gap: 6 } },
              e('button', { onClick: () => saveTodoEdit(todo), style: { padding: '5px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'oklch(0.12 0 0)', fontWeight: 700, fontSize: 12, cursor: 'pointer' } }, 'Opslaan'),
              e('button', { onClick: () => this.setState({ [ek + '_open']: false }), style: { padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-mute)', fontSize: 12, cursor: 'pointer' } }, 'Annuleren')));
        }

        return e('div', { key: todo.id,
          draggable: !isDone,
          onDragStart: !isDone ? () => onDragStart2(idx) : undefined,
          onDragOver: !isDone ? ev => onDragOver2(ev, idx) : undefined,
          onDrop: !isDone ? ev => onDrop2(ev, idx) : undefined,
          onDragEnd: !isDone ? onDragEnd2 : undefined,
          style: rowStyle },
          !isDone ? e('div', { style: { color: 'var(--text-mute)', fontSize: 14, flexShrink: 0, paddingTop: 2, userSelect: 'none' } }, '\u28FF') : e('div', { style: { width: 14 } }),
          !isDone ? e('div', { style: { width: 18, flexShrink: 0, fontSize: 11, fontWeight: 700, color: isTop ? 'var(--accent)' : 'var(--text-mute)', fontFamily: "'JetBrains Mono'", paddingTop: 3, textAlign: 'right', userSelect: 'none' } }, String(idx + 1)) : null,
          e('div', { onClick: () => checkTodo(todo), style: { width: 20, height: 20, borderRadius: 6, border: isDone ? 'none' : isTop ? '2px solid var(--accent)' : '2px solid var(--border)', background: isDone ? 'var(--up)' : 'transparent', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1, transition: 'all .15s' } },
            isDone ? e('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'oklch(0.12 0 0)', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M20 6L9 17l-5-5' })) : null),
          e('div', { style: { flex: 1, minWidth: 0 } },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
              e('span', { onClick: () => this.setState({ [ek + '_open']: true }), style: { fontSize: isTop ? 14 : 13.5, fontWeight: isTop ? 700 : 600, color: isDone ? 'var(--text-mute)' : 'var(--text)', textDecoration: isDone ? 'line-through' : 'none', textDecorationColor: 'var(--up)', textDecorationThickness: 2, flex: 1, minWidth: 0, cursor: isDone ? 'default' : 'text' } }, todo.title),
              catPill(todo.category), deadlinePill(todo.deadline), carriedBadge(todo.carried_from)),
            todo.notes ? e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', marginTop: 3, lineHeight: 1.5 } }, todo.notes) : null,
            isDone && todo.completed_by ? e('div', { style: { fontSize: 11, color: 'var(--up)', marginTop: 2 } }, '\u2713 ' + todo.completed_by) : null),
          !isDone && todo.category === 'Platform' ? e('button', {
            title: 'Run with Claude',
            onClick: ev => { ev.stopPropagation(); this.setState({ claudeSession: { id: todo.id, title: todo.title, notes: todo.notes || '', output: '', status: 'running' } }); },
            style: { background: 'none', border: '1px solid rgba(103,220,223,0.3)', borderRadius: 6, color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: '2px 6px', flexShrink: 0, lineHeight: 1, marginRight: 2, fontWeight: 700 }
          }, '\u26A1') : null,
          e('button', { onClick: () => deleteTodo(todo.id), style: { background: 'none', border: 'none', color: 'var(--text-mute)', cursor: 'pointer', fontSize: 15, padding: '0 2px', flexShrink: 0, opacity: 0.4, lineHeight: 1 } }, '\u00D7'));
      };

      const addForm = s[addOpenKey] ? e('div', { style: { padding: '12px 14px', borderTop: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 8 } },
        e('input', { placeholder: 'Task title\u2026', value: s['todosAddTitle_' + col] || '', onChange: ev => this.setState({ ['todosAddTitle_' + col]: ev.target.value }), onKeyDown: ev => { if (ev.key === 'Enter') addTodoFor(col); if (ev.key === 'Escape') this.setState({ [addOpenKey]: false }); }, autoFocus: true, style: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' } }),
        e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 } },
          e('input', { placeholder: 'Category', value: s['todosAddCat_' + col] || '', onChange: ev => this.setState({ ['todosAddCat_' + col]: ev.target.value }), list: 'todo-cats-' + col, style: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none' } }),
          e('datalist', { id: 'todo-cats-' + col }, ...allCats.map(c => e('option', { key: c, value: c }))),
          e('input', { type: 'date', value: s['todosAddDl_' + col] || '', onChange: ev => this.setState({ ['todosAddDl_' + col]: ev.target.value }), style: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none' } })),
        e('input', { placeholder: 'Notes', value: s['todosAddNotes_' + col] || '', onChange: ev => this.setState({ ['todosAddNotes_' + col]: ev.target.value }), style: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none' } }),
        e('div', { style: { display: 'flex', gap: 6 } },
          e('button', { onClick: () => addTodoFor(col), style: { padding: '6px 14px', borderRadius: 8, border: 'none', background: isMe ? 'var(--accent)' : 'var(--info)', color: 'oklch(0.12 0 0)', fontWeight: 700, fontSize: 12, cursor: 'pointer' } }, 'Add'),
          e('button', { onClick: () => this.setState({ [addOpenKey]: false, ['todosAddTitle_' + col]: '' }), style: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-mute)', fontSize: 12, cursor: 'pointer' } }, 'Cancel'))) : null;

      const accentColor = isMe ? 'var(--accent)' : 'var(--info)';
      return e('div', { key: col, style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 } },
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '2px solid ' + accentColor } },
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            e('div', { style: { width: 30, height: 30, borderRadius: '50%', background: accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: 'oklch(0.12 0 0)' } }, user.label[0]),
            e('span', { style: { fontWeight: 700, fontSize: 15.5, color: 'var(--text)' } }, user.label),
            userActive.length > 0 ? e('span', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontFamily: "\'JetBrains Mono\'" } }, userActive.length + ' open') : null),
          e('button', { onClick: () => this.setState({ [addOpenKey]: !s[addOpenKey] }), style: { padding: '5px 12px', borderRadius: 8, border: 'none', background: accentColor, color: 'oklch(0.12 0 0)', fontWeight: 700, fontSize: 12, cursor: 'pointer' } }, '+ Task')),
        e('div', { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' } },
          s.todosLoading ? e('div', { style: { padding: '24px 14px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 } }, 'Loading\u2026') :
          userActive.length === 0 && !s[addOpenKey] ? e('div', { style: { padding: '24px 14px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 } }, '\uD83C\uDF89 All done!') :
          e('div', { onDragOver: ev => ev.preventDefault() }, ...userActive.map((todo, idx) => todoRow(todo, idx, false))),
          addForm),
        userDone.length > 0 ? e('div', { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' } },
          e('button', { onClick: () => this.setState(st => ({ [doneOpenKey]: !st[doneOpenKey] })), style: { width: '100%', padding: '10px 14px', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-mute)', fontSize: 12.5, fontWeight: 600 } },
            e('span', { style: { fontSize: 10, transition: 'transform .2s', transform: s[doneOpenKey] ? 'rotate(90deg)' : 'none' } }, '\u25B6'),
            'Done (' + userDone.length + ')',
            e('span', { style: { fontSize: 11, color: 'var(--up)', fontWeight: 700, marginLeft: 'auto' } }, '\u2713')),
          s[doneOpenKey] ? e('div', { style: { borderTop: '1px solid var(--border-soft)' } }, ...userDone.map((todo, idx) => todoRow(todo, idx, true))) : null) : null);
    };

    // Claude session modal
    const cs = s.claudeSession;
    if (cs && cs.status === 'running' && !cs._started) {
      this.setState({ claudeSession: { ...cs, _started: true } });
      const AGENT_URL = 'https://platforminfinite-scalebe-production.up.railway.app';
      const AGENT_SECRET = 'claude-agent-local-2026';
      (async () => {
        // Try local agent first (full execution), fall back to Vercel (planning only)
        let url, headers, body, mode;
        try {
          const ping = await fetch(AGENT_URL + '/ping', { signal: AbortSignal.timeout(1500) });
          if (ping.ok) {
            url = AGENT_URL + '/execute';
            headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AGENT_SECRET };
            body = JSON.stringify({ title: cs.title, notes: cs.notes });
            mode = 'execute';
          }
        } catch (_) {}
        if (!url) {
          url = '/api/enhance-contract';
          headers = { 'Content-Type': 'application/json' };
          body = JSON.stringify({ title: cs.title, notes: cs.notes });
          mode = 'plan';
        }
        this.setState(st => ({ claudeSession: st.claudeSession ? { ...st.claudeSession, mode } : st.claudeSession }));

        const r = await fetch(url, { method: 'POST', headers, body });
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.text) this.setState(st => ({ claudeSession: st.claudeSession ? { ...st.claudeSession, output: (st.claudeSession.output || '') + ev.text } : st.claudeSession }));
              if (ev.tool) this.setState(st => ({ claudeSession: st.claudeSession ? { ...st.claudeSession, output: (st.claudeSession.output || '') + '\n\n→ ' + ev.tool + '(' + JSON.stringify(ev.input).slice(0, 80) + ')' } : st.claudeSession }));
              if (ev.toolRunning) this.setState(st => ({ claudeSession: st.claudeSession ? { ...st.claudeSession, output: (st.claudeSession.output || '') + '\n  ⏳ running...' } : st.claudeSession }));
              if (ev.toolResult) this.setState(st => ({ claudeSession: st.claudeSession ? { ...st.claudeSession, output: (st.claudeSession.output || '') + '\n  ✓ ' + ev.output } : st.claudeSession }));
              if (ev.done) this.setState(st => ({ claudeSession: st.claudeSession ? { ...st.claudeSession, status: 'done' } : st.claudeSession }));
              if (ev.error) this.setState(st => ({ claudeSession: st.claudeSession ? { ...st.claudeSession, status: 'error', output: (st.claudeSession.output || '') + '\n\n✗ Error: ' + ev.error } : st.claudeSession }));
            } catch (_) {}
          }
        }
        this.setState(st => ({ claudeSession: st.claudeSession ? { ...st.claudeSession, status: st.claudeSession.status === 'running' ? 'done' : st.claudeSession.status } : st.claudeSession }));
      })();
    }

    const claudeModal = cs ? e('div', {
      style: { position: 'fixed', inset: 0, background: 'rgba(7,10,20,0.82)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
      onClick: ev => { if (ev.target === ev.currentTarget) this.setState({ claudeSession: null }); }
    },
      e('div', { style: { width: '100%', maxWidth: 820, height: '80vh', background: '#0d1117', border: '1px solid rgba(103,220,223,0.25)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' } },
        e('div', { style: { padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } },
          e('span', { style: { fontSize: 15, fontWeight: 700, color: 'var(--accent)' } }, '⚡ Claude'),
          e('span', { style: { fontSize: 13, color: 'rgba(255,255,255,0.5)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, cs.title),
          cs.mode ? e('span', { style: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: cs.mode === 'execute' ? 'rgba(103,220,223,0.15)' : 'rgba(255,166,35,0.15)', color: cs.mode === 'execute' ? 'var(--accent)' : '#f5a623', letterSpacing: '.08em', textTransform: 'uppercase', flexShrink: 0 } }, cs.mode === 'execute' ? '⚙ executing' : '📋 planning') : null,
          cs.status === 'running' ? e('span', { style: { fontSize: 11, color: 'var(--accent)', fontWeight: 700 } }, cs.mode === 'execute' ? '● executing…' : '● thinking…') :
          cs.status === 'done' ? e('span', { style: { fontSize: 11, color: 'var(--up)', fontWeight: 700 } }, '✓ done') :
          e('span', { style: { fontSize: 11, color: '#e8314a', fontWeight: 700 } }, '✗ error'),
          e('button', { onClick: () => this.setState({ claudeSession: null }), style: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' } }, '×')),
        e('div', { style: { flex: 1, overflow: 'auto', padding: '20px 24px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.75, color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
          cs.output || (cs.status === 'running' ? e('span', { style: { color: 'var(--accent)', opacity: 0.7 } }, 'Starting Claude session…') : null)))) : null;

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
      claudeModal,
      e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 24 } },
        e('button', { onClick: () => navDay(-1), style: { padding: '6px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 } }, '\u2039'),
        e('div', { style: { textAlign: 'center' } },
          e('div', { style: { fontWeight: 700, fontSize: 16, color: 'var(--text)' } }, fmtDay(day)),
          day !== today ? e('button', { onClick: () => this.setState({ todosDay: today, todosList: null, _todosLoaded: false }), style: { marginTop: 4, fontSize: 11.5, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 } }, '\u2192 Back to today') : null),
        e('button', { onClick: () => navDay(1), style: { padding: '6px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 } }, '\u203A')),
      e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' } },
        ...USERS.map(u => renderColumn(u))));
  },

  // ---------------------------------------------------------------------------
  // WhatsApp tab
  // ---------------------------------------------------------------------------
  _admWhatsApp(d, s) {
    const e = React.createElement;
    const wa = d.whatsappMessages || [];
    const tpls = d.whatsappTemplates || [];

    const subTab = s._waSubTab || 'messages';
    const setSubTab = t => this.setState({ _waSubTab: t });

    const filterClient = s._waFilterClient || '';
    const filterStatus = s._waFilterStatus || '';
    const filterDateFrom = s._waFilterDateFrom || '';
    const filterDateTo = s._waFilterDateTo || '';
    const threadPhone = s._waThreadPhone || null;

    const inputStyle = { padding: '7px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, width: '100%', boxSizing: 'border-box' };
    const btnStyle = (accent) => ({ padding: '7px 16px', borderRadius: 8, border: accent ? 'none' : '1px solid var(--border)', background: accent ? 'var(--accent)' : 'var(--surface)', color: accent ? '#071a1a' : 'var(--text)', fontWeight: accent ? 700 : 400, cursor: 'pointer', fontSize: 13 });

    const statusBadge = status => {
      const colors = { sent: '#5a7fbf', delivered: '#f5a623', read: 'var(--up)', failed: 'var(--down)', received: '#8b5fbf' };
      return e('span', { style: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: (colors[status] || '#555') + '22', color: colors[status] || '#aaa', letterSpacing: '.06em', textTransform: 'uppercase' } }, status);
    };
    const dirBadge = dir => e('span', { style: { fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: dir === 'inbound' ? 'rgba(103,220,223,0.12)' : 'rgba(90,127,191,0.15)', color: dir === 'inbound' ? 'var(--accent)' : '#7a9be0', letterSpacing: '.05em', textTransform: 'uppercase' } }, dir);
    const fmtTime = iso => iso ? iso.slice(0, 16).replace('T', ' ') : '\u2014';
    const clientName = cid => (d.clients || []).find(c => c.id === cid)?.name || cid || '\u2014';

    // \u2500\u2500 Status overview \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const activeTpls = tpls.filter(t => t.active);
    const sentToday = wa.filter(m => m.created_at && m.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
    const failedTotal = wa.filter(m => m.status === 'failed').length;
    const statCard = (label, value, sub, color) => e('div', { style: { flex: 1, minWidth: 140, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px' } },
      e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginBottom: 4 } }, label),
      e('div', { style: { fontSize: 22, fontWeight: 700, color: color || 'var(--text)' } }, value),
      sub ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 2 } }, sub) : null);

    const statusRow = e('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
      statCard('Active templates', activeTpls.length, activeTpls.length === 0 ? 'No clients configured' : activeTpls.map(t => clientName(t.client_id)).join(', ').slice(0, 40), activeTpls.length > 0 ? 'var(--up)' : 'var(--down)'),
      statCard('Messages today', sentToday, 'sent outbound'),
      statCard('Total messages', wa.length, 'all time'),
      statCard('Failed', failedTotal, 'all time', failedTotal > 0 ? 'var(--down)' : 'var(--text-mute)'));

    // \u2500\u2500 Thread modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const threadReplyText = s._waReplyText || '';
    const threadSending = s._waReplySending || false;

    const sendReply = async () => {
      if (!threadReplyText.trim() || threadSending) return;
      this.setState({ _waReplySending: true });
      const token = SB.getSession()?.access_token || '';
      const r = await fetch('/api/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ type: 'reply', phone: threadPhone, text: threadReplyText.trim() }),
      }).then(r => r.json()).catch(err => ({ ok: false, error: err.message }));
      this.setState({ _waReplySending: false });
      if (r.ok) {
        this.setState({ _waReplyText: '' });
        this.mutLocal(dd => {
          (dd.whatsappMessages = dd.whatsappMessages || []).push({
            id: 'tmp-' + Date.now(), phone: threadPhone, direction: 'outbound', message_type: 'reply',
            content: threadReplyText.trim(), status: 'sent', created_at: new Date().toISOString(),
            template_name: null, client_id: null, appointment_id: null,
          });
        });
        this.toast('Sent', 'Message sent', 'var(--up)');
      } else {
        this.toast('Failed', r.error || r.reason || 'Send failed', 'var(--down)');
      }
    };

    const threadView = threadPhone ? e('div', { style: { position: 'fixed', inset: 0, background: 'rgba(7,10,20,0.82)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
        onClick: ev => { if (ev.target === ev.currentTarget) this.setState({ _waThreadPhone: null, _waReplyText: '' }); } },
      e('div', { style: { width: '100%', maxWidth: 620, maxHeight: '85vh', background: '#13161f', border: '1px solid var(--border)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        e('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10 } },
          e('span', { style: { fontWeight: 700, color: 'var(--text)', flex: 1 } }, 'Thread: ' + threadPhone),
          e('button', { onClick: () => this.setState({ _waThreadPhone: null, _waReplyText: '' }), style: { background: 'none', border: 'none', color: 'var(--text-mute)', fontSize: 20, cursor: 'pointer' } }, '\u00D7')),
        e('div', { style: { flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 } },
          ...wa.filter(m => m.phone === threadPhone || m.phone === '+' + threadPhone.replace(/^\+/, '')).map(m =>
            e('div', { key: m.id, style: { display: 'flex', flexDirection: 'column', alignItems: m.direction === 'inbound' ? 'flex-start' : 'flex-end', gap: 3 } },
              e('div', { style: { maxWidth: '80%', padding: '8px 14px', borderRadius: 14, background: m.direction === 'inbound' ? 'var(--surface)' : 'oklch(0.22 0.08 230 / .7)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5 } },
                m.content || (m.template_name ? '[Template: ' + m.template_name + ']' : '[no content]')),
              e('div', { style: { fontSize: 10, color: 'var(--text-mute)', display: 'flex', gap: 6 } }, fmtTime(m.created_at), statusBadge(m.status))))
        ),
        e('div', { style: { padding: '12px 16px', borderTop: '1px solid var(--border-soft)', display: 'flex', gap: 8, alignItems: 'flex-end' } },
          e('textarea', { value: threadReplyText, onChange: ev => this.setState({ _waReplyText: ev.target.value }),
            onKeyDown: ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendReply(); } },
            placeholder: 'Type a message\u2026 (Enter to send, Shift+Enter for newline)', rows: 2,
            style: { flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 } }),
          e('button', { onClick: sendReply, disabled: threadSending || !threadReplyText.trim(),
            style: { padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#071a1a', fontWeight: 700, fontSize: 13, cursor: threadSending ? 'default' : 'pointer', opacity: threadSending || !threadReplyText.trim() ? 0.5 : 1, whiteSpace: 'nowrap' } },
            threadSending ? 'Sending\u2026' : 'Send'))
      )
    ) : null;

    // \u2500\u2500 Messages tab \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    let msgs = wa.filter(m => {
      if (filterClient && m.client_id !== filterClient) return false;
      if (filterStatus && m.status !== filterStatus) return false;
      if (filterDateFrom && m.created_at < filterDateFrom) return false;
      if (filterDateTo && m.created_at > filterDateTo + 'T23:59:59Z') return false;
      return true;
    });

    const messagesTab = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
        e('select', { value: filterClient, onChange: ev => this.setState({ _waFilterClient: ev.target.value }), style: { ...inputStyle, width: 'auto' } },
          e('option', { value: '' }, 'All clients'),
          ...(d.clients || []).map(c => e('option', { key: c.id, value: c.id }, c.name))),
        e('select', { value: filterStatus, onChange: ev => this.setState({ _waFilterStatus: ev.target.value }), style: { ...inputStyle, width: 'auto' } },
          e('option', { value: '' }, 'All statuses'),
          ['sent', 'delivered', 'read', 'failed', 'received'].map(st => e('option', { key: st, value: st }, st))),
        e('input', { type: 'date', value: filterDateFrom, onChange: ev => this.setState({ _waFilterDateFrom: ev.target.value }), style: { ...inputStyle, width: 'auto' } }),
        e('input', { type: 'date', value: filterDateTo, onChange: ev => this.setState({ _waFilterDateTo: ev.target.value }), style: { ...inputStyle, width: 'auto' } }),
        msgs.length > 0 ? e('span', { style: { fontSize: 12, color: 'var(--text-mute)', marginLeft: 'auto' } }, msgs.length + ' message' + (msgs.length !== 1 ? 's' : '')) : null),
      e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
          e('thead', null, e('tr', null, ['Lead / phone', 'Client', 'Type', 'Dir', 'Status', 'Template', 'Sent at'].map(h =>
            e('th', { key: h, style: { textAlign: 'left', padding: '8px 12px', color: 'var(--text-mute)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' } }, h)))),
          e('tbody', null,
            msgs.length === 0
              ? e('tr', null, e('td', { colSpan: 7, style: { padding: '24px 12px', color: 'var(--text-mute)', textAlign: 'center', fontSize: 13 } }, 'No messages yet. They appear here when agents log appointments.'))
              : msgs.map(m => {
                const appt = (d.appointments || []).find(a => a.id === m.appointment_id);
                const leadLabel = appt ? (appt.lead_name || appt.lead || '') + ' (' + m.phone + ')' : m.phone || '\u2014';
                return e('tr', { key: m.id, onClick: () => this.setState({ _waThreadPhone: m.phone }), style: { cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' } },
                  e('td', { style: { padding: '9px 12px', color: 'var(--text)' } }, leadLabel),
                  e('td', { style: { padding: '9px 12px', color: 'var(--text-mute)' } }, clientName(m.client_id)),
                  e('td', { style: { padding: '9px 12px', color: 'var(--text)' } }, m.message_type),
                  e('td', { style: { padding: '9px 12px' } }, dirBadge(m.direction)),
                  e('td', { style: { padding: '9px 12px' } }, statusBadge(m.status)),
                  e('td', { style: { padding: '9px 12px', color: 'var(--text-mute)', fontSize: 12 } }, m.template_name || '\u2014'),
                  e('td', { style: { padding: '9px 12px', color: 'var(--text-mute)', fontSize: 12, whiteSpace: 'nowrap' } }, fmtTime(m.created_at)));
              })
          )
        )
      )
    );

    // \u2500\u2500 Templates tab \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const showAddForm = s._waShowAddTpl || false;
    const newTpl = s._waNewTpl || {};

    const saveNewTpl = async () => {
      if (!newTpl.client_id || !newTpl.template_name || !newTpl.template_language) {
        this.toast('Error', 'Fill in all required fields', 'var(--down)'); return;
      }
      const r = await fetch('/api/db-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (SB.getSession()?.access_token || '') },
        body: JSON.stringify({ method: 'post', table: 'client_whatsapp_templates', body: { client_id: newTpl.client_id, template_name: newTpl.template_name.trim(), template_language: newTpl.template_language.trim(), reminder_hours_before: Number(newTpl.reminder_hours_before || 24), active: true } }),
      }).then(r => r.json()).catch(() => ({}));
      if (r.ok) {
        const inserted = Array.isArray(r.data) ? r.data[0] : r.data;
        if (inserted) this.mutLocal(dd => { (dd.whatsappTemplates = dd.whatsappTemplates || []).push(inserted); });
        this.setState({ _waShowAddTpl: false, _waNewTpl: {} });
        this.toast('Saved', 'Template added', 'var(--up)');
      } else {
        this.toast('Error', 'Could not add template: ' + JSON.stringify(r.error).slice(0, 80), 'var(--down)');
      }
    };

    const deleteTpl = async (tId) => {
      if (!confirm('Delete this template?')) return;
      const r = await fetch('/api/db-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (SB.getSession()?.access_token || '') },
        body: JSON.stringify({ method: 'del', table: 'client_whatsapp_templates', query: '?id=eq.' + tId }),
      }).then(r => r.json()).catch(() => ({}));
      if (r.ok) {
        this.mutLocal(dd => { dd.whatsappTemplates = (dd.whatsappTemplates || []).filter(x => x.id !== tId); });
        this.toast('Deleted', 'Template removed', 'var(--up)');
      }
    };

    const testSend = async (t) => {
      const phone = prompt('Send test to phone number (e.g. +32492423364):');
      if (!phone) return;
      const token = SB.getSession()?.access_token || '';
      const r = await fetch('/api/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ appointmentId: 'test-' + Date.now(), clientId: t.client_id, leadName: 'Test Lead', phone, dateAppt: new Date(Date.now() + 86400000).toISOString() }),
      }).then(r => r.json()).catch(err => ({ ok: false, error: err.message }));
      if (r.ok) this.toast('Sent', 'Test WhatsApp sent to ' + phone, 'var(--up)');
      else this.toast('Failed', r.reason || r.error || 'Unknown error', 'var(--down)');
    };

    const clientsWithoutTpl = (d.clients || []).filter(c => !tpls.find(t => t.client_id === c.id));

    const templatesTab = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      // Info banner
      e('div', { style: { fontSize: 12, color: 'var(--text-mute)', padding: '10px 14px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-soft)', lineHeight: 1.6 } },
        'Each client can have one active WhatsApp template. The template name and language must exactly match an approved template in your Meta Business Manager. ' +
        'Template text is controlled by Meta \u2014 wording changes require Meta approval (24-48h). ' +
        'The \u201Chello_world\u201D template is a Meta demo and is always approved. Use it for testing only.'),
      // Add template form
      !showAddForm
        ? e('button', { onClick: () => this.setState({ _waShowAddTpl: true, _waNewTpl: {} }), style: { ...btnStyle(true), alignSelf: 'flex-start' } }, '+ Add template')
        : e('div', { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 } },
          e('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 4 } }, 'Add template'),
          e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
            e('div', null,
              e('label', { style: { fontSize: 12, color: 'var(--text-mute)', display: 'block', marginBottom: 4 } }, 'Client *'),
              e('select', { value: newTpl.client_id || '', onChange: ev => this.setState({ _waNewTpl: { ...newTpl, client_id: ev.target.value } }), style: inputStyle },
                e('option', { value: '' }, 'Select client\u2026'),
                ...(d.clients || []).map(c => e('option', { key: c.id, value: c.id }, c.name)))),
            e('div', null,
              e('label', { style: { fontSize: 12, color: 'var(--text-mute)', display: 'block', marginBottom: 4 } }, 'Template name * (exact Meta name)'),
              e('input', { type: 'text', value: newTpl.template_name || '', placeholder: 'e.g. hello_world', onChange: ev => this.setState({ _waNewTpl: { ...newTpl, template_name: ev.target.value } }), style: inputStyle })),
            e('div', null,
              e('label', { style: { fontSize: 12, color: 'var(--text-mute)', display: 'block', marginBottom: 4 } }, 'Language code *'),
              e('input', { type: 'text', value: newTpl.template_language || '', placeholder: 'e.g. en_US or nl', onChange: ev => this.setState({ _waNewTpl: { ...newTpl, template_language: ev.target.value } }), style: inputStyle })),
            e('div', null,
              e('label', { style: { fontSize: 12, color: 'var(--text-mute)', display: 'block', marginBottom: 4 } }, 'Send reminder N hours before appointment'),
              e('input', { type: 'number', min: 1, max: 168, value: newTpl.reminder_hours_before || 24, onChange: ev => this.setState({ _waNewTpl: { ...newTpl, reminder_hours_before: ev.target.value } }), style: inputStyle }))),
          e('div', { style: { display: 'flex', gap: 8 } },
            e('button', { onClick: saveNewTpl, style: btnStyle(true) }, 'Save template'),
            e('button', { onClick: () => this.setState({ _waShowAddTpl: false, _waNewTpl: {} }), style: btnStyle(false) }, 'Cancel'))),
      // Templates table
      e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
          e('thead', null, e('tr', null, ['Client', 'Template name', 'Language', 'Reminder', 'Active', 'Actions'].map(h =>
            e('th', { key: h, style: { textAlign: 'left', padding: '8px 12px', color: 'var(--text-mute)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border-soft)' } }, h)))),
          e('tbody', null,
            tpls.length === 0
              ? e('tr', null, e('td', { colSpan: 6, style: { padding: '24px 12px', color: 'var(--text-mute)', textAlign: 'center', fontSize: 13 } }, 'No templates configured. Add one above to enable WhatsApp confirmations.'))
              : tpls.map(t => {
                const isEditing = s['_waEditTpl_' + t.id];
                const editHours = s['_waEditHours_' + t.id] ?? t.reminder_hours_before;
                const editActive = s['_waEditActive_' + t.id] ?? t.active;
                const editName = s['_waEditName_' + t.id] ?? t.template_name;
                const editLang = s['_waEditLang_' + t.id] ?? t.template_language;

                const save = async () => {
                  const r = await fetch('/api/db-write', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (SB.getSession()?.access_token || '') },
                    body: JSON.stringify({ method: 'patch', table: 'client_whatsapp_templates', query: '?id=eq.' + t.id, body: { template_name: editName, template_language: editLang, reminder_hours_before: Number(editHours), active: editActive } }),
                  }).then(r => r.json()).catch(() => ({}));
                  if (r.ok) {
                    this.mutLocal(dd => { const row = (dd.whatsappTemplates || []).find(x => x.id === t.id); if (row) { row.template_name = editName; row.template_language = editLang; row.reminder_hours_before = Number(editHours); row.active = editActive; } });
                    this.setState({ ['_waEditTpl_' + t.id]: false });
                    this.toast('Saved', 'Template updated', 'var(--up)');
                  } else this.toast('Error', 'Save failed', 'var(--down)');
                };

                return e('tr', { key: t.id, style: { borderBottom: '1px solid var(--border-soft)' } },
                  e('td', { style: { padding: '9px 12px', color: 'var(--text)' } }, clientName(t.client_id)),
                  e('td', { style: { padding: '9px 12px', fontFamily: 'monospace', fontSize: 12 } },
                    isEditing ? e('input', { type: 'text', value: editName, onChange: ev => this.setState({ ['_waEditName_' + t.id]: ev.target.value }), style: { ...inputStyle, width: 180, fontSize: 12 } }) : t.template_name),
                  e('td', { style: { padding: '9px 12px', color: 'var(--text-mute)' } },
                    isEditing ? e('input', { type: 'text', value: editLang, onChange: ev => this.setState({ ['_waEditLang_' + t.id]: ev.target.value }), style: { ...inputStyle, width: 80, fontSize: 12 } }) : t.template_language),
                  e('td', { style: { padding: '9px 12px' } },
                    isEditing ? e('input', { type: 'number', min: 1, max: 168, value: editHours, onChange: ev => this.setState({ ['_waEditHours_' + t.id]: ev.target.value }), style: { ...inputStyle, width: 70, fontSize: 12 } }) : t.reminder_hours_before + 'h before'),
                  e('td', { style: { padding: '9px 12px' } },
                    isEditing
                      ? e('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 } }, e('input', { type: 'checkbox', checked: editActive, onChange: ev => this.setState({ ['_waEditActive_' + t.id]: ev.target.checked }) }), editActive ? 'Active' : 'Inactive')
                      : e('span', { style: { fontSize: 12, fontWeight: 700, color: t.active ? 'var(--up)' : 'var(--text-mute)' } }, t.active ? 'Active' : 'Inactive')),
                  e('td', { style: { padding: '9px 12px' } },
                    isEditing
                      ? e('span', { style: { display: 'flex', gap: 6 } },
                          e('button', { onClick: save, style: { ...btnStyle(true), padding: '4px 12px', fontSize: 12 } }, 'Save'),
                          e('button', { onClick: () => this.setState({ ['_waEditTpl_' + t.id]: false }), style: { ...btnStyle(false), padding: '4px 10px', fontSize: 12 } }, 'Cancel'))
                      : e('span', { style: { display: 'flex', gap: 6 } },
                          e('button', { onClick: () => testSend(t), style: { ...btnStyle(false), padding: '4px 10px', fontSize: 12 } }, 'Test'),
                          e('button', { onClick: () => this.setState({ ['_waEditTpl_' + t.id]: true, ['_waEditHours_' + t.id]: t.reminder_hours_before, ['_waEditActive_' + t.id]: t.active, ['_waEditName_' + t.id]: t.template_name, ['_waEditLang_' + t.id]: t.template_language }), style: { ...btnStyle(false), padding: '4px 10px', fontSize: 12 } }, 'Edit'),
                          e('button', { onClick: () => deleteTpl(t.id), style: { ...btnStyle(false), padding: '4px 10px', fontSize: 12, color: 'var(--down)' } }, 'Delete'))));
              })
          )
        )
      )
    );

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
      threadView,
      statusRow,
      e('div', { style: { display: 'flex', gap: 4 } },
        ['messages', 'templates'].map(t =>
          e('button', { key: t, onClick: () => setSubTab(t),
            style: { padding: '7px 18px', borderRadius: 8, border: '1px solid ' + (subTab === t ? 'var(--accent)' : 'var(--border)'), background: subTab === t ? 'oklch(0.22 0.09 180 / .35)' : 'var(--surface)', color: subTab === t ? 'var(--accent)' : 'var(--text-mute)', fontWeight: subTab === t ? 700 : 400, cursor: 'pointer', fontSize: 13, textTransform: 'capitalize', transition: 'all .15s' } },
            t === 'messages' ? 'Messages' : 'Templates (' + tpls.length + ')'))),
      subTab === 'messages' ? messagesTab : templatesTab);
  },

};