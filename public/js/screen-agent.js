// Agent screens: dashboard, log, appointments, eod, payments, clients, stats, settings
const ScreenAgent = {
  scrAgent(d, s) {
    const e = React.createElement;
    const me = d.agents.find(a => a.id === this.myAgentId);
    if (!me) {
      this.setState({ role: null, error: 'Agent account niet gevonden. Log opnieuw in.' });
      return null;
    }
    const today = this.iso(this.today());
    const yest = this.iso(this.daysAgo(1));
    const agDials = (d.dials[me.id] || {});
    const dialsT = agDials[today] || 0, dialsY = agDials[yest] || 1;
    const apT = d.appointments.filter(a => a.agent === me.id && a.dateLog === today);
    const apY = d.appointments.filter(a => a.agent === me.id && a.dateLog === yest);
    const agentPay = a => (me.rates || {})[a.sub] || (me.rates || {})[a.client] || 0;
    const moneyT = apT.reduce((x, a) => x + agentPay(a), 0);
    const moneyY = apY.reduce((x, a) => x + agentPay(a), 0) || 1;
    const pct = (a, b) => Math.round(((a - b) / (b || 1)) * 100);

    if (s.route === 'dashboard') return this._agentDash(d, s, me, { dialsT, dialsY, apT, apY, moneyT, moneyY, pct, today });
    if (s.route === 'log') return this._agentLog(d, s, me);
    if (s.route === 'appointments') return this._agentAppointments(d, s, me);
    if (s.route === 'eod') return this._agentEod(d, s, me, today);
    if (s.route === 'payments') return this._agentPayments(d, s, me);
    if (s.route === 'clients') return this._agentClients(d, s, me);
    if (s.route === 'stats') return this._agentStats(d, s, me);
    if (s.route === 'rooster') return this._agentRooster(d, s, me);
    if (s.route === 'settings') return this._settings(d, s, me);
    return e('div', null, '');
  },

  _agentDash(d, s, me, { dialsT, dialsY, apT, apY, moneyT, moneyY, pct, today }) {
    const e = React.createElement;
    const recent = d.appointments.filter(a => a.agent === me.id).slice(0, 10);
    const recentTable = UI.Table([
      { label: 'Logged', render: r => e('div', null, UI.Mono(this.fmtDate(r.dateLog), { color: 'var(--text-mute)', fontSize: 12 }), r.loggedAt ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 1 } }, new Date(r.loggedAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })) : null) },
      { label: 'Appt date', render: r => UI.Mono(this.fmtDate(r.dateAppt), { color: 'var(--text-dim)', fontSize: 12.5 }) },
      { label: 'Lead', key: 'lead', render: r => e('span', { style: { color: 'var(--text)', fontWeight: 600 } }, r.lead) },
      { label: 'Client', render: r => { const cl = d.clients.find(c => c.id === r.client); const sc = r.sub && cl ? (cl.subclients || []).find(s => s.id === r.sub || s.name === r.sub) : null; return e('div', null, this.clientName(r.client, d), sc ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 1 } }, sc.name) : null); } },
      { label: 'Status', align: 'center', render: r => UI.statusPill(r.status) },
      { label: 'Payout', align: 'right', render: r => { const pay = r.agentRate != null ? r.agentRate : ((me.rates || {})[r.sub] || (me.rates || {})[r.client]); return e('div', { style: { textAlign: 'right' } }, UI.Mono(pay ? this.euro(pay) : '—', { color: pay ? 'var(--up)' : 'var(--text-mute)', fontWeight: 700 }), r.dealCommission != null ? e('div', { style: { fontSize: 10.5, color: 'var(--up)', fontFamily: "'JetBrains Mono'", marginTop: 1, fontWeight: 700 } }, '💰 ' + this.euro(r.dealCommission)) : null); } },
    ], recent.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 680 });

    const period = d.leaderPeriod || 'daily';
    const range = period === 'daily' ? 1 : period === 'weekly' ? 7 : 14;
    const board = d.agents.filter(a => a.active).map(a => {
      let appts = 0, dials = 0;
      for (let i = 0; i < range; i++) {
        const day = this.iso(this.daysAgo(i));
        appts += d.appointments.filter(ap => ap.agent === a.id && ap.dateLog === day).length;
        dials += (d.dials[a.id] || {})[day] || 0;
      }
      return { name: a.name, appts, dials, me: a.id === me.id };
    }).sort((x, y) => y.appts - x.appts);

    const todoList = (me.todos || []).map(t => e('div', { key: t.id, style: { display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' } },
      e('button', {
        onClick: () => this.toggleTodo(t.id, me),
        style: { width: 20, height: 20, borderRadius: 6, flex: 'none', cursor: 'pointer', border: `1.5px solid ${t.done ? 'var(--accent)' : 'var(--border)'}`, background: t.done ? 'var(--accent)' : 'transparent', display: 'grid', placeItems: 'center' }
      }, t.done ? e('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--accent-ink)', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M5 12l5 5L20 6' })) : null),
      e('span', { style: { flex: 1, fontSize: 13.5, color: t.done ? 'var(--text-mute)' : 'var(--text)', textDecoration: t.done ? 'line-through' : 'none', fontWeight: t.done ? 500 : 600 } }, t.text)));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      UI.Grid('repeat(auto-fit,minmax(190px,1fr))', 14,
        UI.Stat('Dials today', String(dialsT), pct(dialsT, dialsY), 'vs ' + dialsY + ' yesterday'),
        UI.Stat('Appointments today', String(apT.length), pct(apT.length, apY.length || 0), 'vs ' + apY.length + ' yesterday'),
        UI.Stat('Money made today', this.euro(moneyT), pct(moneyT, moneyY), 'live, per logged appt'),
      ),
      UI.Grid('minmax(0,2fr) minmax(0,1fr)', 18,
        UI.C({ padding: 0, overflow: 'hidden' },
          e('div', { style: { padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            UI.Hd('Recent appointments'),
            UI.Btn('Log appointment', () => this.openModal('log'), 'primary', { padding: '8px 14px', fontSize: 12.5 })),
          recentTable),
        UI.Col({ gap: 18 },
          UI.C({},
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
              UI.Hd('To-do list', { fontSize: 15 }),
              UI.Btn('Add', () => this.openModal('todo'), 'soft', { padding: '5px 11px', fontSize: 12 })),
            (me.todos || []).length ? todoList : UI.Sub('No tasks. You\'re clear.')),
          UI.C({},
            e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
              UI.Hd('Leaderboard', { fontSize: 15 }),
              UI.Seg(d.leaderPeriod, (v) => this.mutLocal(dd => { dd.leaderPeriod = v; }), [{ v: 'daily', l: 'Day' }, { v: 'weekly', l: 'Week' }, { v: 'monthly', l: 'Month' }])),
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              board.map((b, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, background: b.me ? 'oklch(0.30 0.10 194 / .35)' : 'transparent' } },
                e('span', { style: { width: 22, fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 14, color: i === 0 ? 'var(--accent)' : 'var(--text-mute)' } }, '#' + (i + 1)),
                e('span', { style: { flex: 1, fontSize: 13.5, fontWeight: b.me ? 700 : 600, color: b.me ? 'var(--text)' : 'var(--text-dim)' } }, b.name + (b.me ? ' (you)' : '')),
                UI.Mono(b.appts, { fontWeight: 700, color: 'var(--text)' }))))))),
      UI.C({},
        UI.SectionHd('Updates & events'),
        UI.Grid('repeat(auto-fit,minmax(240px,1fr))', 12,
          ...d.events.map(ev => e('div', { key: ev.id, style: { padding: 14, borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              UI.Pill(ev.tag, 'var(--accent)', 'oklch(0.30 0.10 194)'),
              UI.Mono(this.fmtDate(ev.date), { fontSize: 11, color: 'var(--text-mute)' })),
            e('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 } }, ev.title))))));
  },

  _agentLog(d, s, me) {
    const e = React.createElement; const f = s.form;
    const myClients = d.clients.filter(c => me.clients.includes(c.id));
    const selClient = d.clients.find(c => c.id === f.client);
    const isRenocheck = f.client === 'c15';
    const RN_CATS = ['Airco','Thuisbatt','Zonnepanelen','Ramen en deuren','Keukens','Badkamers','Crepi','Dak'];
    const JaNee = (key) => e('div', { style: { display: 'flex', gap: 6 } },
      ['ja', 'nee'].map(opt => e('button', { key: opt, type: 'button', onClick: () => this.setForm(key, opt),
        style: { padding: '5px 16px', borderRadius: 7, border: '1px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          borderColor: f[key] === opt ? 'var(--accent)' : 'var(--border)',
          background: f[key] === opt ? 'var(--accent)' : 'transparent',
          color: f[key] === opt ? '#fff' : 'var(--text)' } }, opt)));
    const BelMoment = () => {
      const opts = ['Voormiddag (9-12u)', 'Middag (12-14u)', 'Namiddag (14-17u)', 'Avond (17-20u)', 'Maakt niet uit'];
      const sel = f.rnBelmoment || [];
      return e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        opts.map(opt => {
          const on = sel.includes(opt);
          return e('button', { key: opt, type: 'button',
            onClick: () => this.setForm('rnBelmoment', on ? sel.filter(x => x !== opt) : [...sel, opt]),
            style: { padding: '5px 12px', borderRadius: 7, border: '1px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              borderColor: on ? 'var(--accent)' : 'var(--border)',
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? '#fff' : 'var(--text)' } }, opt);
        }));
    };
    const TimingSelect = () => UI.Select(f.rnTiming || '', v => this.setForm('rnTiming', v), [{ v: '', l: 'Selecteer timing…' }, { v: 'Zo snel mogelijk', l: 'Zo snel mogelijk' }, { v: '1-3 maanden', l: '1-3 maanden' }, { v: '3-6 maanden', l: '3-6 maanden' }, { v: '6-12 maanden', l: '6-12 maanden' }, { v: '1 jaar of later', l: '1 jaar of later' }]);
    const SH = (label) => e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 8, borderTop: '1px solid var(--border-soft)', marginTop: 4 } }, label);
    const cat = f.rnCategory;
    const intakeSection = isRenocheck && cat ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      cat === 'Dak' ? [
        SH('Dakgegevens'),
        UI.Grid('1fr 1fr', 10, UI.Field('Eigenaar?', JaNee('rnEigenaar')), UI.Field('Type dak', UI.Select(f.rnTypeDak || '', v => this.setForm('rnTypeDak', v), [{ v: '', l: 'Selecteer…' }, { v: 'Hellend (pannen)', l: 'Hellend (pannen)' }, { v: 'Hellend (leien)', l: 'Hellend (leien)' }, { v: 'Plat', l: 'Plat' }]))),
        UI.Field('Grootte dak (m²)', UI.Input(f.rnGrooteDak || '', v => this.setForm('rnGrooteDak', v), '120')),
        UI.Grid('1fr 1fr', 10, UI.Field('Zonnepanelen aanwezig?', JaNee('rnZonnepanelen')), UI.Field('Zonnepanelen gewenst?', JaNee('rnZonnepanelenGewenst'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Asbest?', JaNee('rnAsbest')), UI.Field('Lekkages?', JaNee('rnLekkages'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Isolatie nodig?', JaNee('rnIsolatieNodig')), UI.Field('Dikte isolatie', UI.Input(f.rnDikteIsolatie || '', v => this.setForm('rnDikteIsolatie', v), 'bespreken met expert'))),
        UI.Field('Kleur dakpannen', UI.Input(f.rnKleurDakpannen || '', v => this.setForm('rnKleurDakpannen', v), 'bespreken met expert')),
        UI.Field('Info project', UI.Area(f.rnInfoProject || '', v => this.setForm('rnInfoProject', v), 'Dak uit 1975, klant meldt lekkage…')),
        UI.Field('Timing', TimingSelect()),
        UI.Grid('1fr 1fr', 10, UI.Field('Financiering?', JaNee('rnFinanciering')), UI.Field('Premie aanvraag?', JaNee('rnPremie'))),
        UI.Field('Voorkeur belmoment', BelMoment()),
      ] : cat === 'Crepi' ? [
        SH('Crepi & Gevel'),
        UI.Grid('1fr 1fr', 10, UI.Field('Eigenaar?', JaNee('rnEigenaar')), UI.Field('Aantal gevels', UI.Input(f.rnAantalGevels || '', v => this.setForm('rnAantalGevels', v), '2'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Voorgevel inbegrepen?', JaNee('rnVoorgevel')), UI.Field('Oprit of rode lijn?', JaNee('rnOprit'))),
        UI.Field('Totaal afmeting (m²)', UI.Input(f.rnAfmeting || '', v => this.setForm('rnAfmeting', v), '100')),
        UI.Grid('1fr 1fr', 10, UI.Field('Isolatie meenemen?', JaNee('rnIsolatieNodig')), UI.Field('Dikte isolatie', UI.Input(f.rnDikteIsolatie || '', v => this.setForm('rnDikteIsolatie', v), 'bespreken met expert'))),
        UI.Field('Gewenste kleur Crepi', UI.Input(f.rnKleurCrepi || '', v => this.setForm('rnKleurCrepi', v), 'bespreken met expert')),
        UI.Field('Info project', UI.Area(f.rnInfoProject || '', v => this.setForm('rnInfoProject', v), 'Voor- en zijgevel renoveren…')),
        UI.Field('Timing', TimingSelect()),
        UI.Grid('1fr 1fr', 10, UI.Field('Financiering?', JaNee('rnFinanciering')), UI.Field('Premie aanvraag?', JaNee('rnPremie'))),
        UI.Field('Voorkeur belmoment', BelMoment()),
      ] : cat === 'Airco' ? [
        SH('Airco'),
        UI.Grid('1fr 1fr', 10, UI.Field('Eigenaar?', JaNee('rnEigenaar')), UI.Field('Type woning', UI.Select(f.rnTypeWoning || '', v => this.setForm('rnTypeWoning', v), [{ v: '', l: 'Selecteer…' }, { v: 'Appartement', l: 'Appartement' }, { v: 'Rijwoning', l: 'Rijwoning' }, { v: 'Halfopen bebouwing', l: 'Halfopen bebouwing' }, { v: 'Vrijstaand', l: 'Vrijstaand' }]))),
        UI.Grid('1fr 1fr', 10, UI.Field('Aantal ruimtes', UI.Input(f.rnAantalRuimtes || '', v => this.setForm('rnAantalRuimtes', v), '3')), UI.Field('Grootte per ruimte', UI.Input(f.rnGrootteRuimte || '', v => this.setForm('rnGrootteRuimte', v), 'bv. 20m², 15m²'))),
        UI.Field('Voorkeur merk', UI.Input(f.rnMerk || '', v => this.setForm('rnMerk', v), 'Geen voorkeur')),
        UI.Grid('1fr 1fr', 10, UI.Field('Meerdere merken vergelijken?', JaNee('rnVergelijken')), UI.Field('Financiering?', JaNee('rnFinanciering'))),
        UI.Field('Info project', UI.Area(f.rnInfoProject || '', v => this.setForm('rnInfoProject', v), 'Klant wil airco plaatsen…')),
        UI.Field('Timing', TimingSelect()),
        UI.Grid('1fr 1fr', 10, UI.Field('Premie aanvraag?', JaNee('rnPremie')), e('div', null)),
        UI.Field('Voorkeur belmoment', BelMoment()),
      ] : cat === 'Ramen en deuren' ? [
        SH('Ramen & Deuren'),
        UI.Grid('1fr 1fr', 10, UI.Field('Eigenaar?', JaNee('rnEigenaar')), UI.Field('Type werk', UI.Select(f.rnTypeWerk || '', v => this.setForm('rnTypeWerk', v), [{ v: '', l: 'Selecteer…' }, { v: 'Ramen', l: 'Ramen' }, { v: 'Deuren', l: 'Deuren' }, { v: 'Ramen & deuren', l: 'Ramen & deuren' }]))),
        UI.Grid('1fr 1fr', 10, UI.Field('Voorkeur materiaal', UI.Select(f.rnMateriaal || '', v => this.setForm('rnMateriaal', v), [{ v: '', l: 'Selecteer…' }, { v: 'PVC', l: 'PVC' }, { v: 'Aluminium', l: 'Aluminium' }, { v: 'Hout', l: 'Hout' }, { v: 'Geen voorkeur', l: 'Geen voorkeur' }])), UI.Field('Type glas', UI.Select(f.rnTypeGlas || '', v => this.setForm('rnTypeGlas', v), [{ v: '', l: 'Selecteer…' }, { v: 'Dubbel glas', l: 'Dubbel glas' }, { v: 'Triple glas', l: 'Triple glas' }, { v: 'Geen voorkeur', l: 'Geen voorkeur' }]))),
        UI.Field('Gewenste kleur (binnen/buiten)', UI.Input(f.rnKleur || '', v => this.setForm('rnKleur', v), 'bv. wit / antraciet')),
        UI.Grid('1fr 1fr', 10, UI.Field('Rolluiken meenemen?', JaNee('rnRolluiken')), UI.Field('Vervanging bestaande?', JaNee('rnVervanging'))),
        UI.Field('Info project', UI.Area(f.rnInfoProject || '', v => this.setForm('rnInfoProject', v), 'Klant wil ramen vervangen…')),
        UI.Field('Timing', TimingSelect()),
        UI.Grid('1fr 1fr', 10, UI.Field('Financiering?', JaNee('rnFinanciering')), UI.Field('Premie aanvraag?', JaNee('rnPremie'))),
        UI.Field('Voorkeur belmoment', BelMoment()),
      ] : cat === 'Thuisbatt' ? [
        SH('Thuisbatterijen'),
        UI.Grid('1fr 1fr', 10, UI.Field('Eigenaar?', JaNee('rnEigenaar')), UI.Field('Doel batterij', UI.Select(f.rnDoelBatterij || '', v => this.setForm('rnDoelBatterij', v), [{ v: '', l: 'Selecteer…' }, { v: 'Zelfconsumptie', l: 'Zelfconsumptie' }, { v: 'Back-up', l: 'Back-up' }, { v: 'Combinatie', l: 'Combinatie' }]))),
        UI.Grid('1fr 1fr', 10, UI.Field('Jaarverbruik (kWh)', UI.Input(f.rnJaarverbruik || '', v => this.setForm('rnJaarverbruik', v), 'weet het niet')), UI.Field('Piekverbruik (kW)', UI.Input(f.rnPiekverbruik || '', v => this.setForm('rnPiekverbruik', v), 'weet het niet'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Gewenste capaciteit (kWh)', UI.Input(f.rnCapaciteit || '', v => this.setForm('rnCapaciteit', v), 'bespreken met expert')), UI.Field('Digitale meter?', JaNee('rnDigitaleMeter'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Voorkeur merk', UI.Input(f.rnMerk || '', v => this.setForm('rnMerk', v), 'Geen voorkeur')), UI.Field('Locatie plaatsing', UI.Input(f.rnLocatie || '', v => this.setForm('rnLocatie', v), 'Garage, kelder…'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Laadpaal meenemen?', JaNee('rnLaadpaal')), UI.Field('Financiering?', JaNee('rnFinanciering'))),
        UI.Field('Info project', UI.Area(f.rnInfoProject || '', v => this.setForm('rnInfoProject', v), 'Klant wil thuisbatterij plaatsen…')),
        UI.Field('Timing', TimingSelect()),
        UI.Grid('1fr 1fr', 10, UI.Field('Premie aanvraag?', JaNee('rnPremie')), e('div', null)),
        UI.Field('Voorkeur belmoment', BelMoment()),
      ] : cat === 'Zonnepanelen' ? [
        SH('Zonnepanelen'),
        UI.Grid('1fr 1fr', 10, UI.Field('Eigenaar?', JaNee('rnEigenaar')), UI.Field('Type installatie', UI.Select(f.rnTypeInstallatie || '', v => this.setForm('rnTypeInstallatie', v), [{ v: '', l: 'Selecteer…' }, { v: 'Nieuwe installatie', l: 'Nieuwe installatie' }, { v: 'Uitbreiding', l: 'Uitbreiding' }]))),
        UI.Grid('1fr 1fr', 10, UI.Field('Jaarverbruik (kWh)', UI.Input(f.rnJaarverbruik || '', v => this.setForm('rnJaarverbruik', v), 'weet het niet')), UI.Field('Type dak', UI.Select(f.rnTypeDak || '', v => this.setForm('rnTypeDak', v), [{ v: '', l: 'Selecteer…' }, { v: 'Hellend (pannen)', l: 'Hellend (pannen)' }, { v: 'Hellend (leien)', l: 'Hellend (leien)' }, { v: 'Plat', l: 'Plat' }, { v: 'Anders', l: 'Anders' }]))),
        UI.Grid('1fr 1fr', 10, UI.Field('Dakoppervlakte (m²)', UI.Input(f.rnGrooteDak || '', v => this.setForm('rnGrooteDak', v), '100')), UI.Field('Oriëntatie dak', UI.Select(f.rnOrientatie || '', v => this.setForm('rnOrientatie', v), [{ v: '', l: 'Selecteer…' }, { v: 'Zuid', l: 'Zuid' }, { v: 'Oost-West', l: 'Oost-West' }, { v: 'Noord', l: 'Noord' }, { v: 'Onbekend', l: 'Onbekend' }]))),
        UI.Grid('1fr 1fr', 10, UI.Field('Schaduw aanwezig?', JaNee('rnSchaduw')), UI.Field('Asbest aanwezig?', JaNee('rnAsbest'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Digitale meter?', JaNee('rnDigitaleMeter')), UI.Field('Thuisbatterij gewenst?', JaNee('rnThuisbatterij'))),
        f.rnThuisbatterij === 'ja' ? UI.Field('Gewenste batterijcapaciteit', UI.Input(f.rnCapaciteit || '', v => this.setForm('rnCapaciteit', v), 'bespreken met expert')) : null,
        UI.Grid('1fr 1fr', 10, UI.Field('Laadpaal gewenst?', JaNee('rnLaadpaal')), UI.Field('Airco gewenst?', JaNee('rnAirco'))),
        UI.Field('Info project', UI.Area(f.rnInfoProject || '', v => this.setForm('rnInfoProject', v), 'Klant wil zonnepanelen plaatsen…')),
        UI.Field('Timing', TimingSelect()),
        UI.Grid('1fr 1fr', 10, UI.Field('Financiering?', JaNee('rnFinanciering')), UI.Field('Premie aanvraag?', JaNee('rnPremie'))),
        UI.Field('Voorkeur belmoment', BelMoment()),
      ] : cat === 'Badkamers' ? [
        SH('Badkamer'),
        UI.Grid('1fr 1fr', 10, UI.Field('Eigenaar?', JaNee('rnEigenaar')), UI.Field('Type project', UI.Select(f.rnTypeProject || '', v => this.setForm('rnTypeProject', v), [{ v: '', l: 'Selecteer…' }, { v: 'Renovatie', l: 'Renovatie' }, { v: 'Nieuwbouw', l: 'Nieuwbouw' }]))),
        UI.Field('Afmeting badkamer (m²)', UI.Input(f.rnAfmeting || '', v => this.setForm('rnAfmeting', v), 'bv. 8')),
        UI.Grid('1fr 1fr', 10, UI.Field('Douche?', JaNee('rnDouche')), UI.Field('Bad?', JaNee('rnBad'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Lavabo?', JaNee('rnLavabo')), UI.Field('Toilet?', JaNee('rnToilet'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Tegelwerk?', JaNee('rnTegelwerk')), UI.Field('Sanitair?', JaNee('rnSanitair'))),
        UI.Grid('1fr 1fr', 10, UI.Field('Loodgieterij/leidingen?', JaNee('rnLoodgieterij')), UI.Field('Elektriciteit?', JaNee('rnElektriciteit'))),
        UI.Field('Info project', UI.Area(f.rnInfoProject || '', v => this.setForm('rnInfoProject', v), 'Klant wil badkamer renoveren…')),
        UI.Field('Timing', TimingSelect()),
        UI.Grid('1fr 1fr', 10, UI.Field('Financiering?', JaNee('rnFinanciering')), UI.Field('Premie aanvraag?', JaNee('rnPremie'))),
        UI.Field('Voorkeur belmoment', BelMoment()),
      ] : cat === 'Keukens' ? [
        SH('Keukens'),
        UI.Grid('1fr 1fr', 10, UI.Field('Eigenaar?', JaNee('rnEigenaar')), UI.Field('Type project', UI.Select(f.rnTypeProject || '', v => this.setForm('rnTypeProject', v), [{ v: '', l: 'Selecteer…' }, { v: 'Renovatie', l: 'Renovatie' }, { v: 'Nieuwbouw', l: 'Nieuwbouw' }]))),
        UI.Field('Afmeting keuken (m²)', UI.Input(f.rnAfmeting || '', v => this.setForm('rnAfmeting', v), 'bv. 15')),
        UI.Field('Info project', UI.Area(f.rnInfoProject || '', v => this.setForm('rnInfoProject', v), 'Klant wil keuken renoveren…')),
        UI.Field('Timing', TimingSelect()),
        UI.Grid('1fr 1fr', 10, UI.Field('Financiering?', JaNee('rnFinanciering')), UI.Field('Premie aanvraag?', JaNee('rnPremie'))),
        UI.Field('Voorkeur belmoment', BelMoment()),
      ] : null
    ) : null;
    const rnForm = isRenocheck ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 12, border: '1px solid var(--accent)', background: 'oklch(0.84 0.16 194 / 0.07)' } },
      e('div', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 } }, 'Renocheck Lead Form'),
      UI.Field('Categorie', UI.Select(f.rnCategory || '', v => this.setForm('rnCategory', v), [{ v: '', l: 'Selecteer categorie…' }, ...RN_CATS.map(c => ({ v: c, l: c }))])),
      UI.Grid('1fr 1fr', 10,
        UI.Field('Voornaam', UI.Input(f.rnFirst || '', v => this.setForm('rnFirst', v), 'Jan')),
        UI.Field('Achternaam', UI.Input(f.rnLast || '', v => this.setForm('rnLast', v), 'Janssens'))),
      UI.Grid('1fr 1fr', 10,
        UI.Field('Telefoon', UI.Input(f.phone, v => this.setForm('phone', v), '+32 470 12 34 56')),
        UI.Field('E-mailadres', UI.Input(f.rnEmail || '', v => this.setForm('rnEmail', v), 'jan@example.be', 'email'))),
      UI.Grid('3fr 1fr', 10,
        UI.Field('Straat', UI.Input(f.rnStreet || '', v => this.setForm('rnStreet', v), 'Korenmarkt')),
        UI.Field('Nr.', UI.Input(f.rnNumber || '', v => this.setForm('rnNumber', v), '12'))),
      UI.Grid('1fr 2fr', 10,
        UI.Field('Postcode', UI.Input(f.rnPostal || '', v => this.setForm('rnPostal', v), '9000')),
        UI.Field('Gemeente', UI.Input(f.rnCity || '', v => this.setForm('rnCity', v), 'Gent'))),
      intakeSection) : null;
    const stdFields = !isRenocheck ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      UI.Field('Lead name', UI.Input(f.lead, v => this.setForm('lead', v), 'Full name of the lead')),
      UI.Field('Phone number', UI.Input(f.phone, v => this.setForm('phone', v), '+32 …', 'text', { autoComplete: 'off' }))) : null;
    return UI.Grid('minmax(0,1.3fr) minmax(0,1fr)', 20,
      UI.C({},
        UI.Hd('Log an appointment'), UI.Sub('Submit and lock. This instantly updates your stats and payments.', { marginBottom: 18, marginTop: 4 }),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          UI.Field('Date of appointment', UI.DatePicker(f.dateAppt, v => this.setForm('dateAppt', v))),
          UI.Field('Client', UI.Select(f.client, v => this.setForm('client', v), [{ v: '', l: 'Select client…' }, ...myClients.map(c => ({ v: c.id, l: c.name }))])),
          selClient && selClient.type === 'agency' ? UI.Field('Client of lead agency', UI.Select(f.sub, v => this.setForm('sub', v), [{ v: '', l: 'Select…' }, ...(selClient.subclients || []).map(sc => ({ v: sc.id, l: sc.name }))])) : null,
          stdFields,
          rnForm,
          e('div', { style: { display: 'flex', gap: 10, marginTop: 6 } },
            UI.Btn('Submit & lock', () => this.logAppointment(), 'primary'),
            UI.Btn('Clear', () => this.setState({ form: {} }), 'soft')),
          f.apptError ? e('div', { style: { marginTop: 10, padding: '10px 14px', borderRadius: 9, background: 'rgba(220,50,50,0.08)', border: '1px solid rgba(220,50,50,0.3)', color: 'var(--down)', fontWeight: 600, fontSize: 13.5 } }, '⚠ ', f.apptError) : null)),
      UI.C({ background: 'var(--bg-2)' },
        UI.Hd('Auto-filled', { fontSize: 15 }),
        e('div', { style: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 } },
          this._kv('Date logged', this.fmtFull(this.iso(this.today()))),
          this._kv('Call agent', me.name),
          this._kv('Your payout', selClient ? this.euro((me.rates || {})[selClient.id] || 0) : '—')),
        e('div', { style: { marginTop: 18, padding: 13, borderRadius: 11, background: 'var(--surface)', border: '1px solid var(--border-soft)', fontSize: 12.5, color: 'var(--text-mute)', lineHeight: 1.5 } },
          'Once submitted the entry is locked. Need a correction? The admin can override it.')));
  },

  _agentAppointments(d, s, me) {
    const e = React.createElement;
    let list = d.appointments.filter(a => a.agent === me.id);
    list = this._filterAppts(list, s);
    const upcoming = list.filter(a => !a.invoiced && !a.paid);
    const past = list.filter(a => a.invoiced || a.paid);
    const cols = [
      { label: 'Logged', render: r => e('div', null, UI.Mono(this.fmtDate(r.dateLog), { fontSize: 12, color: 'var(--text-mute)' }), r.loggedAt ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 1 } }, new Date(r.loggedAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })) : null) },
      { label: 'Appt date', render: r => UI.Mono(this.fmtDate(r.dateAppt), { fontSize: 12.5, color: 'var(--text-dim)' }) },
      { label: 'Lead', render: r => e('span', { style: { color: 'var(--text)', fontWeight: 600 } }, r.lead) },
      { label: 'Client', render: r => { const cl = d.clients.find(c => c.id === r.client); const sc = r.sub && cl ? (cl.subclients || []).find(s => s.id === r.sub || s.name === r.sub) : null; return e('div', null, this.clientName(r.client, d), sc ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 1 } }, sc.name) : null); } },
      { label: 'Status', align: 'center', render: r => UI.statusPill(r.status) },
      { label: 'Payout', align: 'right', render: r => { const pay = r.agentRate != null ? r.agentRate : ((me.rates || {})[r.sub] || (me.rates || {})[r.client]); return e('div', { style: { textAlign: 'right' } }, UI.Mono(pay ? this.euro(pay) : '—', { fontWeight: 700, color: pay ? 'var(--up)' : 'var(--text-mute)' }), r.dealCommission != null ? e('div', { style: { fontSize: 10.5, color: 'var(--up)', fontFamily: "'JetBrains Mono'", marginTop: 1, fontWeight: 700 } }, '💰 ' + this.euro(r.dealCommission)) : null); } },
    ];
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      this._apptToolbar(d, s),
      UI.C({ padding: 0, overflow: 'hidden' }, e('div', { style: { padding: '15px 18px' } }, UI.Hd('Active appointments', { fontSize: 15 })), UI.Table(cols, upcoming.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 700, empty: 'No active appointments match.' })),
      past.length ? e('details', null, e('summary', { style: { cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: 'var(--text-dim)', padding: '10px 4px' } }, `Show invoiced / paid history (${past.length})`), UI.C({ padding: 0, overflow: 'hidden', marginTop: 8 }, UI.Table(cols, past.map(r => ({ ...r, _onClick: () => this.openModal('appointmentDetail', { id: r.id }) })), { min: 700 }))) : null);
  },

  _agentEod(d, s, me, today) {
    const e = React.createElement;
    const mine = d.eods.filter(x => x.agent === me.id);
    const submittedToday = mine.some(x => x.date === today);
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      submittedToday
        ? UI.C({ borderColor: 'oklch(0.45 0.18 194)', background: 'oklch(0.30 0.10 194 / .25)' },
          UI.Row({}, e('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--up)', strokeWidth: 2 }, e('path', { d: 'M5 12l5 5L20 6' })),
            e('div', null, e('div', { style: { fontWeight: 700 } }, 'Today\'s report is submitted'), UI.Sub('Reports lock the platform at 20:00 Belgium time until filed.'))))
        : UI.C({}, UI.Row({ justifyContent: 'space-between', flexWrap: 'wrap' },
          e('div', null, UI.Hd('End-of-day report', { fontSize: 16 }), UI.Sub('Required before 20:00 · the platform locks until you submit.', { marginTop: 4 })),
          UI.Btn('Fill out report', () => this.openModal('eod', { clients: [], calls: {}, appts: {} }), 'primary'))),
      UI.C({ padding: 0, overflow: 'hidden' }, e('div', { style: { padding: '15px 18px' } }, UI.Hd('Past reports', { fontSize: 15 })),
        e('div', { style: { display: 'flex', flexDirection: 'column' } },
          mine.length === 0 ? e('div', { style: { padding: '28px 18px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13, fontStyle: 'italic' } }, 'No past reports yet.') : null,
          mine.map(r => {
            const blocks = r.callBlocks || [];
            const totalMins = blocks.reduce((sum, b) => {
              if (!b.from || !b.to) return sum;
              const [fh, fm] = b.from.split(':').map(Number);
              const [th, tm] = b.to.split(':').map(Number);
              return sum + Math.max(0, (th * 60 + tm) - (fh * 60 + fm));
            }, 0);
            const hoursStr = totalMins > 0 ? Math.floor(totalMins / 60) + 'h ' + (totalMins % 60 > 0 ? (totalMins % 60) + 'm' : '') : null;
            const totalCalls = Object.values(r.calls || {}).reduce((a, v) => a + v, 0);
            const totalAppts = Object.values(r.appts || {}).reduce((a, v) => a + v, 0);
            const dialsToday = Object.values((d.dials[me.id] || {})).length ? ((d.dials[me.id] || {})[r.date] || 0) : null;
            return e('div', { key: r.id, style: { padding: '16px 18px', borderTop: '1px solid var(--border-soft)' } },
              UI.Row({ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
                e('div', null,
                  UI.Mono(this.fmtFull(r.date), { fontWeight: 700, color: 'var(--text)', fontSize: 13.5 }),
                  (r.clients || []).length > 0 ? e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', marginTop: 2 } }, r.clients.map(c => this.clientName(c, d)).join(' · ')) : null),
                e('div', { style: { display: 'flex', gap: 8 } },
                  hoursStr ? e('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'oklch(0.30 0.10 194 / .2)', border: '1px solid oklch(0.45 0.18 194 / .4)', borderRadius: 8, padding: '3px 10px', fontFamily: "'JetBrains Mono'" } }, '⏱ ' + hoursStr) : null,
                  dialsToday !== null ? e('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--text-mute)', background: 'var(--bg-2)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '3px 10px', fontFamily: "'JetBrains Mono'" } }, dialsToday + ' dials') : null)),
              (r.clients || []).length > 0 ? e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8, marginBottom: 10 } },
                (r.clients || []).map(c => e('div', { key: c, style: { padding: '10px 13px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
                  e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600, marginBottom: 4 } }, this.clientName(c, d)),
                  e('div', { style: { display: 'flex', gap: 10 } },
                    e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'JetBrains Mono'" } }, (r.calls[c] || 0) + ' calls'),
                    e('span', { style: { fontSize: 13, color: 'var(--text-mute)' } }, '·'),
                    e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--info)', fontFamily: "'JetBrains Mono'" } }, (r.appts[c] || 0) + ' appts'))))) : null,
              blocks.length > 0 ? e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 } },
                e('span', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600, alignSelf: 'center', marginRight: 2 } }, 'Hours:'),
                blocks.map((b, i) => e('span', { key: i, style: { fontSize: 12, fontFamily: "'JetBrains Mono'", color: 'var(--accent)', background: 'oklch(0.30 0.10 194 / .15)', border: '1px solid oklch(0.45 0.18 194 / .3)', padding: '2px 9px', borderRadius: 6 } }, b.from + ' – ' + b.to))) : null,
              e('div', { style: { fontSize: 12.5, color: 'var(--text-mute)', lineHeight: 1.6 } },
                r.well ? e('div', null, e('b', { style: { color: 'var(--text-dim)' } }, 'Win: '), r.well) : null,
                r.bad ? e('div', null, e('b', { style: { color: 'var(--text-dim)' } }, 'Bad: '), r.bad) : null,
                r.goal ? e('div', null, e('b', { style: { color: 'var(--text-dim)' } }, 'Goal: '), r.goal) : null));
          }))));
  },

  _agentPayments(d, s, me) {
    const e = React.createElement;
    const now2 = new Date();
    const iso2 = d2 => { const y = d2.getFullYear(), m = String(d2.getMonth()+1).padStart(2,'0'), day = String(d2.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
    const currentYM = iso2(now2).slice(0, 7);

    // Earnings graph
    const payPeriod = s.payPeriod || 'daily';
    const payOffset = s.payOffset || 0;
    const payBuckets = [];
    if (payPeriod === 'daily') {
      const END = payOffset * 30;
      for (let i = END + 29; i >= END; i--) {
        const d2 = new Date(now2); d2.setDate(d2.getDate() - i);
        const key = iso2(d2);
        payBuckets.push({ label: key.slice(5), key, appts: [] });
      }
    } else if (payPeriod === 'weekly') {
      const base = new Date(now2);
      const dow = base.getDay() || 7; base.setDate(base.getDate() - (dow - 1));
      const END = payOffset * 12;
      for (let i = END + 11; i >= END; i--) {
        const wS = new Date(base); wS.setDate(wS.getDate() - i * 7);
        const wE = new Date(wS); wE.setDate(wE.getDate() + 6);
        payBuckets.push({ label: iso2(wS).slice(5), wStart: iso2(wS), wEnd: iso2(wE), appts: [] });
      }
    } else {
      const END = payOffset * 12;
      for (let i = END + 11; i >= END; i--) {
        const d2 = new Date(now2); d2.setDate(1); d2.setMonth(d2.getMonth() - i);
        const ym = iso2(d2).slice(0, 7);
        payBuckets.push({ label: d2.toLocaleString('en', { month: 'short' }) + " '" + iso2(d2).slice(2, 4), ym, appts: [] });
      }
    }
    for (const a of d.appointments) {
      if (a.agent !== me.id || a.status === 'cancel') continue;
      for (const b of payBuckets) {
        const aDate = a.dateLog || '';
        if (payPeriod === 'daily' && b.key === aDate) { b.appts.push(a); break; }
        if (payPeriod === 'weekly' && aDate >= b.wStart && aDate <= b.wEnd) { b.appts.push(a); break; }
        if (payPeriod === 'monthly' && aDate.startsWith(b.ym)) { b.appts.push(a); break; }
      }
    }
    const payLabels = payBuckets.map(b => b.label);
    const payEarnings = payBuckets.map(b => b.appts.reduce((x, a) => x + ((me.rates || {})[a.sub] || (me.rates || {})[a.client] || 0) + (a.dealCommission || 0), 0));
    const payAppts = payBuckets.map(b => b.appts.length);
    const earningsGraph = UI.C({},
      UI.Row({ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
        UI.Hd('Earnings over time', { fontSize: 15 }),
        UI.Row({ gap: 8 },
          e('div', { style: { display: 'flex', gap: 4 } },
            e('button', { onClick: () => this.setState({ payOffset: payOffset + 1 }), style: { width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 15 } }, '←'),
            payOffset > 0 ? e('button', { onClick: () => this.setState({ payOffset: payOffset - 1 }), style: { width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 15 } }, '→') : null),
          UI.Seg(payPeriod, v => this.setState({ payPeriod: v, payOffset: 0 }), [{ v: 'daily', l: 'Day' }, { v: 'weekly', l: 'Week' }, { v: 'monthly', l: 'Month' }]))),
      UI.Hd('Earnings (€)', { fontSize: 13, marginBottom: 6, color: 'var(--text-mute)', fontWeight: 600 }),
      UI.Line(payEarnings, 'var(--up)', payLabels.filter((_, i) => i % Math.ceil(payLabels.length / 8) === 0), v => this.euro(v)),
      e('div', { style: { marginTop: 16 } },
        UI.Hd('Appointments', { fontSize: 13, marginBottom: 6, color: 'var(--text-mute)', fontWeight: 600 }),
        UI.Bars(payLabels.map((l, i) => ({ label: l, value: payAppts[i] })), 'var(--info)')));

    const apptThisMonth = a => a.agent === me.id && (a.dateLog || '').startsWith(currentYM);
    const running = d.appointments.filter(a => apptThisMonth(a) && a.status !== 'cancel').reduce((x, a) => x + ((me.rates || {})[a.sub] || (me.rates || {})[a.client] || 0) + (a.dealCommission || 0), 0);
    const confirmed = d.appointments.filter(a => apptThisMonth(a) && a.status === 'show').reduce((x, a) => x + ((me.rates || {})[a.sub] || (me.rates || {})[a.client] || 0) + (a.dealCommission || 0), 0);
    const months = [];
    for (let i = 0; i < 12; i++) {
      const m = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
      const ym = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
      months.push({ ym, label: m.toLocaleString('en', { month: 'long', year: 'numeric' }) });
    }
    const invApproved = s.invApproved || {};
    const invExpanded = !!s.agentInvExpanded;
    const monthData = ym => {
      const appts = d.appointments.filter(a => a.agent === me.id && a.status === 'show' && (a.dateAppt || '').startsWith(ym));
      return { count: appts.length, total: appts.reduce((s2, a) => s2 + ((me.rates || {})[a.sub] || (me.rates || {})[a.client] || 0), 0) };
    };
    // Only show past months in approval list — current month is still open
    const monthsWithData = months.filter(({ ym }) => ym < currentYM && monthData(ym).count > 0);

    // Management fee section — only for Senne (a1), computed from d.appointments
    const isSenne = me.id === 'a1';
    const mfExpanded = !!s.mfExpanded;
    const mfSection = isSenne ? (() => {
      const clientRate = ap => {
        const cl = d.clients.find(c => c.id === ap.client);
        const sc = ap.sub && cl ? (cl.subclients || []).find(sc2 => sc2.id === ap.sub || sc2.name === ap.sub) : null;
        return sc && sc.rate != null ? sc.rate : (cl ? cl.rate || 0 : 0);
      };
      const otherShows = d.appointments.filter(a => a.agent !== me.id && a.status === 'show');
      // Group by ym
      const byYm = {};
      for (const ap of otherShows) {
        const ym2 = (ap.dateAppt || ap.dateLog || '').slice(0, 7); if (!ym2) continue;
        if (!byYm[ym2]) byYm[ym2] = [];
        byYm[ym2].push(ap);
      }
      const feeMonths = Object.entries(byYm).sort((a, b) => b[0] < a[0] ? -1 : 1).map(([ym2, apList]) => {
        const agMap = {};
        for (const ap of apList) {
          const ag = d.agents.find(g => g.id === ap.agent);
          const clRate = clientRate(ap);
          const agRate = ap.agentRate != null ? ap.agentRate : ((ag && ag.rates) ? (ag.rates[ap.sub] || ag.rates[ap.client] || 0) : 0);
          const profit = clRate - agRate;
          const commission = profit > 0 ? Math.round(profit * 0.15 * 100) / 100 : 0;
          if (!agMap[ap.agent]) agMap[ap.agent] = { id: ap.agent, name: ag ? ag.name : '?', count: 0, revenue: 0, fee: 0 };
          agMap[ap.agent].count++;
          agMap[ap.agent].revenue += profit > 0 ? profit : 0;
          agMap[ap.agent].fee += commission;
        }
        const agents2 = Object.values(agMap).sort((a, b) => b.fee - a.fee);
        const fee = Math.round(agents2.reduce((s2, a) => s2 + a.fee, 0) * 100) / 100;
        const agentRevenue = Math.round(agents2.reduce((s2, a) => s2 + a.revenue, 0) * 100) / 100;
        return { ym: ym2, fee, agentRevenue, count: apList.length, agents: agents2 };
      });
      const feeNow = (feeMonths.find(m => m.ym === currentYM) || {}).fee ?? null;
      return e('div', { style: { borderRadius: 14, border: '1px solid var(--border-soft)', overflow: 'hidden' } },
        e('div', { onClick: () => this.setState(st => ({ mfExpanded: !st.mfExpanded })), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', background: mfExpanded ? 'var(--bg-2)' : 'var(--surface)' } },
          e('div', null,
            e('div', { style: { fontWeight: 700, fontSize: 15 } }, 'Management Fee (15%)'),
            e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginTop: 3 } },
              s._mfLoading ? 'Laden…'
              : s._mfErr ? '⚠ ' + s._mfErr
              : feeNow !== null ? 'Deze maand: ' + this.euro(feeNow) + ' · klik om uit te klappen'
              : 'Klik om uit te klappen')),
          e('span', { style: { fontSize: 20, color: 'var(--text-mute)', transform: mfExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
        mfExpanded ? e('div', { style: { borderTop: '1px solid var(--border-soft)' } },
          e('div', { style: { padding: '14px 22px 10px', fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.6 } },
            '15% van de omzet gegenereerd door de andere callagents. Berekend op basis van hun shows en hun tarieven per klant.'),
          feeMonths.length === 0 && !s._mfLoading
            ? e('div', { style: { padding: '16px 22px', fontSize: 13, color: 'var(--text-mute)' } }, 'Nog geen data beschikbaar.')
            : feeMonths.map(({ ym, fee, agentRevenue, count, agents }) => {
                const label = new Date(ym + '-02').toLocaleString('nl', { month: 'long', year: 'numeric' });
                const isCurrent = ym === currentYM;
                const mfMonthKey = '_mfOpen_' + ym;
                const monthOpen = !!s[mfMonthKey];
                return e('div', { key: ym, style: { borderBottom: '1px solid var(--border-soft)' } },
                  e('div', { onClick: () => this.setState(st => ({ [mfMonthKey]: !st[mfMonthKey] })), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px', cursor: 'pointer' } },
                    e('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                        e('span', { style: { fontSize: 14, fontWeight: 600 } }, label),
                        isCurrent ? UI.Pill('Lopend', 'var(--info)', 'oklch(0.22 0.05 220 / .4)') : null),
                      e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, count + ' shows · omzet andere agents: ' + this.euro(agentRevenue))),
                    e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                      e('span', { style: { fontSize: 15, fontWeight: 700, color: 'var(--up)', fontFamily: 'var(--mono, monospace)' } }, this.euro(fee)),
                      e('span', { style: { fontSize: 16, color: 'var(--text-mute)', transform: monthOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›'))),
                  monthOpen && agents && agents.length > 0
                    ? e('div', { style: { background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)', padding: '10px 22px 12px' } },
                        e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 } }, 'Per agent'),
                        agents.map(ag => {
                          const agApptKey = '_mfAgOpen_' + ym + '_' + ag.id;
                          const agOpen = !!s[agApptKey];
                          const agAppts = d.appointments.filter(ap =>
                            ap.agent === ag.id &&
                            ap.status === 'show' &&
                            (ap.dateLog || '').startsWith(ym)
                          ).sort((a, b) => (a.dateLog || '') < (b.dateLog || '') ? -1 : 1);
                          return e('div', { key: ag.id },
                            e('div', {
                              onClick: () => this.setState(st => ({ [agApptKey]: !st[agApptKey] })),
                              style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border-soft)', cursor: agAppts.length ? 'pointer' : 'default' }
                            },
                              e('div', { style: { display: 'flex', flexDirection: 'column', gap: 1 } },
                                e('span', { style: { fontSize: 13, fontWeight: 600 } }, ag.name),
                                e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, ag.count + ' shows · ' + this.euro(ag.revenue))),
                              e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                                e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--up)', fontFamily: 'var(--mono, monospace)' } }, this.euro(ag.fee)),
                                agAppts.length ? e('span', { style: { fontSize: 13, color: 'var(--text-mute)', transform: agOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›') : null)),
                            agOpen && agAppts.length > 0
                              ? e('div', { style: { paddingLeft: 10, paddingBottom: 6 } },
                                  agAppts.map(ap => {
                                    const cl = d.clients.find(c => c.id === ap.client);
                                    const sc = ap.sub && cl ? (cl.subclients || []).find(s => s.id === ap.sub || s.name === ap.sub) : null;
                                    const rate = sc && sc.rate != null ? sc.rate : (cl ? cl.rate || 0 : 0);
                                    const commission = Math.round(rate * 0.15 * 100) / 100;
                                    return e('div', { key: ap.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 4px', borderBottom: '1px solid var(--border-soft)', gap: 10 } },
                                      e('div', { style: { flex: 1, minWidth: 0 } },
                                        e('div', { style: { fontSize: 12.5, fontWeight: 600 } }, ap.lead || '—'),
                                        e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 1 } }, [
                                          sc ? sc.name : (cl ? cl.name : ''),
                                          ap.dateAppt ? this.fmtDate(ap.dateAppt) : null
                                        ].filter(Boolean).join(' · '))),
                                      e('div', { style: { textAlign: 'right', flexShrink: 0 } },
                                        e('div', { style: { fontSize: 12, fontFamily: "'JetBrains Mono'", color: 'var(--up)', fontWeight: 700 } }, this.euro(commission)),
                                        e('div', { style: { fontSize: 10, color: 'var(--text-mute)' } }, '15% v. ' + this.euro(rate))));
                                  }))
                              : null);
                        }))
                    : null);
              })
        ) : null);
    })() : null;

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      UI.Grid('repeat(auto-fit,minmax(190px,1fr))', 14,
        UI.Stat('Lopend deze maand', this.euro(running), null, 'open + shows · excl. cancels'),
        UI.Stat('Bevestigde shows', this.euro(confirmed), null, 'enkel shows deze maand'),
        UI.Stat('Lifetime paid', this.euro(me.lifetime || 0), null, 'since you joined')),
      earningsGraph,
      mfSection,
      e('div', { style: { borderRadius: 14, border: '1px solid var(--border-soft)', overflow: 'hidden' } },
        e('div', { onClick: () => this.setState(st => ({ agentInvExpanded: !st.agentInvExpanded })), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', background: invExpanded ? 'var(--bg-2)' : 'var(--surface)' } },
          e('div', null,
            e('div', { style: { fontWeight: 700, fontSize: 15 } }, 'Approval of Invoices'),
            e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginTop: 3 } }, 'Monthly invoice approvals — click to expand')),
          e('span', { style: { fontSize: 20, color: 'var(--text-mute)', transform: invExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
        invExpanded ? e('div', { style: { borderTop: '1px solid var(--border-soft)' } },
          monthsWithData.map(({ ym, label }) => {
            const { count, total } = monthData(ym);
            const approvedKey = me.id + '-' + ym;
            const isApproved = !!invApproved[approvedKey];
            return e('div', { key: ym, onClick: () => this.openModal('invoiceReview', { agentId: me.id, ym, label, readOnly: true }), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' } },
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                e('span', { style: { fontSize: 14, fontWeight: 600 } }, label),
                e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, count > 0 ? count + ' shows \xb7 ' + this.euro(total) : 'No shows yet')),
              isApproved
                ? UI.Pill('Approved', 'var(--up)', 'oklch(0.28 0.06 152 / .4)')
                : ym === currentYM
                  ? UI.Pill('Open', 'var(--info)', 'oklch(0.22 0.05 220 / .4)')
                  : UI.Pill('Open', 'var(--warn)', 'oklch(0.25 0.05 85 / .4)'));
          })
        ) : null));
  },

  _agentClients(d, s, me) {
    const e = React.createElement;
    const mine = d.clients.filter(c => (me.clients || []).includes(c.id));
    return UI.Grid('repeat(auto-fit,minmax(260px,1fr))', 16,
      ...mine.map(c => UI.C({},
        UI.Row({ justifyContent: 'space-between', marginBottom: 10 }, UI.Hd(c.name, { fontSize: 16 }), UI.statusPill(c.status || 'inactive')),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 } },
          this._kv('Type', c.type === 'agency' ? 'Lead agency' : 'Direct client'),
          this._kv('Your rate', this.euro((me.rates || {})[c.id] || c.rate) + ' / appt' + (c.type === 'agency' && (c.subclients || []).length ? ' (agency)' : '')),
          this._kv('Active appts', String(d.appointments.filter(a => a.agent === me.id && a.client === c.id && !a.invoiced).length))),
        c.type === 'agency' && (c.subclients || []).length ? e('div', { style: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)' } },
          UI.Sub('Payout per subclient'),
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7 } }, (c.subclients || []).map(sc => {
            const scRate = (me.rates || {})[sc.id];
            return e('div', { key: sc.id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
              e('span', { style: { fontSize: 12.5, color: 'var(--text-dim)' } }, sc.name),
              UI.Mono(scRate ? this.euro(scRate) + '/appt' : '—', { fontSize: 12, color: scRate ? 'var(--up)' : 'var(--text-mute)' }));
          }))) : null)));
  },

  _agentStats(d, s, me) {
    const e = React.createElement; const per = s.statPer || 'weekly';
    const range = per === 'daily' ? 1 : per === 'weekly' ? 7 : 14;
    const dialSeries = [], apptSeries = [], labels = [];
    for (let i = range - 1; i >= 0; i--) {
      const day = this.iso(this.daysAgo(i));
      dialSeries.push((d.dials[me.id] || {})[day] || 0);
      apptSeries.push(d.appointments.filter(a => a.agent === me.id && a.dateLog === day).length);
      labels.push(this.fmtDate(day));
    }
    const totalShow = d.appointments.filter(a => a.agent === me.id && a.status === 'show').length;
    const totalAppt = d.appointments.filter(a => a.agent === me.id && a.status !== 'open').length || 1;

    // Fetch CloudTalk dials lazily when this tab is first rendered
    if (!s._ctLoaded && !s._ctLoading) {
      this.setState({ _ctLoading: true });
      fetch('/api/cloudtalk-stats').then(r => r.json()).then(j => {
        this.setState({ _ctLoaded: true, _ctLoading: false, _ctToday: j.today, _ctWeek: j.week, _ctMonth: j.month, _ctErr: j.ok ? null : (j.error || 'error') });
      }).catch(err => {
        this.setState({ _ctLoaded: true, _ctLoading: false, _ctErr: err.message });
      });
    }

    const fmt = v => v === null || v === undefined ? '—' : String(v);
    const ctRow = UI.Grid('repeat(3,minmax(0,1fr))', 14,
      UI.Stat('Dials vandaag', s._ctLoading ? '…' : fmt(s._ctToday), null, s._ctErr ? '⚠ ' + s._ctErr : 'inbound + outbound'),
      UI.Stat('Dials deze week', s._ctLoading ? '…' : fmt(s._ctWeek), null, 'inbound + outbound'),
      UI.Stat('Dials deze maand', s._ctLoading ? '…' : fmt(s._ctMonth), null, 'inbound + outbound'));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      ctRow,
      UI.Row({ justifyContent: 'flex-end' }, UI.Seg(per, v => this.setState({ statPer: v }), [{ v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' }])),
      UI.Grid('minmax(0,2fr) minmax(0,1fr)', 18,
        UI.C({}, UI.Hd('Dials over time', { fontSize: 15, marginBottom: 6 }), UI.Line(dialSeries, 'var(--accent)', labels.filter((_, i) => i % Math.ceil(labels.length / 6) === 0), v => String(v) + ' dials')),
        UI.C({ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }, UI.Donut(Math.round((totalShow / totalAppt) * 100), 'var(--up)', Math.round((totalShow / totalAppt) * 100) + '%', 'Show rate'))),
      UI.C({}, UI.Hd('Appointments booked', { fontSize: 15, marginBottom: 10 }), UI.Bars(labels.map((l, i) => ({ label: l, value: apptSeries[i] })), 'var(--info)')));
  },

  _agentRooster(d, s, me) {
    const e = React.createElement;
    const HOURS = [7,8,9,10,11,12,13,14,15,16,17,18,19,20];
    const DAYS  = [0,1,2,3,4,5,6];
    const DAY_S = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
    const COLORS = ['#0891b2','#7c3aed','#059669','#d97706','#dc2626','#db2777','#2563eb','#0e7490'];

    const today = this.iso(this.today());
    const weekStart = s.schedWeek || this._weekStart(today);
    const view = s.schedView || 'week';

    const weekDates = DAYS.map(i => {
      const dt = new Date(weekStart + 'T12:00:00');
      dt.setDate(dt.getDate() + i);
      return dt.toISOString().slice(0, 10);
    });

    const saved = (d.schedules || []).find(sc => sc.agent_id === me.id && sc.week_start === weekStart);
    const slots  = s.schedSlots !== undefined ? s.schedSlots : (saved ? saved.slots : []);

    const myClients = (d.clients || []).filter(c => (me.clients || []).includes(c.id));
    const getColor  = cid => { const i = myClients.findIndex(c => c.id === cid); return i >= 0 ? COLORS[i % COLORS.length] : '#888'; };
    const selected  = s.schedSelected !== undefined ? s.schedSelected : (myClients[0] ? myClients[0].id : '__clear__');

    const getSlot  = (day, hour) => slots.find(sl => sl.day === day && sl.hour === hour);

    const paint = (day, hour) => {
      const existing = getSlot(day, hour);
      let next;
      if (selected === '__clear__') {
        next = slots.filter(sl => !(sl.day === day && sl.hour === hour));
      } else if (existing && existing.clientId === selected) {
        next = slots.filter(sl => !(sl.day === day && sl.hour === hour));
      } else {
        next = slots.filter(sl => !(sl.day === day && sl.hour === hour));
        next.push({ day, hour, clientId: selected });
      }
      this.setState({ schedSlots: next, schedDirty: true });
    };

    const paintDay = (dayIdx) => {
      if (selected === '__clear__') {
        this.setState({ schedSlots: slots.filter(sl => sl.day !== dayIdx), schedDirty: true });
      } else if (selected === '__off__') {
        const without = slots.filter(sl => sl.day !== dayIdx);
        without.push({ day: dayIdx, hour: '__off__', clientId: '__off__' });
        this.setState({ schedSlots: without, schedDirty: true });
      }
    };

    const isDayOff = (dayIdx) => slots.some(sl => sl.day === dayIdx && sl.clientId === '__off__');

    const save = async () => {
      try {
        const agentId = me.id || this.myAgentId;
        if (!agentId) throw new Error('Geen agent ID');
        const ok = await API.saveSchedule(agentId, weekStart, slots);
        if (ok === false) throw new Error('DB weigerde opslaan');
        this.mutLocal(dd => {
          if (!dd.schedules) dd.schedules = [];
          const idx = dd.schedules.findIndex(sc => sc.agent_id === agentId && sc.week_start === weekStart);
          if (idx >= 0) dd.schedules[idx].slots = slots;
          else dd.schedules.push({ agent_id: agentId, week_start: weekStart, slots });
        });
        this.setState({ schedDirty: false });
        this._logActivity('rooster_saved', 'Saved weekly schedule for week of ' + weekStart + ' (' + (slots || []).length + ' slots)');
        this.toast('Opgeslagen', 'Rooster opgeslagen', 'var(--up)');
      } catch (err) { this.toast('Fout', 'Opslaan mislukt: ' + (err?.message || err), 'var(--down)'); }
    };

    const copyPrev = () => {
      const prev = new Date(weekStart + 'T12:00:00');
      prev.setDate(prev.getDate() - 7);
      const prevKey = prev.toISOString().slice(0, 10);
      const prevSc = (d.schedules || []).find(sc => sc.agent_id === me.id && sc.week_start === prevKey);
      if (prevSc && prevSc.slots && prevSc.slots.length) {
        this.setState({ schedSlots: [...prevSc.slots], schedDirty: true });
        this.toast('Gekopieerd', 'Rooster van vorige week geladen', 'var(--accent)');
      } else {
        this.toast('Leeg', 'Geen rooster voor vorige week gevonden', 'var(--text-mute)');
      }
    };

    const navWeek = delta => {
      const dt = new Date(weekStart + 'T12:00:00');
      dt.setDate(dt.getDate() + delta * 7);
      this.setState({ schedWeek: dt.toISOString().slice(0, 10), schedSlots: undefined, schedDirty: false });
    };

    const ws = new Date(weekStart + 'T12:00:00');
    const we = new Date(weekStart + 'T12:00:00');
    we.setDate(we.getDate() + 6);
    const weekLabel = ws.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) + ' – ' + we.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });

    const btnBase = { border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: 'var(--surface-2)', color: 'var(--text)' };

    // ── VIEW TOGGLE ──
    const viewToggle = e('div', { style: { display: 'flex', gap: 2, background: 'var(--surface-2)', padding: 3, borderRadius: 9 } },
      e('button', { onClick: () => this.setState({ schedView: 'week' }), style: { padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: view === 'week' ? 'var(--bg)' : 'transparent', color: view === 'week' ? 'var(--text)' : 'var(--text-mute)', boxShadow: view === 'week' ? '0 1px 3px rgba(0,0,0,.2)' : 'none', transition: 'all .12s' } }, 'Week'),
      e('button', { onClick: () => this.setState({ schedView: 'month' }), style: { padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: view === 'month' ? 'var(--bg)' : 'transparent', color: view === 'month' ? 'var(--text)' : 'var(--text-mute)', boxShadow: view === 'month' ? '0 1px 3px rgba(0,0,0,.2)' : 'none', transition: 'all .12s' } }, 'Maand'));

    // ── MONTH VIEW ──
    if (view === 'month') {
      const dt = new Date(weekStart + 'T12:00:00');
      const year = dt.getFullYear(), month = dt.getMonth();
      const first = new Date(year, month, 1);
      const last  = new Date(year, month + 1, 0);
      const offset = (first.getDay() + 6) % 7;
      const cells = [...Array(offset).fill(null), ...Array.from({ length: last.getDate() }, (_, i) => i + 1)];
      while (cells.length % 7) cells.push(null);

      const getDateClients = dayNum => {
        if (!dayNum) return [];
        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const dow = (new Date(ds + 'T12:00:00').getDay() + 6) % 7;
        const sc  = (d.schedules || []).find(sc2 => sc2.agent_id === me.id && sc2.week_start === this._weekStart(ds));
        if (!sc) return [];
        const daySlots = (sc.slots || []).filter(sl => sl.day === dow);
        if (daySlots.some(sl => sl.clientId === '__off__')) return ['__off__'];
        return [...new Set(daySlots.map(sl => sl.clientId))];
      };

      const monthGrid = e('div', null,
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 6 } },
          ...DAY_S.map(l => e('div', { key: l, style: { textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', padding: '4px 0' } }, l))),
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 } },
          ...cells.map((dayNum, i) => {
            if (!dayNum) return e('div', { key: 'x' + i, style: { height: 72 } });
            const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const isToday = ds === today;
            const cids = getDateClients(dayNum);
            return e('div', { key: dayNum, onClick: () => this.setState({ schedView: 'week', schedWeek: this._weekStart(ds), schedSlots: undefined }),
              style: { height: 72, borderRadius: 10, padding: '6px 8px', cursor: 'pointer', border: '1px solid ' + (isToday ? 'var(--accent)' : 'var(--border)'), background: isToday ? 'oklch(0.20 0.08 194 / .25)' : 'var(--surface)', transition: 'background .1s' } },
              e('div', { style: { fontSize: 12.5, fontWeight: 700, color: isToday ? 'var(--accent)' : 'var(--text)', marginBottom: 5 } }, dayNum),
              cids[0] === '__off__'
                ? e('div', { style: { fontSize: 10, color: '#f97316', fontWeight: 700 } }, 'Vrij')
                : e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 3 } },
                    cids.slice(0, 4).map(function(cid) { return e('div', { key: cid, style: { width: 9, height: 9, borderRadius: 2, background: getColor(cid) } }); })));
          })));

      const monthLabel = new Date(year, month, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });

      return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820, margin: '0 auto' } },
        UI.Hd('Mijn Rooster'),
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 } },
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            e('button', { onClick: () => { const d2 = new Date(year, month - 1, 1); this.setState({ schedWeek: this._weekStart(d2.toISOString().slice(0, 10)) }); }, style: { ...btnBase, padding: '6px 12px', fontSize: 16 } }, '‹'),
            e('span', { style: { fontSize: 14, fontWeight: 600, minWidth: 180, textAlign: 'center', color: 'var(--text)' } }, monthLabel),
            e('button', { onClick: () => { const d2 = new Date(year, month + 1, 1); this.setState({ schedWeek: this._weekStart(d2.toISOString().slice(0, 10)) }); }, style: { ...btnBase, padding: '6px 12px', fontSize: 16 } }, '›')),
          viewToggle),
        UI.C({ padding: 16 }, monthGrid));
    }

    // ── WEEK VIEW ──
    const clientBar = e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
      e('span', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Klant:'),
      ...myClients.map((cl, i) => {
        const c = COLORS[i % COLORS.length];
        const on = selected === cl.id;
        return e('button', { key: cl.id, onClick: () => this.setState({ schedSelected: cl.id }),
          style: { padding: '5px 14px', borderRadius: 8, border: '2px solid ' + (on ? c : c + '55'), background: on ? c + '22' : 'transparent', color: c, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', transition: 'all .1s' } }, cl.name);
      }),
      e('button', { onClick: () => this.setState({ schedSelected: '__off__' }),
        style: { padding: '5px 12px', borderRadius: 8, border: '2px solid ' + (selected === '__off__' ? '#f97316' : '#f9731644'), background: selected === '__off__' ? 'rgba(249,115,22,.15)' : 'transparent', color: selected === '__off__' ? '#f97316' : 'var(--text-mute)', fontSize: 12.5, cursor: 'pointer', fontWeight: 700, transition: 'all .1s' } }, '✕ Niet beschikbaar'),
      e('button', { onClick: () => this.setState({ schedSelected: '__clear__' }),
        style: { padding: '5px 12px', borderRadius: 8, border: '2px solid ' + (selected === '__clear__' ? 'var(--border)' : 'var(--border)'), background: 'transparent', color: 'var(--text-mute)', fontSize: 12.5, cursor: 'pointer', fontWeight: 700, transition: 'all .1s' } }, '⌫ Wissen'));

    const totalHours = slots.length;
    const summary = myClients.map((cl, i) => {
      const h = slots.filter(sl => sl.clientId === cl.id).length;
      if (!h) return null;
      const c = COLORS[i % COLORS.length];
      return e('span', { key: cl.id, style: { fontSize: 11, background: c + '22', color: c, borderRadius: 5, padding: '2px 8px', fontWeight: 700 } }, cl.name + ' ' + h + 'u');
    }).filter(Boolean);

    const grid = e('div', { style: { overflowX: 'auto' } },
      e('table', { style: { borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', minWidth: 520 } },
        e('thead', null,
          e('tr', null,
            e('th', { style: { width: 44, padding: '0 6px 10px 0' } }),
            ...DAYS.map((_, i) => {
              const dt2 = new Date(weekDates[i]);
              const isT = weekDates[i] === today;
              const off = isDayOff(i);
              return e('th', { key: i, style: { padding: '4px 3px 10px', textAlign: 'center', minWidth: 66 } },
                e('div', {
                  onClick: () => paintDay(i),
                  style: { fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: off ? '#f97316' : isT ? 'var(--accent)' : 'var(--text-dim)', background: off ? 'rgba(249,115,22,.15)' : isT ? 'oklch(0.20 0.08 194 / .25)' : 'transparent', borderRadius: 8, padding: '3px 6px', display: 'inline-block', border: off ? '1px solid #f9731644' : '1px solid transparent' } },
                  off ? '✕ ' + DAY_S[i] : DAY_S[i] + ' ' + dt2.getDate()));
            }))),
        e('tbody', null,
          ...HOURS.map(h =>
            e('tr', { key: h },
              e('td', { style: { padding: '1px 8px 1px 0', fontSize: 10, color: 'var(--text-mute)', textAlign: 'right', userSelect: 'none', verticalAlign: 'middle' } }, String(h).padStart(2, '0') + ':00'),
              ...DAYS.map(di => {
                const off   = isDayOff(di);
                const slot  = off ? null : getSlot(di, h);
                const color = slot ? getColor(slot.clientId) : null;
                const cl    = slot ? myClients.find(c => c.id === slot.clientId) : null;
                const lbl   = cl ? cl.name.slice(0, 6) : '';
                return e('td', { key: di, style: { padding: 2 } },
                  e('div', { onClick: () => off ? null : paint(di, h),
                    style: { height: 30, borderRadius: 5, cursor: off ? 'default' : 'pointer', userSelect: 'none', transition: 'all .08s',
                      background: off ? 'rgba(249,115,22,.07)' : color ? color + '28' : 'var(--surface)',
                      border: '1px solid ' + (off ? '#f9731633' : color ? color + '77' : 'var(--border)'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9.5, color: off ? '#f9731666' : color || 'transparent', fontWeight: 700, letterSpacing: '.02em' } }, off ? '—' : lbl));
              }))))));

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860, margin: '0 auto' } },
      UI.Hd('Mijn Rooster'),
      e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          e('button', { onClick: () => navWeek(-1), style: { ...btnBase, padding: '6px 12px', fontSize: 16 } }, '‹'),
          e('span', { style: { fontSize: 13.5, fontWeight: 600, minWidth: 190, textAlign: 'center', color: 'var(--text)' } }, weekLabel),
          e('button', { onClick: () => navWeek(1), style: { ...btnBase, padding: '6px 12px', fontSize: 16 } }, '›')),
        e('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          viewToggle,
          e('button', { onClick: copyPrev, style: { ...btnBase, padding: '6px 11px', fontSize: 12 } }, '⟳ Vorige week'),
          s.schedDirty
            ? UI.Btn('Opslaan', save, 'primary')
            : e('button', { style: { padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-mute)', fontSize: 12.5, cursor: 'default' } }, '✓ Opgeslagen'))),
      summary.length ? e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, totalHours + 'u gepland  ·'),
        ...summary) : null,
      UI.C({ padding: '12px 16px' }, clientBar),
      UI.C({ padding: '14px 12px' }, grid));
  },
};
