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

    // Group by appointment month
    const monthKey = a => (a.dateAppt || '').slice(0, 7); // "2025-08"
    const allMonths = [...new Set(appts.map(monthKey).filter(Boolean))].sort().reverse();

    const fmtMonth = key => {
      if (!key) return '';
      const [y, m] = key.split('-');
      const label = new Date(+y, +m - 1, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
      return label.charAt(0).toUpperCase() + label.slice(1);
    };

    const now = new Date();
    const thisMonthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    // Use current month if it has data, else most recent month
    const defaultMonth = allMonths.includes(thisMonthKey) ? thisMonthKey : (allMonths[0] || thisMonthKey);
    const selMonth = s.subMonth || defaultMonth;

    const monthAppts = appts.filter(a => monthKey(a) === selMonth);
    const openMonth = monthAppts.filter(a => a.status === 'open');
    const doneMonth = monthAppts.filter(a => a.status !== 'open').sort((a, b) => (b.dateAppt || '') > (a.dateAppt || '') ? 1 : -1);

    // All-time stats
    const totalAll = appts.length;
    const showsAll = appts.filter(a => a.status === 'show').length;
    const noShowsAll = appts.filter(a => a.status === 'no_show').length;
    const openAll = appts.filter(a => a.status === 'open').length;

    const statusBtns = a => e('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      ['show', 'no_show', 'cancel'].map(st => {
        const lab = { show: 'Show', no_show: 'No-show', cancel: 'Cancel' }[st];
        const on = a.status === st;
        const col = { show: 'var(--up)', no_show: 'var(--down)', cancel: 'var(--text-mute)' }[st];
        return e('button', { key: st, onClick: () => this.setApptStatus(a.id, st), style: { padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? col : 'var(--border)'}`, background: on ? (col === 'var(--up)' ? 'oklch(0.28 0.10 152 / .35)' : col === 'var(--down)' ? 'oklch(0.28 0.08 0 / .35)' : 'var(--bg-2)') : 'transparent', color: on ? col : 'var(--text-mute)' } }, lab);
      }));

    const cols = [
      { label: 'Afspraak', render: r => UI.Mono(this.fmtDate(r.dateAppt), { fontSize: 12.5 }) },
      { label: 'Lead', render: r => e('span', { style: { fontWeight: 600 } }, r.lead) },
      { label: 'Status', align: 'center', render: r => UI.statusPill(r.status) },
      { label: 'Update', align: 'right', render: r => statusBtns(r) },
    ];

    // Month tab strip
    const monthTabs = allMonths.length > 0 ? e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      allMonths.map(mk => {
        const active = mk === selMonth;
        const openCount = appts.filter(a => monthKey(a) === mk && a.status === 'open').length;
        return e('button', {
          key: mk,
          onClick: () => this.setState({ subMonth: mk }),
          style: {
            padding: '7px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
            background: active ? 'oklch(0.28 0.10 194 / .35)' : 'transparent',
            color: active ? 'var(--accent)' : 'var(--text-mute)',
          },
        }, fmtMonth(mk) + (openCount > 0 ? ` (${openCount})` : ''));
      })
    ) : null;

    // Open appointments for selected month
    const openSection = openMonth.length > 0
      ? UI.C({ padding: 0, overflow: 'hidden' },
          e('div', { style: { padding: '14px 18px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            UI.Hd('Open afspraken', { fontSize: 15 }),
            e('span', { style: { fontSize: 12, color: 'var(--warn)', fontWeight: 700 } }, openMonth.length + ' open')),
          UI.Table(cols, openMonth, { min: 500, empty: '' }))
      : e('div', { style: { padding: '20px 0', textAlign: 'center', color: 'var(--text-mute)', fontSize: 14 } }, 'Geen open afspraken in ' + fmtMonth(selMonth));

    // Closed appointments for selected month
    const doneSection = doneMonth.length > 0
      ? UI.C({ padding: 0, overflow: 'hidden' },
          e('div', { style: { padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' } },
            UI.Hd('Afgeronde afspraken', { fontSize: 15 })),
          UI.Table(cols, doneMonth, { min: 500, empty: '' }))
      : null;

    // Totals summary (collapsed at bottom)
    const statsRow = e('div', { style: { display: 'flex', gap: 10 } },
      ...[
        { l: 'Totaal', v: totalAll, c: 'var(--text)' },
        { l: 'Shows', v: showsAll, c: 'var(--up)' },
        { l: 'No-shows', v: noShowsAll, c: 'var(--down)' },
        { l: 'Open', v: openAll, c: 'var(--warn)' },
      ].map((x, i) => e('div', { key: i, style: { flex: '1 1 0', padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border-soft)' } },
        e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 } }, x.l),
        e('div', { style: { fontSize: 20, fontWeight: 700, color: x.c, fontFamily: "'Space Grotesk'" } }, x.v))));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 860, margin: '0 auto' } },
      // Header
      e('div', null,
        e('div', { style: { fontSize: 13, color: 'var(--text-mute)', marginBottom: 4 } }, clName + ' — subclient'),
        e('div', { style: { fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: "'Space Grotesk'" } }, scName)),
      // Month tabs
      monthTabs,
      // Open appointments
      openSection,
      // Closed appointments for this month
      doneSection,
      // All-time totals at bottom
      e('div', null,
        e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 } }, 'Totalen alle periodes'),
        statsRow),
    );
  },
};
