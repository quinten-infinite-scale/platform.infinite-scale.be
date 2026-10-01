// Subclient screen — subclients of lead agencies
const ScreenSubclient = {
  scrSubclient(d, s) {
    const e = React.createElement;
    const { scClientId, scSubId, scClientName, scSubName } = this;
    if (!scClientId || !scSubId) return null;
    const scCl = d.clients.find(c => c.id === scClientId);
    const scSubEntry = scCl && (scCl.subclients || []).find(x => x.id === scSubId);
    const clName = scClientName || scCl?.name || scClientId;
    const scName = scSubName || scSubEntry?.name || scSubId;

    const appts = d.appointments.filter(a => a.client === scClientId && a.sub === scSubId);

    const route = s.scRoute || 'appointments';
    const tabBtn = (label, key) => e('button', {
      key,
      onClick: () => this.setState({ scRoute: key }),
      style: {
        padding: '8px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${route === key ? 'var(--accent)' : 'var(--border)'}`,
        background: route === key ? 'oklch(0.28 0.10 194 / .35)' : 'transparent',
        color: route === key ? 'var(--accent)' : 'var(--text-mute)',
      },
    }, label);

    const header = e('div', null,
      e('div', { style: { fontSize: 13, color: 'var(--text-mute)', marginBottom: 4 } }, clName + ' — subclient'),
      e('div', { style: { fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Space Grotesk'" } }, scName));

    const tabs = e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
      tabBtn('Afspraken', 'appointments'),
      tabBtn('Deal tracking', 'deals'),
      tabBtn('Billing', 'billing'));

    if (route === 'deals') return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900, margin: '0 auto' } }, header, tabs, ScreenSubclient._scDeals.call(this, d, s, appts));
    if (route === 'billing') return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900, margin: '0 auto' } }, header, tabs, ScreenSubclient._scBilling.call(this, d, s, appts));
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900, margin: '0 auto' } }, header, tabs, ScreenSubclient._scAppointments.call(this, d, s, appts));
  },

  _scAppointments(d, s, appts) {
    const e = React.createElement;

    // Month grouping
    const monthKey = a => (a.dateAppt || '').slice(0, 7);
    const allMonths = [...new Set(appts.map(monthKey).filter(Boolean))].sort().reverse();
    const fmtMonth = key => {
      if (!key) return '';
      const [y, m] = key.split('-');
      const label = new Date(+y, +m - 1, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
      return label.charAt(0).toUpperCase() + label.slice(1);
    };
    const now = new Date();
    const thisMonthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const defaultMonth = allMonths.includes(thisMonthKey) ? thisMonthKey : (allMonths[0] || thisMonthKey);
    const selMonth = s.subMonth || defaultMonth;
    const monthAppts = appts.filter(a => monthKey(a) === selMonth);

    // All-time stats
    const totalAll = appts.length;
    const showsAll = appts.filter(a => a.status === 'show').length;
    const noShowsAll = appts.filter(a => a.status === 'no_show').length;
    const openAll = appts.filter(a => a.status === 'open').length;
    const dealsAll = appts.filter(a => a.quoteApproved).length;

    const statusBtns = a => e('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      ['show', 'no_show', 'cancel'].map(st => {
        const lab = { show: 'Show', no_show: 'No-show', cancel: 'Cancel' }[st];
        const on = a.status === st;
        const col = { show: 'var(--up)', no_show: 'var(--down)', cancel: 'var(--text-mute)' }[st];
        return e('button', { key: st, onClick: () => this.setApptStatus(a.id, st), style: { padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? col : 'var(--border)'}`, background: on ? (col === 'var(--up)' ? 'oklch(0.28 0.10 152 / .35)' : col === 'var(--down)' ? 'oklch(0.28 0.08 0 / .35)' : 'var(--bg-2)') : 'transparent', color: on ? col : 'var(--text-mute)' } }, lab);
      }));

    const saveDate = (r, newDate) => {
      if (!newDate || newDate === (r.dateAppt || '').slice(0, 10)) return;
      SB.patch('appointments', '?id=eq.' + r.id, { date_appt: newDate });
      this.mutLocal('appointments', a => a.id === r.id ? { ...a, dateAppt: newDate } : a);
    };

    const isDimmed = r => r.status === 'cancel' || r.status === 'no_show';

    const cols = [
      { label: 'Afspraakdatum', render: r => {
        const apptDate = (r.dateAppt || '').slice(0, 10);
        const logDate = (r.dateLog || '').slice(0, 10);
        return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          e('input', { type: 'date', defaultValue: apptDate || logDate, disabled: isDimmed(r), onChange: ev => saveDate(r, ev.target.value), style: { fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", background: 'transparent', border: 'none', borderBottom: isDimmed(r) ? 'none' : '1px dashed var(--border)', color: isDimmed(r) ? 'var(--text-mute)' : 'var(--text)', padding: '1px 2px', cursor: isDimmed(r) ? 'default' : 'pointer', width: 110 } }),
          apptDate && apptDate !== logDate ? e('span', { style: { fontSize: 9.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono', monospace" } }, 'gelogd: ' + logDate) : null);
      } },
      { label: 'Lead', render: r => e('span', { style: { fontWeight: 600 } }, r.lead) },
      { label: 'Status', align: 'center', render: r => e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 } }, UI.statusPill(r.status), r.rescheduled ? e('span', { style: { fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'oklch(0.22 0.06 240 / .35)', color: '#60a5fa', border: '1px solid #60a5fa', letterSpacing: '.04em', textTransform: 'uppercase' } }, 'Herpland') : null) },
      { label: 'Deal', align: 'center', render: r => {
        if (r.status !== 'show') return null;
        if (r.quoteApproved) return UI.Pill('Deal ✓', 'var(--up)', 'oklch(0.22 0.08 152 / .4)');
        if (r.quoteSent) return UI.Pill('Quote sent', 'var(--warn)', 'oklch(0.22 0.05 85 / .4)');
        return e('span', { style: { fontSize: 12, color: 'var(--text-mute)', fontStyle: 'italic' } }, '—');
      } },
      { label: 'Feedback', render: r => {
        const val = s[`fb_${r.id}`] !== undefined ? s[`fb_${r.id}`] : (r.clientFeedback || '');
        return e('div', { style: { display: 'flex', gap: 6, alignItems: 'flex-start', minWidth: 200 } },
          e('textarea', {
            value: val,
            placeholder: 'Feedback…',
            rows: 2,
            onChange: ev => this.setState({ [`fb_${r.id}`]: ev.target.value }),
            style: { flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', outline: 'none' },
          }),
          val !== (r.clientFeedback || '') ? e('button', {
            onClick: () => { this.saveApptFeedback(r.id, val); this.setState({ [`fb_${r.id}`]: undefined }); },
            style: { padding: '5px 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, border: 'none', background: 'var(--accent)', color: 'var(--bg)', cursor: 'pointer', alignSelf: 'flex-start' },
          }, 'Sla op') : null);
      } },
      { label: 'Update', align: 'right', render: r => r.status === 'open' ? statusBtns(r) : null },
    ];

    const monthTabs = allMonths.length > 0 ? e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      allMonths.map(mk => {
        const active = mk === selMonth;
        const openCount = appts.filter(a => monthKey(a) === mk && a.status === 'open').length;
        return e('button', { key: mk, onClick: () => this.setState({ subMonth: mk }), style: { padding: '7px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'oklch(0.28 0.10 194 / .35)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-mute)' } },
          fmtMonth(mk) + (openCount > 0 ? ` (${openCount})` : ''));
      })) : null;

    const statsRow = e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
      ...[
        { l: 'Totaal', v: totalAll, c: 'var(--text)' },
        { l: 'Shows', v: showsAll, c: 'var(--up)' },
        { l: 'No-shows', v: noShowsAll, c: 'var(--down)' },
        { l: 'Open', v: openAll, c: 'var(--warn)' },
        { l: 'Deals', v: dealsAll, c: 'var(--accent)' },
      ].map((x, i) => e('div', { key: i, style: { flex: '1 1 120px', padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border-soft)' } },
        e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 } }, x.l),
        e('div', { style: { fontSize: 20, fontWeight: 700, color: x.c, fontFamily: "'Space Grotesk'" } }, x.v))));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      monthTabs,
      UI.C({ padding: 0, overflow: 'hidden' },
        e('div', { style: { padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' } },
          UI.Hd(fmtMonth(selMonth), { fontSize: 15 })),
        monthAppts.length > 0
          ? UI.Table(cols, monthAppts.sort((a, b) => (b.dateAppt || '') > (a.dateAppt || '') ? 1 : -1), { min: 640, empty: '' })
          : e('div', { style: { padding: '20px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 14 } }, 'Geen afspraken in ' + fmtMonth(selMonth))),
      e('div', null,
        e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 } }, 'Totalen alle periodes'),
        statsRow));
  },

  _scDeals(d, s, appts) {
    const e = React.createElement;
    const shows = appts.filter(a => a.status === 'show');
    const deals = shows.filter(a => a.quoteApproved);
    const quotesSent = shows.filter(a => a.quoteSent && !a.quoteApproved);
    const showToDeal = shows.length ? Math.round(deals.length / shows.length * 100) : 0;

    const statsRow = e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
      ...[
        { l: 'Shows', v: shows.length, c: 'var(--text)' },
        { l: 'Quotes verstuurd', v: quotesSent.length, c: 'var(--warn)' },
        { l: 'Deals gesloten', v: deals.length, c: 'var(--up)' },
        { l: 'Show→Deal', v: showToDeal + '%', c: 'var(--accent)' },
      ].map((x, i) => e('div', { key: i, style: { flex: '1 1 120px', padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border-soft)' } },
        e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 } }, x.l),
        e('div', { style: { fontSize: 20, fontWeight: 700, color: x.c, fontFamily: "'Space Grotesk'" } }, x.v))));

    const dealCols = [
      { label: 'Datum', render: r => UI.Mono(this.fmtDate(r.dateAppt || r.dateLog), { fontSize: 12.5 }) },
      { label: 'Lead', render: r => e('span', { style: { fontWeight: 600 } }, r.lead) },
      { label: 'Quote', align: 'center', render: r => {
        if (r.quoteApproved) return UI.Pill('Deal ✓', 'var(--up)', 'oklch(0.22 0.08 152 / .4)');
        if (r.quoteSent) return UI.Pill('Verstuurd', 'var(--warn)', 'oklch(0.22 0.05 85 / .4)');
        return e('span', { style: { fontSize: 12, color: 'var(--text-mute)', fontStyle: 'italic' } }, '—');
      } },
      { label: 'Dealwaarde', align: 'right', render: r => r.dealAmount ? UI.Mono(this.euro(r.dealAmount), { fontWeight: 700, color: 'var(--up)' }) : e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '—') },
    ];

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      statsRow,
      UI.C({ padding: 0, overflow: 'hidden' },
        e('div', { style: { padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' } },
          UI.Hd('Alle shows', { fontSize: 15 })),
        shows.length > 0
          ? UI.Table(dealCols, shows.sort((a, b) => (b.dateAppt || '') > (a.dateAppt || '') ? 1 : -1), { min: 500, empty: '' })
          : e('div', { style: { padding: '20px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 14 } }, 'Nog geen shows.')));
  },

  _scBilling(d, s, appts) {
    const e = React.createElement;

    const isDimmed = r => r.status === 'cancel' || r.status === 'no_show';

    const saveDate = (r, newDate) => {
      if (!newDate || newDate === (r.dateAppt || '').slice(0, 10)) return;
      SB.patch('appointments', '?id=eq.' + r.id, { date_appt: newDate });
      this.mutLocal('appointments', a => a.id === r.id ? { ...a, dateAppt: newDate } : a);
    };

    const statusBtns = r => e('div', { style: { display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' } },
      ['open', 'show', 'no_show', 'cancel'].map(st => {
        const on = r.status === st;
        const col = { open: 'var(--info)', show: 'var(--up)', no_show: 'var(--down)', cancel: 'var(--text-mute)' }[st];
        const lbl = { open: 'O', show: 'S', no_show: 'N', cancel: 'C' }[st];
        const title = { open: 'Open', show: 'Show', no_show: 'No-show', cancel: 'Geannuleerd' }[st];
        return e('button', { key: st, onClick: ev => { ev.stopPropagation(); this.setApptStatus(r.id, st); }, style: { width: 24, height: 24, borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? col : 'var(--border)'}`, background: on ? 'oklch(0.30 0.10 194 / .3)' : 'transparent', color: on ? col : 'var(--text-mute)', fontWeight: 800, fontSize: 11 }, title }, lbl);
      }));

    const billingCols = forHistory => [
      { label: 'Datum', render: r => {
        const apptDate = (r.dateAppt || '').slice(0, 10);
        const logDate = (r.dateLog || '').slice(0, 10);
        return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          e('input', { type: 'date', defaultValue: apptDate || logDate, disabled: isDimmed(r) || forHistory, onChange: ev => saveDate(r, ev.target.value), style: { fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", background: 'transparent', border: 'none', borderBottom: (isDimmed(r) || forHistory) ? 'none' : '1px dashed var(--border)', color: isDimmed(r) ? 'var(--text-mute)' : 'var(--text)', padding: '1px 2px', cursor: (isDimmed(r) || forHistory) ? 'default' : 'pointer', width: 110 } }),
          apptDate && apptDate !== logDate ? e('span', { style: { fontSize: 9.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono', monospace" } }, 'gelogd: ' + logDate) : null);
      } },
      { label: 'Lead', render: r => e('span', { style: { fontWeight: 600, color: isDimmed(r) ? 'var(--text-mute)' : 'var(--text)', textDecoration: isDimmed(r) ? 'line-through' : 'none' } }, r.lead) },
      { label: 'Status', align: 'center', render: r => e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 } }, UI.statusPill(r.status), r.rescheduled ? e('span', { style: { fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'oklch(0.22 0.06 240 / .35)', color: '#60a5fa', border: '1px solid #60a5fa', letterSpacing: '.04em', textTransform: 'uppercase' } }, 'Herpland') : null) },
      !forHistory ? { label: 'Status bijwerken', align: 'right', render: statusBtns } : null,
    ].filter(Boolean);

    const sortNewestFirst = list => [...list].sort((a, b) => (b.dateAppt || b.dateLog || '') > (a.dateAppt || a.dateLog || '') ? 1 : -1);

    const pending = appts.filter(a => !a.invoiced);
    const invoiced = appts.filter(a => a.invoiced);

    const pendingByMonth = {};
    pending.forEach(a => { const m = (a.dateAppt || a.dateLog || '').slice(0, 7); if (!pendingByMonth[m]) pendingByMonth[m] = []; pendingByMonth[m].push(a); });
    const pendingMonths = Object.keys(pendingByMonth).sort().reverse();

    const invByMonth = {};
    invoiced.forEach(a => { const m = (a.dateAppt || a.dateLog || '').slice(0, 7); if (!invByMonth[m]) invByMonth[m] = []; invByMonth[m].push(a); });
    const invMonths = Object.keys(invByMonth).sort().reverse();

    const monthLabel = ym => { const d2 = new Date(ym + '-02T00:00:00'); return d2.toLocaleString('nl-BE', { month: 'long', year: 'numeric' }); };
    const billMonthExp = s.scBillMonthExp || {};
    const invMonthExp = s.scInvMonthExp || {};

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },

      // Status legend
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-mute)' } },
        e('span', { style: { fontWeight: 700, color: 'var(--text-dim)', marginRight: 4 } }, 'Statusverklaring:'),
        ...[ ['O','Open','var(--info)'], ['S','Show','var(--up)'], ['N','No-show','var(--down)'], ['C','Geannuleerd','var(--text-mute)'] ].map(item =>
          e('span', { key: item[0], style: { display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 10 } },
            e('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, background: item[2] + '22', border: '1.5px solid ' + item[2], fontWeight: 800, fontSize: 11, color: item[2] } }, item[0]),
            e('span', null, item[1])))),

      // Pending
      UI.C({},
        UI.SectionHd('Openstaande afspraken'),
        pendingMonths.length === 0
          ? e('div', { style: { color: 'var(--text-mute)', fontSize: 13, padding: '4px 0 8px' } }, 'Geen openstaande afspraken.')
          : e('div', { style: { display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-soft)' } },
              ...pendingMonths.map((ym, mi) => {
                const mAppts = pendingByMonth[ym];
                const openCount = mAppts.filter(a => a.status === 'open').length;
                const showCount = mAppts.filter(a => a.status === 'show').length;
                const exp = !!billMonthExp[ym];
                const toggle = () => this.setState(st => ({ scBillMonthExp: { ...(st.scBillMonthExp || {}), [ym]: !exp } }));
                return e('div', { key: ym },
                  e('div', { onClick: toggle, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', background: exp ? 'oklch(0.18 0.02 256 / .6)' : mi % 2 === 0 ? 'var(--surface)' : 'transparent', borderTop: mi > 0 ? '1px solid var(--border-soft)' : 'none' } },
                    e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
                      e('span', { style: { fontWeight: 700, fontSize: 14, textTransform: 'capitalize' } }, monthLabel(ym)),
                      e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, mAppts.length + ' afspraken'),
                      openCount > 0 ? e('span', { style: { fontSize: 12, color: 'var(--warn)', fontWeight: 600 } }, '⚠ ' + openCount + ' open') : null),
                    e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: exp ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
                  exp ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)', paddingBottom: 14 } },
                    UI.Table(billingCols(false), sortNewestFirst(mAppts), { min: 480 }),
                    e('div', { style: { padding: '10px 18px 4px', borderTop: '1px solid var(--border-soft)', marginTop: 4 } },
                      e('span', { style: { color: 'var(--up)', fontWeight: 600, fontSize: 12.5 } }, showCount + ' bevestigd'),
                      openCount > 0 ? e('span', { style: { color: 'var(--warn)', marginLeft: 12, fontSize: 12.5 } }, '⚠ ' + openCount + ' status nog open') : null)) : null);
              }))),

      // History
      invMonths.length ? UI.C({},
        UI.SectionHd('Factuurhistorie'),
        e('div', { style: { display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-soft)' } },
          ...invMonths.slice(0, 12).map((ym, mi) => {
            const mAppts = invByMonth[ym];
            const exp = !!invMonthExp[ym];
            const toggle = () => this.setState(st => ({ scInvMonthExp: { ...(st.scInvMonthExp || {}), [ym]: !exp } }));
            return e('div', { key: ym },
              e('div', { onClick: toggle, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', cursor: 'pointer', background: exp ? 'oklch(0.18 0.02 256 / .6)' : mi % 2 === 0 ? 'var(--surface)' : 'transparent', borderTop: mi > 0 ? '1px solid var(--border-soft)' : 'none' } },
                e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                  e('span', { style: { fontWeight: 700, fontSize: 14, textTransform: 'capitalize' } }, monthLabel(ym)),
                  e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, mAppts.length + ' afspraken'),
                  UI.Pill('Gefactureerd', 'var(--up)', 'oklch(0.28 0.06 152 / .3)')),
                e('span', { style: { fontSize: 18, color: 'var(--text-mute)', transform: exp ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
              exp ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)', paddingBottom: 14 } },
                UI.Table(billingCols(true), sortNewestFirst(mAppts), { min: 480 })) : null);
          }))) : null);
  },
};
