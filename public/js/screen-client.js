// Client and Lead Agency screens
const ScreenClient = {
  scrClient(d, s) {
    const e = React.createElement;
    const isAgency = s.role === 'agency';
    const cl = d.clients.find(c => c.id === this.myClientId);
    if (!cl) {
      this.setState({ role: null, error: 'Client account niet gevonden. Log opnieuw in.' });
      return null;
    }
    let appts = d.appointments.filter(a => a.client === cl.id);
    if (isAgency && s.agencyView !== 'all') appts = appts.filter(a => a.sub === s.agencyView);
    const subName = sid => { const x = (cl.subclients || []).find(y => y.id === sid); return x ? x.name : ''; };

    if (s.route === 'dashboard') return this._clientDash(d, s, cl, appts, subName, isAgency);
    if (s.route === 'appointments') return this._clientAppointments(d, s, cl, appts, subName, isAgency);
    if (s.route === 'billing') return this._clientBilling(d, s, cl, isAgency);
    if (s.route === 'legal') return this._clientLegal(d, s, cl);
    if (s.route === 'support') return this._clientSupport(d, s, cl);
    if (s.route === 'settings') return this._settings(d, s, cl);
    return e('div', null, '');
  },

  _clientDash(d, s, cl, appts, subName, isAgency) {
    const e = React.createElement;
    const live = appts.filter(a => !a.invoiced).slice(0, 12);
    const totalCalls = Object.values(d.dials).reduce((x, o) => x + (o[this.iso(this.today())] || 0), 0);
    const showN = appts.filter(a => a.status === 'show').length;
    const total = appts.filter(a => a.status !== 'open').length || 1;
    const cancN = appts.filter(a => a.status === 'cancel').length;
    const leads = cl.crmOn ? 214 : null;
    const statusBtns = a => e('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      ['show', 'no_show', 'cancel'].map(st => {
        const lab = { show: 'Show', no_show: 'No-show', cancel: 'Cancel' }[st];
        const on = a.status === st;
        const col = { show: 'var(--up)', no_show: 'var(--down)', cancel: 'var(--text-mute)' }[st];
        return e('button', { key: st, onClick: () => this.setApptStatus(a.id, st), style: { padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? col : 'var(--border)'}`, background: on ? 'oklch(0.30 0.10 194 / .3)' : 'transparent', color: on ? col : 'var(--text-mute)' } }, lab);
      }));
    const cols = [
      { label: 'Appt date', render: r => UI.Mono(this.fmtDate(r.dateAppt), { fontSize: 12.5, color: 'var(--text-dim)' }) },
      { label: 'Lead', render: r => e('span', { style: { color: 'var(--text)', fontWeight: 600 } }, r.lead) },
      isAgency ? { label: 'Client', render: r => subName(r.sub) || '—' } : { label: 'Agent', render: r => this.agentName(r.agent, d) },
      { label: 'Status', align: 'center', render: r => UI.statusPill(r.status) },
      { label: 'Set status', align: 'right', render: statusBtns },
    ];
    const quoteSentAll = appts.filter(a => a.quoteSent);
    const totalRevenue = appts.reduce((s, a) => s + (a.dealAmount || 0), 0);
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      UI.Grid('repeat(auto-fit,minmax(180px,1fr))', 14,
        UI.Stat('Afspraken (deze maand)', String(appts.filter(a => !a.invoiced).length), null, 'deze maand'),
        UI.Stat('Shows', String(showN), null, Math.round(showN / total * 100) + '% of set'),
        UI.Stat('Offertes verstuurd', String(quoteSentAll.length), null, quoteSentAll.length ? Math.round(quoteSentAll.length / (showN || 1) * 100) + '% van shows' : 'all time'),
        UI.Stat('Omzet', this.euro(totalRevenue), null, 'all time · goedgekeurde offertes'),
        leads != null ? UI.Stat('Leads in', String(leads), null, 'from ' + cl.crm)
          : null,
        UI.Stat('Cancellations', String(cancN), null, 'this month')),
      UI.C({ padding: 0, overflow: 'hidden' },
        e('div', { style: { padding: '15px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          UI.Hd('Live appointments'), UI.Pill('Real-time', 'var(--accent)', 'oklch(0.30 0.10 194)')),
        UI.Table(cols, live, { min: 680, empty: 'No appointments yet.' })),
      UI.C({},
        UI.SectionHd('Performance', UI.Seg(s.statPer || 'daily', v => this.setState({ statPer: v }), [{ v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' }])),
        UI.Grid('repeat(auto-fit,minmax(160px,1fr))', 16,
          UI.Donut(Math.round(showN / total * 100), 'var(--up)', Math.round(showN / total * 100) + '%', 'Shows vs set'),
          UI.Donut(Math.round(cancN / total * 100), 'var(--down)', Math.round(cancN / total * 100) + '%', 'Cancellation rate'),
          cl.crmOn ? UI.Donut(Math.round(total / (leads || 1) * 100), 'var(--info)', Math.round(total / (leads || 1) * 100) + '%', 'Lead → appt')
            : UI.Donut(0, 'var(--surface-3)', '—', 'Lead → appt (no CRM)'))));
  },

  _clientAppointments(d, s, cl, appts, subName, isAgency) {
    const e = React.createElement;
    const now = new Date();
    const isoDate = d2 => d2.toISOString().slice(0, 10);
    const startOfWeek = () => { const d2 = new Date(now); d2.setDate(d2.getDate() - ((d2.getDay() || 7) - 1)); return isoDate(d2); };
    const endOfWeek = () => { const d2 = new Date(now); d2.setDate(d2.getDate() + (7 - (d2.getDay() || 7))); return isoDate(d2); };
    const lastMonday = () => { const d2 = new Date(now); d2.setDate(d2.getDate() - ((d2.getDay() || 7) - 1) - 7); return isoDate(d2); };
    const lastSunday = () => { const d2 = new Date(now); d2.setDate(d2.getDate() - ((d2.getDay() || 7))); return isoDate(d2); };
    const startOfMonth = () => { const d2 = new Date(now); d2.setDate(1); return isoDate(d2); };
    const yesterday = () => { const d2 = new Date(now); d2.setDate(d2.getDate() - 1); return isoDate(d2); };
    const quickRanges = [
      { l: 'Vandaag', from: isoDate(now), to: isoDate(now) },
      { l: 'Gisteren', from: yesterday(), to: yesterday() },
      { l: 'Deze week', from: startOfWeek(), to: endOfWeek() },
      { l: 'Vorige week', from: lastMonday(), to: lastSunday() },
      { l: 'Deze maand', from: startOfMonth(), to: isoDate(now) },
      { l: 'Vorige maand', from: (() => { const d2 = new Date(now); d2.setDate(1); d2.setMonth(d2.getMonth() - 1); return isoDate(d2); })(), to: (() => { const d2 = new Date(now); d2.setDate(0); return isoDate(d2); })() },
      { l: 'Alles', from: '', to: '' },
    ];
    const cDateFrom = s.cDateFrom !== undefined ? s.cDateFrom : '';
    const cDateTo = s.cDateTo !== undefined ? s.cDateTo : '';
    const activeQuick = quickRanges.find(r => r.from === cDateFrom && r.to === cDateTo) || (cDateFrom === '' && cDateTo === '' ? quickRanges[quickRanges.length - 1] : null);

    let list = this._filterAppts(appts, s);
    if (cDateFrom) list = list.filter(r => (r.dateAppt || r.dateLog || '') >= cDateFrom);
    if (cDateTo) list = list.filter(r => (r.dateAppt || r.dateLog || '') <= cDateTo);
    list = [...list].sort((a, b) => (b.dateAppt || b.dateLog || '').localeCompare(a.dateAppt || a.dateLog || ''));

    const scRate = r => { if (r.sub) { const sc = (cl.subclients || []).find(x => x.id === r.sub || x.name === r.sub); if (sc && sc.rate) return sc.rate; } return cl.rate || 0; };

    const exportCSV = () => {
      const rows = [['Appt Date', 'Booked', 'Lead', 'Phone', 'Agent', 'Client', 'Subclient', 'Status', 'Bedrag']];
      list.forEach(r => {
        const sc = r.sub ? (cl.subclients || []).find(x => x.id === r.sub || x.name === r.sub) : null;
        rows.push([r.dateAppt || '', r.dateLog || '', r.lead || '', r.phone || '', this.agentName(r.agent, d), cl.name || '', sc ? sc.name : '', r.status || '', scRate(r)]);
      });
      const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'afspraken.csv'; a.click();
    };

    // Period filter bar (same style as admin)
    const filterBar = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 } },
      e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' } },
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          ...quickRanges.map(r => e('button', {
            key: r.l,
            onClick: () => this.setState({ cDateFrom: r.from, cDateTo: r.to, cPickOpen: false }),
            style: { padding: '6px 13px', borderRadius: 8, border: '1px solid ' + (activeQuick && activeQuick.l === r.l ? 'var(--accent)' : 'var(--border)'), background: activeQuick && activeQuick.l === r.l ? 'oklch(0.22 0.06 194 / .5)' : 'var(--surface)', color: activeQuick && activeQuick.l === r.l ? 'var(--accent)' : 'var(--text-mute)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }
          }, r.l)),
          e('button', {
            onClick: () => this.setState({ cPickOpen: !s.cPickOpen }),
            style: { padding: '6px 13px', borderRadius: 8, border: '1px solid ' + (!activeQuick && (cDateFrom || cDateTo) ? 'var(--accent)' : 'var(--border)'), background: !activeQuick && (cDateFrom || cDateTo) ? 'oklch(0.22 0.06 194 / .5)' : 'var(--surface)', color: !activeQuick && (cDateFrom || cDateTo) ? 'var(--accent)' : 'var(--text-mute)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }
          }, '📅 ' + (cDateFrom || cDateTo ? (cDateFrom || '…') + ' → ' + (cDateTo || '…') : 'Kies periode'))),
        e('button', { onClick: exportCSV, style: { padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mute)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' } }, '↓ Export CSV')),
      s.cPickOpen ? e('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        e('input', { type: 'date', value: cDateFrom, onChange: ev => this.setState({ cDateFrom: ev.target.value }), style: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' } }),
        e('span', { style: { color: 'var(--text-mute)' } }, '→'),
        e('input', { type: 'date', value: cDateTo, onChange: ev => this.setState({ cDateTo: ev.target.value }), style: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' } })) : null);

    // Agency show summary
    const showSummary = isAgency ? (() => {
      const totalShows = list.filter(r => r.status === 'show').length;
      const totalSet = list.length;
      if (totalSet === 0) return null;
      const subShowMap = {};
      list.forEach(r => {
        if (r.status === 'show') {
          const key = r.sub || '__none__';
          subShowMap[key] = (subShowMap[key] || 0) + 1;
        }
      });
      const subIds = [...new Set(list.map(r => r.sub).filter(Boolean))];
      return e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 } },
        ...subIds.map(subId => {
          const sc = (cl.subclients || []).find(x => x.id === subId || x.name === subId);
          const shows = subShowMap[subId] || 0;
          const set = list.filter(r => r.sub === subId).length;
          return e('div', { key: subId, style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', minWidth: 120 } },
            e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600, marginBottom: 4 } }, sc ? sc.name : subId),
            e('div', { style: { fontFamily: "'Space Grotesk'", fontSize: 22, fontWeight: 700, color: 'var(--up)' } }, shows),
            e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 2 } }, 'shows van ' + set + ' afspraken'));
        }),
        e('div', { style: { background: 'oklch(0.22 0.08 152 / .3)', border: '1px solid oklch(0.35 0.10 152)', borderRadius: 10, padding: '10px 16px', minWidth: 120 } },
          e('div', { style: { fontSize: 11.5, color: 'var(--up)', fontWeight: 600, marginBottom: 4 } }, 'Totaal'),
          e('div', { style: { fontFamily: "'Space Grotesk'", fontSize: 22, fontWeight: 700, color: 'var(--up)' } }, totalShows),
          e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 2 } }, 'shows van ' + totalSet + ' afspraken')));
    })() : null;
    const statusBtns = r => e('div', { style: { display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' } },
      ['open', 'show', 'no_show', 'cancel'].map(st => {
        const on = r.status === st;
        const col = { open: 'var(--info)', show: 'var(--up)', no_show: 'var(--down)', cancel: 'var(--text-mute)' }[st];
        const lbl = { open: 'O', show: 'S', no_show: 'N', cancel: 'C' }[st];
        const title = { open: 'Open', show: 'Show', no_show: 'No-show', cancel: 'Cancel' }[st];
        return e('button', { key: st, onClick: ev => { ev.stopPropagation(); this.setApptStatus(r.id, st); }, style: { width: 26, height: 26, borderRadius: 7, cursor: 'pointer', border: `1px solid ${on ? col : 'var(--border)'}`, background: on ? 'oklch(0.30 0.10 194 / .3)' : 'transparent', color: on ? col : 'var(--text-mute)', fontWeight: 800, fontSize: 12 }, title }, lbl);
      }),
      r.invoiced ? e('button', { onClick: ev => { ev.stopPropagation(); this.requestChange(r.id, r.lead); }, style: { padding: '3px 8px', borderRadius: 7, fontSize: 11, fontWeight: 700, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-mute)', cursor: 'pointer', marginLeft: 4 } }, '✎') : null);

    const dealPill = r => {
      if (r.status !== 'show') return null;
      if (r.quoteApproved) return UI.Pill('Deal ✓', 'var(--up)', 'oklch(0.22 0.08 152 / .4)');
      if (r.quoteSent) return UI.Pill('Quote sent', 'var(--warn)', 'oklch(0.22 0.05 85 / .4)');
      return e('span', { style: { fontSize: 12, color: 'var(--text-mute)', fontStyle: 'italic' } }, '—');
    };
    const cols = [
      { label: 'Booked', render: r => UI.Mono(this.fmtDate(r.dateLog), { fontSize: 12, color: 'var(--text-mute)' }) },
      { label: 'Appt date', render: r => UI.Mono(this.fmtDate(r.dateAppt), { fontSize: 12.5, color: 'var(--text-dim)' }) },
      { label: 'Lead', render: r => e('span', { style: { color: 'var(--text)', fontWeight: 600 } }, r.lead) },
      isAgency ? { label: 'Client', render: r => subName(r.sub) || '—' } : { label: 'Agent', render: r => this.agentName(r.agent, d) },
      { label: 'Status', align: 'center', render: r => UI.statusPill(r.status) },
      { label: 'Offerte', align: 'center', render: r => {
        if (r.status !== 'show') return null;
        if (r.quoteApproved) return UI.Pill('Akkoord', 'var(--up)', 'oklch(0.22 0.08 152 / .4)');
        if (r.quoteSent) return UI.Pill('Verstuurd', 'var(--warn)', 'oklch(0.22 0.05 85 / .4)');
        return e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '—');
      }},
      { label: 'Omzet', align: 'right', render: r => {
        if (r.status !== 'show') return null;
        return r.dealAmount ? UI.Mono(this.euro(r.dealAmount), { fontWeight: 700, color: 'var(--up)' }) : e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '—');
      }},
      isAgency ? { label: 'Bedrag', align: 'right', render: r => UI.Mono(this.euro(scRate(r)), { fontWeight: 700, color: 'var(--info)' }) } : null,
      { label: 'Status bijwerken', align: 'right', render: statusBtns },
    ].filter(Boolean);

    // For agencies showing all subclients: group by subclient
    if (isAgency && s.agencyView === 'all') {
      const groups = {};
      const noSub = [];
      list.forEach(r => { if (r.sub) { if (!groups[r.sub]) groups[r.sub] = []; groups[r.sub].push(r); } else noSub.push(r); });
      const subIds = Object.keys(groups);
      if (subIds.length > 0) {
        return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          this._apptToolbar(d, s),
          filterBar,
          showSummary,
          ...subIds.map(subId => {
            const sc = (cl.subclients || []).find(x => x.id === subId || x.name === subId);
            const scAppts = groups[subId];
            const scTotal = scAppts.reduce((sum, r) => sum + scRate(r), 0);
            return e('div', { key: subId },
              e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px 8px' } },
                e('span', { style: { fontWeight: 700, fontSize: 15 } }, sc ? sc.name : subId),
                e('span', { style: { fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 700, color: 'var(--info)' } }, scAppts.length + ' afspraken · ' + this.euro(scTotal))),
              UI.C({ padding: 0, overflow: 'hidden' }, UI.Table(cols, scAppts.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 720, empty: 'Geen afspraken.' })));
          }),
          noSub.length ? e('div', { key: 'no-sub' },
            e('div', { style: { padding: '10px 4px 8px', fontWeight: 700, fontSize: 15, color: 'var(--text-mute)' } }, 'Overige'),
            UI.C({ padding: 0, overflow: 'hidden' }, UI.Table(cols, noSub.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 720 }))) : null);
      }
    }

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      this._apptToolbar(d, s),
      filterBar,
      showSummary,
      UI.C({ padding: 0, overflow: 'hidden' }, UI.Table(cols, list.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 720, empty: 'No appointments match.' })));
  },

  _clientBilling(d, s, cl, isAgency) {
    const e = React.createElement;
    const now = new Date();
    const storedClose = (d.settings && d.settings.billing_close_date) || null;
    const endOfMonth = storedClose ? new Date(storedClose + 'T23:59:59') : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const daysLeft = Math.ceil((endOfMonth - now) / 86400000);


    // Helper: correct rate for one appointment
    const apptRate = a => {
      if (a.sub) { const sc = (cl.subclients || []).find(x => x.id === a.sub || x.name === a.sub); if (sc && sc.rate) return sc.rate; }
      return cl.rate || 0;
    };

    // Status buttons for billing rows
    const statusBtns = r => e('div', { style: { display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' } },
      ['open', 'show', 'no_show', 'cancel'].map(st => {
        const on = r.status === st;
        const col = { open: 'var(--info)', show: 'var(--up)', no_show: 'var(--down)', cancel: 'var(--text-mute)' }[st];
        const lbl = { open: 'O', show: 'S', no_show: 'N', cancel: 'C' }[st];
        const title = { open: 'Open', show: 'Show', no_show: 'No-show', cancel: 'Geannuleerd' }[st];
        return e('button', { key: st, onClick: ev => { ev.stopPropagation(); this.setApptStatus(r.id, st); }, style: { width: 24, height: 24, borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? col : 'var(--border)'}`, background: on ? 'oklch(0.30 0.10 194 / .3)' : 'transparent', color: on ? col : 'var(--text-mute)', fontWeight: 800, fontSize: 11 }, title }, lbl);
      }));

    // Billing table columns (includes status buttons + subclient col for agencies)
    const isDimmed = r => r.status === 'cancel' || r.status === 'no_show';
    const billingCols = forHistory => [
      { label: 'Datum', render: r => UI.Mono(this.fmtDate(r.dateAppt || r.dateLog), { fontSize: 12, color: isDimmed(r) ? 'var(--text-mute)' : undefined }) },
      { label: 'Lead', render: r => e('span', { style: { fontWeight: 600, color: isDimmed(r) ? 'var(--text-mute)' : 'var(--text)', textDecoration: isDimmed(r) ? 'line-through' : 'none' } }, r.lead) },
      { label: 'Agent', render: r => e('span', { style: { color: isDimmed(r) ? 'var(--text-mute)' : undefined } }, this.agentName(r.agent, d)) },
      isAgency ? { label: 'Client', render: r => { const sc = (cl.subclients || []).find(x => x.id === r.sub || x.name === r.sub); return e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, sc ? sc.name : '—'); } } : null,
      { label: 'Status', align: 'center', render: r => UI.statusPill(r.status) },
      { label: 'Bedrag', align: 'right', render: r => isDimmed(r) ? e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '—') : UI.Mono(this.euro(apptRate(r)), { fontWeight: 700, color: forHistory ? 'var(--text-mute)' : 'var(--info)' }) },
      !forHistory ? { label: 'Status bijwerken', align: 'right', render: statusBtns } : null,
    ].filter(Boolean);


    // Render appointments — grouped by subclient for agencies, sorted newest-first
    const sortNewestFirst = list => [...list].sort((a, b) => (b.dateAppt || b.dateLog || '') > (a.dateAppt || a.dateLog || '') ? 1 : -1);
    const renderAppts = (appts, forHistory) => {
      const sorted = sortNewestFirst(appts);
      if (isAgency && (cl.subclients || []).length > 0) {
        const groups = {};
        const noSub = [];
        sorted.forEach(a => { if (a.sub) { if (!groups[a.sub]) groups[a.sub] = []; groups[a.sub].push(a); } else noSub.push(a); });
        const subIds = Object.keys(groups);
        if (subIds.length > 0) {
          return e('div', null,
            ...subIds.map(subId => {
              const sc = (cl.subclients || []).find(x => x.id === subId || x.name === subId);
              const subAppts = groups[subId];
              const subTotal = subAppts.reduce((s2, a) => s2 + apptRate(a), 0);
              return e('div', { key: subId },
                e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 18px 5px', background: 'oklch(0.14 0.02 256 / .5)', borderTop: '1px solid var(--border-soft)' } },
                  e('span', { style: { fontWeight: 700, fontSize: 12.5 } }, sc ? sc.name : subId),
                  e('span', { style: { fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 700, color: forHistory ? 'var(--text-mute)' : 'var(--info)' } }, subAppts.length + ' · ' + this.euro(subTotal))),
                UI.Table(billingCols(forHistory), subAppts.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 540 }));
            }),
            noSub.length ? e('div', { key: 'nosub' },
              e('div', { style: { padding: '7px 18px 5px', fontWeight: 600, fontSize: 12.5, color: 'var(--text-mute)', background: 'oklch(0.14 0.02 256 / .5)', borderTop: '1px solid var(--border-soft)' } }, 'Overige'),
              UI.Table(billingCols(forHistory), noSub.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 540 })) : null);
        }
      }
      return UI.Table(billingCols(forHistory), sorted.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 480 });
    };

    // Pending: billable but not yet invoiced
    const pending = d.appointments.filter(a => a.client === cl.id && !a.invoiced);
    // Invoiced: already billed
    const invoiced = d.appointments.filter(a => a.client === cl.id && a.invoiced);

    // Group pending by month
    const pendingByMonth = {};
    pending.forEach(a => { const m = (a.dateAppt || a.dateLog || '').slice(0, 7); if (!pendingByMonth[m]) pendingByMonth[m] = []; pendingByMonth[m].push(a); });
    const pendingMonths = Object.keys(pendingByMonth).sort().reverse();

    // Group invoiced by month for history
    const invByMonth = {};
    invoiced.forEach(a => { const m = (a.dateAppt || a.dateLog || '').slice(0, 7); if (!invByMonth[m]) invByMonth[m] = []; invByMonth[m].push(a); });
    const invMonths = Object.keys(invByMonth).sort().reverse();

    const monthLabel = ym => { const d2 = new Date(ym + '-02T00:00:00'); return d2.toLocaleString('nl-BE', { month: 'long', year: 'numeric' }); };
    const billMonthExp = s.billMonthExp || {};
    const invMonthExp = s.invMonthExp || {};
    const billingConfirmed = cl.billing_confirmed || {};

    const confirmStatuses = async (ym, label) => {
      const ts = new Date().toISOString();
      const updated = Object.assign({}, billingConfirmed, { [ym]: ts });
      try {
        await SB.patch('clients', '?id=eq.' + cl.id, { billing_confirmed: updated });
        this.mutLocal(dd => { const c = (dd.clients || []).find(x => x.id === cl.id); if (c) c.billing_confirmed = updated; });
        this._logActivity('billing_confirmed', 'Statussen bevestigd voor ' + label + ' (' + cl.name + ')');
        fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          to: 'quinten@infinite-scale.be',
          subject: '✅ ' + cl.name + ' — statussen bevestigd voor ' + label,
          html: '<div style="font-family:sans-serif;background:#0f1117;color:#e5e7eb;padding:32px;border-radius:12px;max-width:520px;margin:0 auto"><h2 style="color:#fff;margin:0 0 16px">Statussen bevestigd</h2><p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 12px"><strong style="color:#fff">' + cl.name + '</strong> heeft alle afspraken voor <strong style="color:#fff">' + label + '</strong> als bijgewerkt gemarkeerd.</p><p style="color:#6b7280;font-size:13px;margin:0">Bevestigd op: ' + new Date(ts).toLocaleString("nl-BE") + '</p></div>'
        }) }).catch(function() {});
        this.toast('Bevestigd', 'Statussen gemarkeerd als volledig voor ' + label, 'var(--up)');
      } catch(err) {
        this.toast('Fout', 'Kon niet opslaan, probeer opnieuw', 'var(--down)');
      }
    };

    const isUrgent = daysLeft <= 7;
    const isPast = daysLeft < 0;
    const bannerBorderColor = isPast ? 'oklch(0.50 0.18 25)' : isUrgent ? 'oklch(0.50 0.15 60)' : 'oklch(0.40 0.08 256)';
    const bannerBg = isPast ? 'oklch(0.22 0.08 25 / .20)' : isUrgent ? 'oklch(0.30 0.05 85 / .18)' : 'oklch(0.20 0.04 256 / .25)';
    const bannerIconColor = isPast ? 'var(--down)' : isUrgent ? 'var(--warn)' : 'var(--info)';
    const bannerTitle = isPast
      ? 'Deadline verstreken'
      : 'Sluit over ' + daysLeft + ' dag' + (daysLeft !== 1 ? 'en' : '');
    const bannerSub = isPast
      ? 'De factuurperiode is gesloten. Controleer of alle statussen correct zijn.'
      : 'Controleer alle afsprakenstatus vóór ' + endOfMonth.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' }) + '.';

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      UI.C({ borderColor: bannerBorderColor, background: bannerBg },
        UI.Row({},
          e('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: bannerIconColor, strokeWidth: 2 }, e('path', { d: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' })),
          e('div', null,
            e('div', { style: { fontWeight: 700 } }, bannerTitle),
            UI.Sub(bannerSub)))),

      // Status legend
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-mute)' } },
        e('span', { style: { fontWeight: 700, color: 'var(--text-dim)', marginRight: 4 } }, 'Statusverklaring:'),
        ...[
          ['O', 'Open', 'var(--info)'],
          ['S', 'Show', 'var(--up)'],
          ['N', 'No-show', 'var(--down)'],
          ['C', 'Geannuleerd', 'var(--text-mute)'],
        ].map(function(item) {
          return e('span', { key: item[0], style: { display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 10 } },
            e('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, background: item[2] + '22', border: '1.5px solid ' + item[2], fontWeight: 800, fontSize: 11, color: item[2] } }, item[0]),
            e('span', null, item[1]));
        })),

      // Pending invoices section
      UI.C({},
        UI.SectionHd('Openstaande facturen'),
        pendingMonths.length === 0
          ? e('div', { style: { color: 'var(--text-mute)', fontSize: 13, padding: '4px 0 8px' } }, 'Geen openstaande afspraken.')
          : e('div', { style: { display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-soft)' } },
              ...pendingMonths.map((ym, mi) => {
                const appts = pendingByMonth[ym];
                const billable = appts.filter(a => a.status !== 'cancel' && a.status !== 'no_show');
                const total = billable.reduce((s2, a) => s2 + apptRate(a), 0);
                const openCount = appts.filter(a => a.status === 'open').length;
                const showCount = appts.filter(a => a.status === 'show').length;
                const exp = !!billMonthExp[ym];
                const toggle = () => this.setState(st => ({ billMonthExp: { ...(st.billMonthExp || {}), [ym]: !exp } }));
                const isConfirmed = !!billingConfirmed[ym];
                const confirmedAt = billingConfirmed[ym] ? new Date(billingConfirmed[ym]).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
                return e('div', { key: ym },
                  e('div', { onClick: toggle, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', background: exp ? 'oklch(0.18 0.02 256 / .6)' : mi % 2 === 0 ? 'var(--surface)' : 'transparent', borderTop: mi > 0 ? '1px solid var(--border-soft)' : 'none' } },
                    e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
                      e('span', { style: { fontWeight: 700, fontSize: 14, textTransform: 'capitalize' } }, monthLabel(ym)),
                      e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, appts.length + ' afspraken'),
                      e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--info)' } }, this.euro(total)),
                      isConfirmed ? e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--up)', background: 'oklch(0.22 0.08 152 / .35)', padding: '2px 9px', borderRadius: 20 } }, '✓ Overzicht verstuurd') : null),
                    e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: exp ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
                  exp ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)', paddingBottom: 14 } },
                    renderAppts(appts, false),
                    e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px 4px', borderTop: '1px solid var(--border-soft)', marginTop: 4 } },
                      e('div', { style: { fontSize: 12.5 } },
                        e('span', { style: { color: 'var(--up)', fontWeight: 600 } }, showCount + ' bevestigd'),
                        openCount > 0 ? e('span', { style: { color: 'var(--warn)', marginLeft: 12 } }, '⚠ ' + openCount + ' status nog open — wordt gefactureerd') : null),
                      e('span', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 18, color: 'var(--info)' } }, 'Totaal: ' + this.euro(total))),
                    e('div', { style: { padding: '12px 18px 4px', borderTop: '1px solid var(--border-soft)', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
                      isConfirmed
                        ? e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '✓ Verstuurd op ' + confirmedAt)
                        : e('span', { style: { fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.5 } }, 'Zijn alle statussen bijgewerkt? Klik dan op de knop zodat wij kunnen beginnen met factureren.'),
                      isConfirmed
                        ? null
                        : e('button', { onClick: function(ev) { ev.stopPropagation(); confirmStatuses(ym, monthLabel(ym)); }, style: { background: 'var(--up)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' } }, '✓ Statussen volledig bijgewerkt'))) : null);
              }))),

      // Invoice history
      invMonths.length ? UI.C({},
        UI.SectionHd('Factuurhistorie'),
        e('div', { style: { display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-soft)' } },
          ...invMonths.slice(0, 12).map((ym, mi) => {
            const appts = invByMonth[ym];
            const total = appts.reduce((s2, a) => s2 + apptRate(a), 0);
            const exp = !!invMonthExp[ym];
            const toggle = () => this.setState(st => ({ invMonthExp: { ...(st.invMonthExp || {}), [ym]: !exp } }));
            return e('div', { key: ym },
              e('div', { onClick: toggle, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', cursor: 'pointer', background: exp ? 'oklch(0.18 0.02 256 / .6)' : mi % 2 === 0 ? 'var(--surface)' : 'transparent', borderTop: mi > 0 ? '1px solid var(--border-soft)' : 'none' } },
                e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                  e('span', { style: { fontWeight: 700, fontSize: 14, textTransform: 'capitalize' } }, monthLabel(ym)),
                  e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, appts.length + ' afspraken · ' + this.euro(total)),
                  UI.Pill('Gefactureerd', 'var(--up)', 'oklch(0.28 0.06 152 / .3)')),
                e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: exp ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
              exp ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)', paddingBottom: 14 } },
                renderAppts(appts, true),
                e('div', { style: { display: 'flex', justifyContent: 'flex-end', padding: '10px 18px 4px', borderTop: '1px solid var(--border-soft)', marginTop: 4 } },
                  e('span', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 18, color: 'var(--text-mute)' } }, 'Totaal: ' + this.euro(total)))) : null);
          }))) : null);
  },

  _clientLegal(d, s, cl) {
    const e = React.createElement;
    const mine = d.contracts.filter(c =>
      c.party_type !== 'agent' &&
      (c.email === cl.email || c.party === cl.name)
    );
    const openTab = c => {
      const html = c.contract_html || '';
      if (!html) { this.toast('Geen preview', 'Contract HTML niet beschikbaar', 'var(--warn)'); return; }
      const blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    };
    return UI.C({ padding: 0, overflow: 'hidden' },
      e('div', { style: { padding: '15px 18px' } }, UI.Hd('Contracten & documenten', { fontSize: 15 })),
      UI.Table([
        { label: 'Document', render: r => e('span', { style: { color: 'var(--text)', fontWeight: 600 } }, r.type || 'Contract') },
        { label: 'Verstuurd', render: r => UI.Mono(this.fmtFull(r.sent), { fontSize: 12.5 }) },
        { label: 'Vergoeding', render: r => e('span', { style: { color: 'var(--text-dim)' } }, r.value || '—') },
        { label: 'Status', align: 'center', render: r => UI.statusPill(r.status === 'signed' ? 'show' : r.status === 'sent' ? 'open' : 'pending') },
        { label: '', align: 'right', render: r => e('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
          r.contract_html ? UI.Btn('Bekijken', () => openTab(r), 'soft', { padding: '5px 12px', fontSize: 12 }) : null,
          r.contract_html ? UI.Btn('PDF', () => {
            const blob = new Blob([r.contract_html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const w = window.open(url, '_blank');
            if (w) w.addEventListener('load', () => setTimeout(() => w.print(), 300));
          }, 'ghost', { padding: '5px 12px', fontSize: 12 }) : null,
        ) },
      ], mine, { min: 560, empty: 'Nog geen contracten.' }));
  },

  _clientSupport(d, s, cl) {
    const e = React.createElement;
    const mine = d.tickets;
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      UI.Row({ justifyContent: 'space-between' }, UI.Hd('Support tickets'), UI.Btn('New ticket', () => this.openModal('ticket'), 'primary')),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        mine.map(t => UI.C({},
          UI.Row({ justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
              e('span', { style: { fontWeight: 700, fontSize: 15 } }, t.title),
              UI.Pill(t.cat, 'var(--text-dim)', 'var(--bg-2)')),
            UI.Row({}, UI.Mono(t.time, { fontSize: 11.5, color: 'var(--text-mute)' }), UI.statusPill(t.status === 'open' ? 'pending' : t.status === 'in_progress' ? 'open' : 'show'))),
          UI.Sub(t.desc, { lineHeight: 1.5, color: 'var(--text-dim)' })))));
  },
};
