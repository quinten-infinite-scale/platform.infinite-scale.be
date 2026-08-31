// Standalone helper — does NOT need `this`, safe to call from any modal closure
function _showContractOverlay(html, printAfter) {
  const existing = document.getElementById('__contract-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = '__contract-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column;';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;background:#1a1a2e;color:#fff;flex:none;';
  bar.innerHTML = '<span style="font-weight:700;font-size:14px;flex:1;">Contract — Bekijken</span>';
  if (printAfter) {
    const printBtn = document.createElement('button');
    printBtn.textContent = '🖨 Afdrukken / PDF';
    printBtn.style.cssText = 'padding:6px 14px;background:#00c896;border:none;border-radius:6px;color:#fff;font-weight:700;cursor:pointer;font-size:13px;';
    printBtn.onclick = () => { iframe.contentWindow.print(); };
    bar.appendChild(printBtn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Sluiten';
  closeBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid #555;border-radius:6px;color:#ccc;cursor:pointer;font-size:13px;';
  closeBtn.onclick = () => overlay.remove();
  bar.appendChild(closeBtn);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'flex:1;border:none;width:100%;';
  iframe.srcdoc = html;
  overlay.appendChild(bar);
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
}

function _signedContractHtml(c) {
  const html = c.contract_html || '';
  if (c.status !== 'signed' || !c.signer_name) return html;
  const d = c.signed_at
    ? new Date(c.signed_at).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
  const sigBlock = `<div style="margin-top:40px;page-break-inside:avoid;font-family:Arial,Helvetica,sans-serif;">
    <p style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:16px;">Handtekening</p>
    ${c.signature_image ? `<img src="${c.signature_image}" style="max-width:200px;max-height:60px;display:block;margin-bottom:6px;" alt="Handtekening">` : ''}
    <div style="border-top:1px solid #333;padding-top:6px;font-size:9.5pt;color:#444;min-width:260px;display:inline-block;">${c.signer_name}<br>Ondertekend op ${d}</div>
  </div>`;
  return html.replace(/<\/body>/i, sigBlock + '</body>');
}

// All modal renderers
const Modals = {
  renderModalBody(R, d, s) {
    const e = React.createElement; const k = s.modalKind, f = s.form;
    const wrap = (title, body, footer, width) => ({
      width: width || '520px', body: e('div', null,
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-soft)' } },
          UI.Hd(title, { fontSize: 18 }),
          e('button', { onClick: () => this.closeModal(), style: { width: 32, height: 32, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-dim)', cursor: 'pointer' } },
            e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, style: { display: 'block', margin: 'auto' } }, e('path', { d: 'M6 6l12 12M18 6 6 18' })))),
        e('div', { style: { padding: '22px' } }, body),
        footer ? e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--border-soft)' } }, ...footer) : null)
    });

    if (k === 'appointmentDetail') {
      const ap = d.appointments.find(x => x.id === f.id); if (!ap) return null;
      const role = s.role;
      const cl = d.clients.find(c => c.id === ap.client);
      const ag = d.agents.find(a => a.id === ap.agent);
      const canChangeStatus = role === 'admin';
      const canFeedback = role === 'client' || role === 'agency';
      const isEditing = !!f.apptEditing && canChangeStatus;

      const statuses = [['open', 'Open', 'var(--info)'], ['show', 'Show', 'var(--up)'], ['no_show', 'No-show', 'var(--down)'], ['cancel', 'Cancelled', 'var(--text-mute)']];
      const statusSection = canChangeStatus ? e('div', null,
        UI.Sub('Status', { marginBottom: 8 }),
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          statuses.map(([val, label, color]) => e('button', {
            key: val,
            onClick: () => this.setApptStatus(ap.id, val),
            style: { padding: '8px 16px', borderRadius: 9, border: '2px solid ' + (ap.status === val ? color : 'var(--border)'), background: ap.status === val ? (val === 'open' ? 'oklch(0.22 0.05 220 / .4)' : val === 'show' ? 'oklch(0.22 0.08 152 / .4)' : val === 'no_show' ? 'oklch(0.22 0.08 0 / .4)' : 'var(--bg-2)') : 'transparent', color: ap.status === val ? color : 'var(--text-mute)', fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all .15s' }
          }, label)))) : null;

      const isRenocheckAppt = ap.client === 'c15';
      let rnData = null;
      if (isRenocheckAppt && ap.clientFeedback) {
        try { rnData = JSON.parse(ap.clientFeedback); if (!rnData._rn) rnData = null; } catch { rnData = null; }
      }
      const feedbackVal = f.feedbackDraft !== undefined ? f.feedbackDraft : (ap.clientFeedback || '');
      const feedbackSection = isRenocheckAppt
        ? (rnData ? e('div', null,
            UI.Sub('Renocheck lead data', { marginBottom: 8 }),
            e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '12px 14px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
              ...[
                ['Categorie', rnData.category],
                ['Email', rnData.email],
                ['Straat', rnData.street ? rnData.street + (rnData.number ? ' ' + rnData.number : '') : null],
                ['Postcode', rnData.zipcode],
                ['Gemeente', rnData.city],
                ...(rnData.data ? [
                  ['Eigenaar', rnData.data.eigenaar],
                  ['Type dak', rnData.data.type_dak],
                  ['Grootte dak', rnData.data.groote_dak],
                  ['Zonnepanelen', rnData.data.zonnepanelen],
                  ['Zonnepanelen gewenst', rnData.data.zonnepanelen_gewenst],
                  ['Asbest', rnData.data.asbest],
                  ['Lekkages', rnData.data.lekkages],
                  ['Isolatie nodig', rnData.data.isolatie_nodig],
                  ['Dikte isolatie', rnData.data.dikte_isolatie],
                  ['Kleur dakpannen', rnData.data.kleur_dakpannen],
                  ['Timing', rnData.data.timing],
                  ['Financiering', rnData.data.financiering],
                  ['Premie aanvraag', rnData.data.premie_aanvraag],
                  ['Voorkeur belmoment', Array.isArray(rnData.data.voorkeur_belmoment) ? rnData.data.voorkeur_belmoment.join(', ') : rnData.data.voorkeur_belmoment],
                ] : []),
              ].filter(([,v]) => v).map(([k, v]) =>
                e('div', { key: k },
                  e('div', { style: { fontSize: 10.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 } }, k),
                  e('div', { style: { fontSize: 13, color: 'var(--text)' } }, v))),
              rnData.data?.info_project ? e('div', { key: 'info', style: { gridColumn: '1 / -1' } },
                e('div', { style: { fontSize: 10.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 } }, 'Info project'),
                e('div', { style: { fontSize: 13, color: 'var(--text)', lineHeight: 1.5 } }, rnData.data.info_project)) : null))
          : e('div', null, UI.Sub('Renocheck lead data', { marginBottom: 8 }), e('div', { style: { fontSize: 13, color: 'var(--text-mute)', fontStyle: 'italic' } }, 'Geen lead data beschikbaar.')))
        : e('div', null,
            UI.Sub('Client feedback', { marginBottom: 8 }),
            canFeedback
              ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  e('textarea', { value: feedbackVal, placeholder: 'Add feedback on this appointment…', onChange: ev => this.setForm('feedbackDraft', ev.target.value), style: { width: '100%', minHeight: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' } }),
                  UI.Btn('Save feedback', () => this.saveApptFeedback(ap.id, feedbackVal), 'primary', { fontSize: 12, padding: '7px 14px', alignSelf: 'flex-end' }))
              : ap.clientFeedback
                ? e('div', { style: { padding: '10px 14px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border-soft)', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 } }, ap.clientFeedback)
                : e('div', { style: { fontSize: 13, color: 'var(--text-mute)', fontStyle: 'italic' } }, 'No client feedback yet.'));

      const loggedTime = ap.loggedAt ? new Date(ap.loggedAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : null;

      // Edit form
      if (isEditing) {
        const eClient = f.eApptClient !== undefined ? f.eApptClient : (ap.client || '');
        const eCl = d.clients.find(c => c.id === eClient);
        const eSubs = eCl && eCl.type === 'agency' ? (eCl.subclients || []) : [];
        const editForm = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          UI.Grid('1fr 1fr', 10,
            UI.Field('Lead name', UI.Input(f.eApptLead !== undefined ? f.eApptLead : ap.lead, v => this.setForm('eApptLead', v), 'Full name')),
            UI.Field('Phone', UI.Input(f.eApptPhone !== undefined ? f.eApptPhone : (ap.phone || ''), v => this.setForm('eApptPhone', v), '+32…'))),
          UI.Grid('1fr 1fr', 10,
            UI.Field('Client', UI.Select(eClient, v => this.setState(st => ({ form: { ...st.form, eApptClient: v, eApptSub: '' } })), [{ v: '', l: 'Select…' }, ...d.clients.map(c => ({ v: c.id, l: c.name }))])),
            eSubs.length ? UI.Field('Sub-client', UI.Select(f.eApptSub !== undefined ? f.eApptSub : (ap.sub || ''), v => this.setForm('eApptSub', v), [{ v: '', l: 'None' }, ...eSubs.map(sc => ({ v: sc.id, l: sc.name }))])) : null),
          UI.Grid('1fr 1fr', 10,
            UI.Field('Agent', UI.Select(f.eApptAgent !== undefined ? f.eApptAgent : (ap.agent || ''), v => this.setForm('eApptAgent', v), [{ v: '', l: 'Select…' }, ...d.agents.filter(a => a.active).map(a => ({ v: a.id, l: a.name }))])),
            UI.Field('Amount (€)', UI.Input(String(f.eApptAmount !== undefined ? f.eApptAmount : (ap.amount || 0)), v => this.setForm('eApptAmount', v), '0', 'number'))),
          UI.Grid('1fr 1fr', 10,
            UI.Field('Appt date', UI.Input(f.eApptDate !== undefined ? f.eApptDate : (ap.dateAppt || ''), v => this.setForm('eApptDate', v), '', 'date')),
            UI.Field('Date logged', UI.Input(f.eApptDateLog !== undefined ? f.eApptDateLog : (ap.dateLog || ''), v => this.setForm('eApptDateLog', v), '', 'date'))),
          (() => {
            const eAg = d.agents.find(a => a.id === (f.eApptAgent !== undefined ? f.eApptAgent : (ap.agent || '')));
            const eClient = f.eApptClient !== undefined ? f.eApptClient : (ap.client || '');
            const defaultRate = eAg && eAg.rates ? (eAg.rates[eClient] || '') : '';
            const currentRate = f.eApptAgentRate !== undefined ? f.eApptAgentRate : (ap.agentRate != null ? String(ap.agentRate) : '');
            const currentCommission = f.eApptCommission !== undefined ? f.eApptCommission : (ap.dealCommission != null ? String(ap.dealCommission) : '');
            const currentDealAmount = f.eApptDealAmount !== undefined ? f.eApptDealAmount : (ap.dealAmount != null ? String(ap.dealAmount) : '');
            return UI.Grid('1fr 1fr 1fr', 10,
              UI.Field('Agent rate (€)' + (defaultRate ? ' · default: €' + defaultRate : ''),
                UI.Input(currentRate, v => this.setForm('eApptAgentRate', v), defaultRate ? String(defaultRate) : '0', 'number')),
              UI.Field('Deal amount IS (€)',
                UI.Input(currentDealAmount, v => {
                  const n = parseFloat(v);
                  const auto = (!isNaN(n) && n > 0) ? String(Math.round(n * 0.55 * 100) / 100) : (v === '' ? '' : undefined);
                  this.setState(st => ({ form: { ...st.form, eApptDealAmount: v, ...(auto !== undefined ? { eApptCommission: auto } : {}) } }));
                }, '0', 'number')),
              UI.Field('Agent commission (€) · 55%',
                UI.Input(currentCommission, v => this.setForm('eApptCommission', v), '0', 'number')));
          })());
        return wrap('Edit appointment', editForm,
          [UI.Btn('Cancel', () => this.setForm('apptEditing', false), 'soft'), UI.Btn('Save changes', () => this.saveApptEdits(ap.id), 'primary')], '560px');
      }

      const detailBtns = canChangeStatus
        ? f.deleteConfirm
          ? [
              UI.Btn('Cancel', () => this.setForm('deleteConfirm', false), 'soft'),
              UI.Btn('Confirm delete', () => this.deleteAppointment(ap.id), 'soft', { color: 'var(--down)', borderColor: 'var(--down)', fontWeight: 700 }),
            ]
          : [
              UI.Btn('Delete', () => this.setForm('deleteConfirm', true), 'soft', { color: 'var(--down)', borderColor: 'var(--down)' }),
              UI.Btn('Edit', () => this.setForm('apptEditing', true), 'soft'),
            ]
        : [UI.Btn('Close', () => this.closeModal(), 'soft')];

      return wrap('Appointment details', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          UI.statusPill(ap.status),
          e('span', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 18, color: 'var(--text)' } }, ap.lead),
          ap.phone ? e('span', { style: { fontSize: 12.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'" } }, ap.phone) : null),
        UI.Grid('1fr 1fr', 10,
          this._kv('Client', cl ? cl.name : ap.client),
          this._kv('Agent', ag ? ag.name : ap.agent),
          this._kv('Appt date', this.fmtDate(ap.dateAppt)),
          this._kv('Logged', this.fmtDate(ap.dateLog) + (loggedTime ? ' · ' + loggedTime : '')),
          role === 'admin' ? this._kv('Amount', ap.amount ? this.euro(ap.amount) : '—') : null,
          role === 'admin' ? (() => {
            const agentRate = ap.agentRate != null ? ap.agentRate : (ag && ag.rates ? ((ag.rates[ap.sub] || ag.rates[ap.client]) || null) : null);
            if (!agentRate) return null;
            return this._kv('Agent rate', e('span', null, this.euro(agentRate), ap.agentRate != null ? e('span', { style: { fontSize: 11, color: 'var(--accent)', marginLeft: 5, fontFamily: "'JetBrains Mono'" } }, '✱ override') : null));
          })() : null,
          role === 'admin' && ap.dealAmount != null ? this._kv('Deal amount IS', e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 600, color: 'var(--text-mute)' } }, this.euro(ap.dealAmount))) : null,
          ap.dealCommission != null ? this._kv('Agent commission', e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, color: 'var(--up)' } }, '💰 ' + this.euro(ap.dealCommission), ap.dealAmount != null && role === 'admin' ? e('span', { style: { fontSize: 11, color: 'var(--text-mute)', marginLeft: 6 } }, '55%') : null)) : null),
        statusSection,
        feedbackSection,
        f.deleteConfirm ? e('div', { style: { padding: '12px 14px', borderRadius: 10, background: 'oklch(0.22 0.08 0 / .25)', border: '1px solid var(--down)', fontSize: 13, color: 'var(--down)', fontWeight: 600 } }, '⚠ This will permanently delete this appointment. This cannot be undone.') : null),
        detailBtns, '520px');
    }

    if (k === 'todo') {
      return wrap('Add a to-do', UI.Field('Task', UI.Input(f.text, v => this.setForm('text', v), 'What needs doing?')),
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'), UI.Btn('Add task', () => { this.addTodo(f.text); this.closeModal(); }, 'primary')]);
    }

    if (k === 'log') {
      const me = d.agents.find(a => a.id === this.myAgentId) || {};
      const myClients = d.clients.filter(c => (me.clients || []).includes(c.id));
      const sel = d.clients.find(c => c.id === f.client);
      const isRenocheck = f.client === 'c15';
      const RN_CATS = ['Airco','Thuisbatt','Zonnepanelen','Ramen en deuren','Keukens','Badkamers','Crepi','Dak'];
      const cat = f.rnCategory;
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
        UI.Field('Lead name', UI.Input(f.lead, v => this.setForm('lead', v), 'Full name')),
        UI.Field('Phone number', UI.Input(f.phone, v => this.setForm('phone', v), '+32…', 'text', { autoComplete: 'off' }))) : null;
      return wrap('Log appointment', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        UI.Field('Date of appointment', UI.Input(f.dateAppt, v => this.setForm('dateAppt', v), '', 'date')),
        UI.Field('Client', UI.Select(f.client, v => this.setForm('client', v), [{ v: '', l: 'Select client…' }, ...myClients.map(c => ({ v: c.id, l: c.name }))])),
        sel && sel.type === 'agency' ? UI.Field('Client of lead agency', UI.Select(f.sub, v => this.setForm('sub', v), [{ v: '', l: 'Select…' }, ...(sel.subclients || []).map(x => ({ v: x.id, l: x.name }))])) : null,
        stdFields,
        rnForm),
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'), UI.Btn('Submit & lock', () => this.logAppointment(), 'primary')]);
    }

    if (k === 'ticket') {
      return wrap('New support ticket', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        UI.Field('Issue title', UI.Input(f.title, v => this.setForm('title', v), 'Short summary')),
        UI.Field('Category', UI.Select(f.cat || 'General', v => this.setForm('cat', v), [{ v: 'General', l: 'General' }, { v: 'Appointments', l: 'Appointments' }, { v: 'Billing', l: 'Billing' }, { v: 'Integration', l: 'Integration' }, { v: 'Other', l: 'Other' }])),
        UI.Field('Description', UI.Area(f.desc, v => this.setForm('desc', v), 'Describe the issue…'))),
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'), UI.Btn('Submit ticket', () => this.submitTicket(), 'primary')]);
    }

    if (k === 'eod') {
      const me = d.agents.find(a => a.id === this.myAgentId) || {};
      const myClients = d.clients.filter(c => (me.clients || []).includes(c.id));
      const sel = f.clients || [];
      const toggleC = id => { const has = sel.includes(id); this.setForm('clients', has ? sel.filter(x => x !== id) : [...sel, id]); };
      const callBlocks = f.callBlocks || [];
      const addBlock = () => this.setForm('callBlocks', [...callBlocks, { from: '', to: '' }]);
      const removeBlock = idx => this.setForm('callBlocks', callBlocks.filter((_, j) => j !== idx));
      const updateBlock = (idx, key, val) => this.setForm('callBlocks', callBlocks.map((b, j) => j === idx ? Object.assign({}, b, { [key]: val }) : b));
      const totalMins = callBlocks.reduce((sum, b) => {
        if (!b.from || !b.to) return sum;
        const [fh, fm] = b.from.split(':').map(Number);
        const [th, tm] = b.to.split(':').map(Number);
        return sum + Math.max(0, (th * 60 + tm) - (fh * 60 + fm));
      }, 0);
      const totalStr = totalMins > 0 ? Math.floor(totalMins / 60) + 'u ' + (totalMins % 60) + 'm' : null;
      return wrap('End-of-day report', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        UI.Field('Clients called for', e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 7 } },
          myClients.map(c => { const on = sel.includes(c.id); return e('button', { key: c.id, onClick: () => toggleC(c.id), style: { padding: '6px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'), background: on ? 'oklch(0.30 0.10 194 / .35)' : 'transparent', color: on ? 'var(--text)' : 'var(--text-mute)' } }, c.name); }))),
        sel.length ? sel.map(cid => e('div', { key: cid, style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'end' } },
          e('div', { style: { fontSize: 12.5, fontWeight: 700, color: 'var(--text-dim)', paddingBottom: 10 } }, this.clientName(cid, d)),
          UI.Field('Calls', UI.Input((f.calls || {})[cid], v => this.setForm('calls', Object.assign({}, f.calls, { [cid]: +v })), '0', 'number')),
          UI.Field('Appts', UI.Input((f.appts || {})[cid], v => this.setForm('appts', Object.assign({}, f.appts, { [cid]: +v })), '0', 'number')))) : null,
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            e('div', { style: { fontSize: 12.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Call blocks' + (totalStr ? ' · ' + totalStr + ' total' : '')),
            UI.Btn('+ Add block', addBlock, 'soft', { padding: '4px 10px', fontSize: 12 })),
          callBlocks.length === 0
            ? e('div', { style: { fontSize: 13, color: 'var(--text-mute)', fontStyle: 'italic', padding: '8px 0' } }, 'No call blocks yet — add one to track your call time.')
            : callBlocks.map((b, idx) => e('div', { key: idx, style: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' } },
                UI.Field('From', UI.Input(b.from, v => updateBlock(idx, 'from', v), '09:00', 'time')),
                UI.Field('To', UI.Input(b.to, v => updateBlock(idx, 'to', v), '12:00', 'time')),
                e('button', { onClick: () => removeBlock(idx), style: { height: 38, width: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--down)', cursor: 'pointer', fontSize: 18, display: 'grid', placeItems: 'center', marginBottom: 0 } }, '×')))),
        UI.Field('What went well', UI.Area(f.well, v => this.setForm('well', v))),
        UI.Field('What went badly', UI.Area(f.bad, v => this.setForm('bad', v))),
        UI.Field('Goal for tomorrow', UI.Input(f.goal, v => this.setForm('goal', v)))),
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'), UI.Btn('Submit report', () => this.submitEOD(), 'primary')], '600px');
    }

    if (k === 'contractView' || k === 'contractDoc') {
      const c = f.c;
      return wrap((c.type || 'Agreement') + ' — ' + (c.party || ''), e('div', { style: { background: 'var(--bg-2)', borderRadius: 12, padding: 24, fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-dim)' } },
        e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 18, color: 'var(--text)', marginBottom: 14 } }, 'Service Agreement'),
        e('p', null, 'This agreement is entered into between Infinite Scale (the "Provider") and ', e('b', { style: { color: 'var(--text)' } }, c.party), ' (the "Client").'),
        e('p', null, 'Scope: outbound appointment setting under a ', e('b', { style: { color: 'var(--text)' } }, (c.type || '').toLowerCase()), ' arrangement. Compensation: ', e('b', { style: { color: 'var(--text)' } }, c.value), '.'),
        e('p', null, 'Billing occurs monthly based on the approved status of booked appointments. Signed electronically on ' + this.fmtFull(c.sent) + '.'),
        e('div', { style: { marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' } },
          e('span', null, 'Signature: ', e('span', { style: { fontFamily: 'cursive', color: 'var(--text)', fontSize: 18 } }, c.party)),
          UI.statusPill(c.status === 'signed' ? 'show' : c.status === 'expired' ? 'no_show' : 'pending'))),
        [UI.Btn('Close', () => this.closeModal(), 'soft')], '600px');
    }

    // Admin modals
    const uploadResult = this._admUploadContract(k, s.form, d);
    if (uploadResult) return uploadResult;
    const uploadClientResult = this._admUploadClientContract(k, s.form, d);
    if (uploadClientResult) return uploadClientResult;
    const adminResult = this._adminModals(R, d, s, wrap);
    if (adminResult) return adminResult;

    return { width: '520px', body: null };
  },

  _adminModals(R, d, s, wrap) {
    const e = React.createElement; const k = s.modalKind, f = s.form;

    if (k === 'clientProfile') {
      const c = d.clients.find(x => x.id === f.id); if (!c) return null;
      const appts = d.appointments.filter(a => a.client === c.id);
      const editing = !!f.editing;

      if (editing) {
        const koDate = f.editKickoffDate !== undefined ? f.editKickoffDate : (c.kickoff || '').slice(0, 10);
        const koTime = f.editKickoffTime !== undefined ? f.editKickoffTime : ((c.kickoff || '').slice(11, 16) || '09:00');
        return wrap('Edit client — ' + c.name, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          UI.Grid('1fr 1fr', 12,
            UI.Field('Name', UI.Input(f.editName !== undefined ? f.editName : c.name, v => this.setForm('editName', v))),
            UI.Field('Contact person', UI.Input(f.editContact !== undefined ? f.editContact : (c.contactPerson || ''), v => this.setForm('editContact', v)))),
          UI.Grid('1fr 1fr', 12,
            UI.Field('Email', UI.Input(f.editEmail !== undefined ? f.editEmail : (c.email || ''), v => this.setForm('editEmail', v))),
            UI.Field('Phone', UI.Input(f.editPhone !== undefined ? f.editPhone : (c.phone || ''), v => this.setForm('editPhone', v), '+32…'))),
          UI.Grid('1fr 1fr', 12,
            UI.Field('VAT number', UI.Input(f.editVat !== undefined ? f.editVat : (c.vat || ''), v => this.setForm('editVat', v), 'BE 0123.456.789')),
            UI.Field('Betalingstermijn (dagen)', UI.Input(String(f.editPayDays !== undefined ? f.editPayDays : (c.pay_days || '')), v => this.setForm('editPayDays', v), 'bv. 30', 'number'))),
          e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 } }, 'Vergoedingstructuur'),
          UI.Grid('1fr 1fr', 12,
            UI.Field('Per afspraak (€)', UI.Input(String(f.editRate !== undefined ? f.editRate : (c.rate || '')), v => this.setForm('editRate', v), 'bv. 140', 'number')),
            UI.Field('Per uur (€)', UI.Input(String(f.editPerHour !== undefined ? f.editPerHour : (c.per_hour || '')), v => this.setForm('editPerHour', v), 'bv. 75', 'number'))),
          UI.Grid('1fr 1fr 1fr', 12,
            UI.Field('Vaste maandelijkse fee (€)', UI.Input(String(f.editMonthly !== undefined ? f.editMonthly : (c.monthly_fee || '')), v => this.setForm('editMonthly', v), 'bv. 1500', 'number')),
            UI.Field('Commissie (%)', UI.Input(String(f.editCommission !== undefined ? f.editCommission : (c.commission || '')), v => this.setForm('editCommission', v), 'bv. 10', 'number')),
            UI.Field('Vaste close fee (€)', UI.Input(String(f.editCloseFee !== undefined ? f.editCloseFee : (c.close_fee || '')), v => this.setForm('editCloseFee', v), 'bv. 500', 'number'))),
          UI.Field('Opstartkost eenmalig (€)', UI.Input(String(f.editSetupFee !== undefined ? f.editSetupFee : (c.setup_fee || '')), v => this.setForm('editSetupFee', v), 'bv. 500', 'number')),
          UI.Grid('1fr 1fr', 12,
            UI.Field('Status', UI.Select(f.editStatus !== undefined ? f.editStatus : (c.status || 'starting'), v => this.setForm('editStatus', v), [{ v: 'starting', l: 'Starting' }, { v: 'active', l: 'Active' }, { v: 'inactive', l: 'Inactive' }])),
            UI.Field('Type', UI.Select(f.editType !== undefined ? f.editType : (c.type || 'direct'), v => this.setForm('editType', v), [{ v: 'direct', l: 'Direct client' }, { v: 'agency', l: 'Lead agency' }]))),
          UI.Field('CRM', UI.Select(f.editCrm !== undefined ? f.editCrm : (c.crm || 'none'), v => this.setForm('editCrm', v), [{ v: 'none', l: 'None' }, { v: 'monday', l: 'Monday' }, { v: 'gohighlevel', l: 'GoHighLevel' }, { v: 'teamleader', l: 'Team Leader' }, { v: 'hubspot', l: 'HubSpot' }, { v: 'sheets', l: 'Google Sheets' }])),
          (() => {
            const curType = f.editType !== undefined ? f.editType : (c.type || 'direct');
            if (curType !== 'agency') return null;
            const subs = f.editSubclients !== undefined ? f.editSubclients : (c.subclients || []);
            return e('div', null,
              UI.Sub('Sub-clients under this agency', { marginBottom: 8 }),
              subs.length ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 } },
                subs.map((sc, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 9, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
                  e('span', { style: { flex: 1, fontWeight: 600, fontSize: 13 } }, sc.name || sc),
                  e('input', { type: 'number', value: sc.rate || '', placeholder: '0', onChange: ev => { const updated = subs.map((s, j) => j === i ? { ...s, rate: parseFloat(ev.target.value) || 0 } : s); this.setForm('editSubclients', updated); }, style: { width: 70, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, textAlign: 'right', outline: 'none' } }),
                  e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '€/appt'),
                  e('button', { onClick: () => this.setForm('editSubclients', subs.filter((_, j) => j !== i)), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--down)', fontWeight: 700, fontSize: 14, padding: '0 4px', lineHeight: 1 } }, '×')))) : e('div', { style: { fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 8 } }, 'No sub-clients yet.'),
              UI.Grid('1fr 1fr', 8,
                UI.Field('Sub-client name', UI.Input(f._newScName || '', v => this.setForm('_newScName', v), 'e.g. Sjuste')),
                UI.Field('Rate / appt (€)', UI.Input(f._newScRate || '', v => this.setForm('_newScRate', v), '45', 'number'))),
              UI.Btn('+ Add sub-client', () => {
                if (!f._newScName) return;
                const entry = { id: 'sc-' + Date.now(), name: f._newScName, rate: +(String(f._newScRate || '0').replace(/\D/g, '')) || 0 };
                this.setForm('editSubclients', [...subs, entry]);
                this.setState(st => ({ form: { ...st.form, _newScName: '', _newScRate: '' } }));
              }, 'ghost', { fontSize: 12, padding: '6px 12px' }));
          })(),
          UI.Field('Kick-off date & time',
            e('div', { style: { display: 'flex', gap: 10 } },
              e('input', { type: 'date', value: koDate, onChange: ev => this.setForm('editKickoffDate', ev.target.value), style: { flex: 1, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--accent)', fontSize: 13, outline: 'none' } }),
              e('input', { type: 'time', value: koTime, onChange: ev => this.setForm('editKickoffTime', ev.target.value), style: { width: 110, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, outline: 'none' } }))),
          e('div', { style: { padding: 11, borderRadius: 10, background: 'var(--bg-2)', fontSize: 12.5, color: 'var(--text-mute)' } }, 'Changing the rate affects new billing calculations — existing approved amounts are not retroactively changed.')),
          [UI.Btn('Cancel', () => this.setForm('editing', false), 'soft'), UI.Btn('Save changes', () => this.saveClientEdits(), 'primary')], '560px');
      }

      const clientContracts = (d.contracts || []).filter(x => x.party_type !== 'agent' && (x.party === c.name || (c.email && x.email === c.email)));
      const statusColor = { sent: 'var(--info)', overdue: 'var(--down)', signed: 'var(--up)', canceled: 'var(--text-mute)' };
      const contractBadge = ct => e('div', { key: ct.id, onClick: () => { this.closeModal(); this.openModal('contractDetail', { contract: ct }); }, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border-soft)', cursor: 'pointer' } },
        e('div', null,
          e('div', { style: { fontWeight: 600, fontSize: 13.5, color: 'var(--text)' } }, ct.type || 'Contract'),
          e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 2 } }, ct.value || '' + (ct.sent ? ' · sent ' + ct.sent : ''))),
        e('span', { style: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, color: statusColor[ct.status] || 'var(--text-mute)', border: '1px solid ' + (statusColor[ct.status] || 'var(--border)') } }, (ct.status || 'sent').charAt(0).toUpperCase() + (ct.status || 'sent').slice(1)));

      return wrap(c.name, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        UI.Row({ gap: 8, flexWrap: 'wrap' }, UI.statusPill(c.status || 'inactive'), UI.Pill(c.type === 'agency' ? 'Lead agency' : 'Direct', 'var(--info)', 'oklch(0.30 0.05 240)'), UI.Pill('CRM: ' + (c.crmOn ? c.crm : 'none'), 'var(--text-dim)', 'var(--bg-2)')),
        UI.Grid('1fr 1fr', 12,
          this._kv('Contact', c.contactPerson || '—'),
          this._kv('Email', c.email || '—'),
          this._kv('Phone', c.phone || '—'),
          this._kv('VAT', c.vat || '—'),
          this._kv('Vergoeding', UI.rateStr(c)),
          this._kv('Kickoff', c.kickoff ? this.fmtFull(c.kickoff.slice(0, 10)) + (c.kickoff.slice(11, 16) ? ' · ' + c.kickoff.slice(11, 16) : '') : '—'),
          this._kv('Agents', d.agents.filter(a => (a.clients || []).includes(c.id)).map(a => this.agentName(a.id, d)).join(', ') || '—'),
          this._kv('Billing', c.billStatus || 'pending')),
        (c.subclients || []).length ? e('div', null, UI.Sub('Clients under agency', { marginBottom: 7 }), e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 7 } }, c.subclients.map(sc => UI.Pill(sc.name + ' · ' + this.euro(sc.rate), 'var(--text-dim)', 'var(--bg-2)')))) : null,
        e('div', null,
          UI.Row({ justifyContent: 'space-between', marginBottom: 7 }, UI.Sub('Contracts'), UI.Row({ gap: 6 }, UI.Btn('↑ Upload', () => { this.closeModal(); this.openModal('uploadClientContract', { ccName: c.name, ccEmail: c.email || '', ccContact: c.contactPerson || '', ccVat: c.vat || '', ccPhone: c.phone || '' }); }, 'ghost', { padding: '3px 10px', fontSize: 11 }), UI.Btn('+ New', () => { this.closeModal(); this.openModal('wizard', { step: 0, partyType: 'client', company: c.name, email: c.email || '', contact: c.contactPerson || '', vat: c.vat || '' }); }, 'ghost', { padding: '3px 10px', fontSize: 11 }))),
          clientContracts.length ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } }, clientContracts.map(contractBadge)) : e('div', { style: { fontSize: 13, color: 'var(--text-mute)', padding: '10px 0' } }, 'No contracts yet.')),
        e('div', null, UI.Sub('Appointments this month', { marginBottom: 7 }), e('div', { style: { maxHeight: 320, overflowY: 'auto', borderRadius: 10, border: '1px solid var(--border-soft)' } }, UI.Table([{ label: 'Lead', render: x => x.lead }, { label: 'Date', render: x => this.fmtDate(x.dateAppt) }, { label: 'Status', align: 'right', render: x => UI.statusPill(x.status) }], appts.filter(a => !a.invoiced), { min: 360 })))),
        [UI.Btn('Edit', () => this.setForm('editing', true), 'soft'), c.status !== 'inactive' ? UI.Btn('Deactivate', () => { this.deactivateClient(c.id); this.closeModal(); }, 'danger') : null, UI.Btn('Mark invoice paid', () => { this.markPaid(c.id); this.closeModal(); }, 'primary')], '640px');
    }

    if (k === 'agentProfile') {
      const a = d.agents.find(x => x.id === f.id); if (!a) return null; const today = this.iso(this.today());
      const stages = [['form', 'Form'], ['qualified', 'Qualified'], ['signed', 'Contract'], ['started', 'Started calls'], ['launched', 'Launched']];
      const curIdx = stages.findIndex(x => x[0] === (f.editStage || a.status));
      const editing = !!f.editing;

      const stageBar = e('div', null, UI.Sub('Onboarding stage — click to change', { marginBottom: 9 }),
        e('div', { style: { display: 'flex', gap: 6 } }, stages.map((st, i) => e('div', { key: st[0], onClick: () => { this.setForm('editStage', st[0]); }, style: { flex: 1, textAlign: 'center', cursor: 'pointer' } },
          e('div', { style: { height: 5, borderRadius: 3, background: i <= curIdx ? 'var(--accent)' : 'var(--surface-2)', transition: '.2s' } }),
          e('div', { style: { fontSize: 10.5, marginTop: 5, color: i <= curIdx ? 'var(--text-dim)' : 'var(--text-mute)', fontWeight: 600 } }, st[1])))));

      const clientSection = e('div', null,
        UI.Sub('Client assignments & rates', { marginBottom: 9 }),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
          d.clients.map(c => {
            const assigned = (a.clients || []).includes(c.id);
            const savedRate = (a.rates || {})[c.id] || 0;
            const editing = !!f['editingRate_' + c.id];
            const confirming = !!f['confirmRate_' + c.id];
            const pendingRate = f['pendingRate_' + c.id] !== undefined ? f['pendingRate_' + c.id] : savedRate;

            const cancelEdit = () => this.setState(st => ({ form: { ...st.form, ['editingRate_' + c.id]: false, ['pendingRate_' + c.id]: undefined, ['confirmRate_' + c.id]: false } }));
            const startEdit = () => this.setState(st => ({ form: { ...st.form, ['editingRate_' + c.id]: true, ['pendingRate_' + c.id]: savedRate, ['confirmRate_' + c.id]: false } }));
            const askConfirm = () => this.setState(st => ({ form: { ...st.form, ['confirmRate_' + c.id]: true } }));
            const doSave = () => { this.updateAgentRate(a.id, c.id, pendingRate); this.setState(st => ({ form: { ...st.form, ['editingRate_' + c.id]: false, ['confirmRate_' + c.id]: false, ['pendingRate_' + c.id]: undefined } })); };

            let rateWidget;
            if (!assigned) {
              rateWidget = null;
            } else if (confirming) {
              rateWidget = e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, background: 'oklch(0.28 0.06 85 / .25)', border: '1px solid oklch(0.55 0.12 85 / .5)', borderRadius: 9, padding: '6px 11px' } },
                e('span', { style: { fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 } }, 'Set to ' + this.euro(pendingRate) + '/appt?'),
                e('button', { onClick: doSave, style: { padding: '4px 12px', borderRadius: 7, background: 'var(--accent)', border: 'none', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, 'Confirm'),
                e('button', { onClick: cancelEdit, style: { padding: '4px 10px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-mute)', fontSize: 12, cursor: 'pointer' } }, 'Cancel'));
            } else if (editing) {
              rateWidget = e('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '€'),
                e('input', { type: 'number', value: pendingRate, autoFocus: true, onChange: ev => this.setState(st => ({ form: { ...st.form, ['pendingRate_' + c.id]: +ev.target.value } })), style: { width: 64, padding: '4px 7px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: "'JetBrains Mono'", outline: 'none' } }),
                e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, '/appt'),
                e('button', { onClick: askConfirm, style: { padding: '4px 12px', borderRadius: 7, background: 'var(--accent)', border: 'none', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, 'Save'),
                e('button', { onClick: cancelEdit, style: { padding: '4px 8px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-mute)', fontSize: 12, cursor: 'pointer' } }, '✕'));
            } else {
              rateWidget = e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 13.5, color: 'var(--text)' } }, this.euro(savedRate)),
                e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, '/appt'),
                e('button', { onClick: startEdit, style: { padding: '3px 10px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-mute)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' } }, 'Change'));
            }

            const isAgencyClient = c.type === 'agency' && (c.subclients || []).length > 0;
            const subRateRows = assigned && isAgencyClient ? (c.subclients || []).map(sc => {
              const scSavedRate = (a.rates || {})[sc.id] || 0;
              const scEditing = !!f['editingRate_' + sc.id];
              const scConfirming = !!f['confirmRate_' + sc.id];
              const scPendingRate = f['pendingRate_' + sc.id] !== undefined ? f['pendingRate_' + sc.id] : scSavedRate;
              const cancelScEdit = () => this.setState(st => ({ form: { ...st.form, ['editingRate_' + sc.id]: false, ['pendingRate_' + sc.id]: undefined, ['confirmRate_' + sc.id]: false } }));
              const startScEdit = () => this.setState(st => ({ form: { ...st.form, ['editingRate_' + sc.id]: true, ['pendingRate_' + sc.id]: scSavedRate, ['confirmRate_' + sc.id]: false } }));
              const askScConfirm = () => this.setState(st => ({ form: { ...st.form, ['confirmRate_' + sc.id]: true } }));
              const doScSave = () => { this.updateAgentRate(a.id, sc.id, scPendingRate); this.setState(st => ({ form: { ...st.form, ['editingRate_' + sc.id]: false, ['confirmRate_' + sc.id]: false, ['pendingRate_' + sc.id]: undefined } })); };
              let scRateWidget;
              if (scConfirming) {
                scRateWidget = e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, background: 'oklch(0.28 0.06 85 / .25)', border: '1px solid oklch(0.55 0.12 85 / .5)', borderRadius: 9, padding: '5px 10px' } },
                  e('span', { style: { fontSize: 12, color: 'var(--warn)', fontWeight: 600 } }, 'Set to ' + this.euro(scPendingRate) + '?'),
                  e('button', { onClick: doScSave, style: { padding: '3px 10px', borderRadius: 7, background: 'var(--accent)', border: 'none', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, 'Confirm'),
                  e('button', { onClick: cancelScEdit, style: { padding: '3px 8px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-mute)', fontSize: 12, cursor: 'pointer' } }, 'Cancel'));
              } else if (scEditing) {
                scRateWidget = e('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '€'),
                  e('input', { type: 'number', value: scPendingRate, autoFocus: true, onChange: ev => this.setState(st => ({ form: { ...st.form, ['pendingRate_' + sc.id]: +ev.target.value } })), style: { width: 60, padding: '4px 7px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: "'JetBrains Mono'", outline: 'none' } }),
                  e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, '/appt'),
                  e('button', { onClick: askScConfirm, style: { padding: '3px 10px', borderRadius: 7, background: 'var(--accent)', border: 'none', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, 'Save'),
                  e('button', { onClick: cancelScEdit, style: { padding: '3px 8px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-mute)', fontSize: 12, cursor: 'pointer' } }, '✕'));
              } else {
                scRateWidget = e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 13, color: scSavedRate ? 'var(--text)' : 'var(--text-mute)' } }, scSavedRate ? this.euro(scSavedRate) : '—'),
                  e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, '/appt'),
                  e('button', { onClick: startScEdit, style: { padding: '3px 9px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-mute)', fontSize: 11, fontWeight: 600, cursor: 'pointer' } }, 'Set'));
              }
              return e('div', { key: sc.id, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 11px 6px 32px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border-soft)', marginTop: 4 } },
                e('span', { style: { fontSize: 12.5, color: 'var(--text-dim)', flex: 1 } }, '↳ ' + sc.name),
                scRateWidget);
            }) : [];

            return e('div', { key: c.id },
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 9, background: assigned ? 'oklch(0.22 0.06 194 / .5)' : 'var(--bg-2)', border: '1px solid ' + (assigned ? 'oklch(0.45 0.18 194 / .4)' : 'var(--border-soft)') } },
                e('button', { onClick: () => this.toggleAgentClient(a.id, c.id, savedRate), style: { width: 20, height: 20, borderRadius: 6, flex: 'none', cursor: 'pointer', border: '1.5px solid ' + (assigned ? 'var(--accent)' : 'var(--border)'), background: assigned ? 'var(--accent)' : 'transparent', display: 'grid', placeItems: 'center' } },
                  assigned ? e('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--accent-ink)', strokeWidth: 3 }, e('path', { d: 'M5 12l5 5L20 6' })) : null),
                e('span', { style: { flex: 1, fontSize: 13.5, fontWeight: 600, color: assigned ? 'var(--text)' : 'var(--text-mute)' } }, c.name),
                isAgencyClient ? e('span', { style: { fontSize: 11, color: 'var(--text-mute)', marginRight: 4 } }, 'Agency rate:') : null,
                rateWidget),
              ...subRateRows);
          })));

      const feedbackSection = e('div', null,
        UI.Sub('Feedback / optimization points', { marginBottom: 7 }),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          (a.feedback || []).length ? a.feedback.map((fb, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
            e('div', { style: { flex: 1, fontSize: 13, color: 'var(--text-dim)', padding: '8px 11px', background: 'var(--bg-2)', borderRadius: 9, lineHeight: 1.4 } }, fb),
            e('button', { onClick: () => this.removeAgentFeedback(a.id, i), style: { flexShrink: 0, width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--down)', cursor: 'pointer', fontSize: 14, display: 'grid', placeItems: 'center' } }, '×'))) : [UI.Sub('No feedback yet')],
          e('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            e('input', { value: f.feedbackInput || '', placeholder: 'Add feedback note…', onChange: ev => this.setForm('feedbackInput', ev.target.value), onKeyDown: ev => { if (ev.key === 'Enter') this.addAgentFeedback(a.id, f.feedbackInput || ''); }, style: { flex: 1, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, outline: 'none' } }),
            UI.Btn('Add', () => this.addAgentFeedback(a.id, f.feedbackInput || ''), 'soft', { padding: '8px 12px', fontSize: 12 }))));

      const editSection = editing ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
        UI.Grid('1fr 1fr', 10,
          UI.Field('Name', UI.Input(f.editName !== undefined ? f.editName : a.name, v => this.setForm('editName', v))),
          UI.Field('Email', UI.Input(f.editEmail !== undefined ? f.editEmail : (a.email || ''), v => this.setForm('editEmail', v)))),
        UI.Field('Phone', UI.Input(f.editPhone !== undefined ? f.editPhone : (a.phone || ''), v => this.setForm('editPhone', v))),
        UI.Row({ gap: 8, justifyContent: 'flex-end' },
          UI.Btn('Cancel', () => this.setForm('editing', false), 'soft', { padding: '7px 12px', fontSize: 12 }),
          UI.Btn('Save', () => this.saveAgentEdits(), 'primary', { padding: '7px 12px', fontSize: 12 }))) : null;

      const agentContracts = (d.contracts || []).filter(x => x.party_type === 'agent' && (x.party === a.name || (a.email && x.email === a.email)));
      const scColor = { sent: 'var(--info)', overdue: 'var(--down)', signed: 'var(--up)', canceled: 'var(--text-mute)' };
      const agentContractSection = e('div', null,
        UI.Row({ justifyContent: 'space-between', marginBottom: 7 }, UI.Sub('Contracts'), UI.Btn('+ New', () => { this.closeModal(); this.openModal('wizard', { step: 0, partyType: 'agent', agentName: a.name, email: a.email || '', vat: a.vat || '' }); }, 'ghost', { padding: '3px 10px', fontSize: 11 })),
        agentContracts.length
          ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
              agentContracts.map(ct => e('div', { key: ct.id, onClick: () => { this.closeModal(); this.openModal('contractDetail', { contract: ct }); }, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border-soft)', cursor: 'pointer' } },
                e('div', null,
                  e('div', { style: { fontWeight: 600, fontSize: 13.5, color: 'var(--text)' } }, ct.type || 'Contract'),
                  e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", marginTop: 2 } }, (ct.value || '') + (ct.sent ? ' · sent ' + ct.sent : ''))),
                e('span', { style: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, color: scColor[ct.status] || 'var(--text-mute)', border: '1px solid ' + (scColor[ct.status] || 'var(--border)') } }, (ct.status || 'sent').charAt(0).toUpperCase() + (ct.status || 'sent').slice(1)))))
          : e('div', { style: { fontSize: 13, color: 'var(--text-mute)', padding: '10px 0' } }, 'No contracts yet.'));

      return wrap(a.name, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        UI.Row({ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' },
          UI.Row({ gap: 8 }, a.active ? UI.Pill('Active', 'var(--up)', 'oklch(0.30 0.10 194)') : UI.Pill('Deactivated', 'var(--text-mute)', 'var(--bg-2)'), a.working ? UI.Pill('Working now', 'var(--up)', 'oklch(0.30 0.10 194)') : UI.Pill('Offline', 'var(--text-mute)', 'var(--bg-2)')),
          UI.Btn('Edit info', () => this.setForm('editing', !f.editing), 'soft', { padding: '5px 11px', fontSize: 12 })),
        editSection,
        stageBar,
        f.editStage && f.editStage !== a.status ? UI.Btn('Apply stage change', () => this.saveAgentEdits(), 'primary', { fontSize: 12, padding: '7px 14px' }) : null,
        UI.Grid('1fr 1fr', 12, this._kv('Email', a.email || '—'), this._kv('Phone', a.phone || '—'), this._kv('Dials today', String((d.dials[a.id] || {})[today] || 0)), this._kv('Lifetime paid', this.euro(a.lifetime || 0)), this._kv('Working since', a.workSince ? a.workSince.slice(11) : '—'), this._kv('VAT', a.vat || '—')),
        agentContractSection,
        clientSection,
        feedbackSection),
        [a.active ? UI.Btn('Deactivate', () => { this.toggleAgent(a.id, false); this.closeModal(); }, 'danger') : UI.Btn('Reactivate', () => { this.toggleAgent(a.id, true); this.closeModal(); }, 'soft'), UI.Btn('Send contract', () => { this.closeModal(); this.openModal('wizard', { step: 0, partyType: 'agent', agentName: a.name, email: a.email || '', vat: a.vat || '' }); }, 'primary')], '680px');
    }

    if (k === 'qualityBreakdown') {
      const ratio = list => {
        const done = list.filter(a => a.status !== 'open');
        const canc = done.filter(a => a.status === 'cancel').length;
        const ns = done.filter(a => a.status === 'no_show').length;
        const shows = done.filter(a => a.status === 'show').length;
        return { total: done.length, shows, canc, ns, cancPct: Math.round(canc / (done.length || 1) * 100), nsPct: Math.round(ns / (done.length || 1) * 100), showPct: Math.round(shows / (done.length || 1) * 100) };
      };
      const view = s.qbView || 'client';
      const rows = view === 'client'
        ? d.clients.map(c => ({ name: c.name, ...ratio(d.appointments.filter(a => a.client === c.id)) }))
        : d.agents.filter(a => a.active).map(a => ({ name: a.name.split(' ')[0], ...ratio(d.appointments.filter(ap => ap.agent === a.id)) }));
      const cols = [
        { label: view === 'client' ? 'Client' : 'Agent', render: r => e('span', { style: { color: 'var(--text)', fontWeight: 600 } }, r.name) },
        { label: 'Done', align: 'right', render: r => UI.Mono(String(r.total), { color: 'var(--text-dim)' }) },
        { label: 'Shows', align: 'right', render: r => e('div', { style: { textAlign: 'right' } }, UI.Mono(String(r.shows), { fontWeight: 700, color: 'var(--up)' }), e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)' } }, r.showPct + '%')) },
        { label: 'No-shows', align: 'right', render: r => e('div', { style: { textAlign: 'right' } }, UI.Mono(String(r.ns), { fontWeight: 700, color: r.nsPct > 15 ? 'var(--down)' : 'var(--text-dim)' }), e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)' } }, r.nsPct + '%')) },
        { label: 'Cancelled', align: 'right', render: r => e('div', { style: { textAlign: 'right' } }, UI.Mono(String(r.canc), { fontWeight: 700, color: 'var(--text-dim)' }), e('div', { style: { fontSize: 10.5, color: 'var(--text-mute)' } }, r.cancPct + '%')) },
      ];
      return wrap('Quality breakdown',
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          UI.Seg(view, v => this.setState({ qbView: v }), [{ v: 'client', l: 'Per client' }, { v: 'agent', l: 'Per agent' }]),
          UI.Table(cols, rows, { min: 480, empty: 'No data yet.' })),
        [], '640px');
    }

    if (k === 'invoiceReview') {
      const agent = d.agents.find(a => a.id === f.agentId); if (!agent) return null;
      const { ym, label, readOnly } = f;
      const invApproved = s.invApproved || {};
      const approvedKey = f.agentId + '-' + ym;
      const isApproved = !!invApproved[approvedKey];
      const appts = d.appointments.filter(a => a.agent === agent.id && a.status === 'show' && (a.dateAppt || '').startsWith(ym));
      // Group by subclient when present, otherwise by client
      const byKey = {};
      for (const a of appts) {
        const key = a.sub || a.client;
        if (!byKey[key]) byKey[key] = { clientId: a.client, subId: a.sub || null, appts: [] };
        byKey[key].appts.push(a);
      }
      const getGroupName = (clientId, subId) => {
        const cl = d.clients.find(c => c.id === clientId) || { name: 'Unknown', subclients: [] };
        if (subId) {
          const sc = (cl.subclients || []).find(s => s.id === subId);
          return sc ? sc.name : cl.name;
        }
        return cl.name;
      };
      const rows = Object.entries(byKey).map(([key, g]) => {
        const fallback = (agent.rates || {})[g.subId || g.clientId] || (agent.rates || {})[g.clientId] || 0;
        const name = getGroupName(g.clientId, g.subId);
        const apptAgentRate = a => a.agentRate != null ? a.agentRate : (a.client === 'c15' ? (rnAgentPay(a) ?? fallback) : fallback);
        const total = g.appts.reduce((s2, a) => s2 + apptAgentRate(a), 0);
        const uniqueRates = [...new Set(g.appts.map(apptAgentRate))].sort((a, b) => a - b);
        const rate = uniqueRates.length > 1 ? uniqueRates[0] : (uniqueRates[0] || 0);
        const rateLabel = uniqueRates.length > 1 ? ('€' + uniqueRates[0] + '–€' + uniqueRates[uniqueRates.length - 1]) : null;
        return { key, clientId: g.clientId, subId: g.subId, name, count: g.appts.length, rate, rateLabel, total };
      }).sort((a, b) => b.total - a.total);
      const setterFee = rows.reduce((s2, r) => s2 + r.total, 0);
      const hasMgmt = agent.id === 'a1';
      // Management commission = 15% of (client_rate - agent_rate) for each show by OTHER agents
      const clientRate = ap => {
        const cl = d.clients.find(c => c.id === ap.client);
        const sc = ap.sub && cl ? (cl.subclients || []).find(s => s.id === ap.sub || s.name === ap.sub) : null;
        return (sc && sc.rate != null ? sc.rate : (cl ? cl.rate || 0 : 0));
      };
      const otherAgentAppts = hasMgmt
        ? d.appointments.filter(a => a.agent !== agent.id && a.status === 'show' && (a.dateAppt || '').startsWith(ym))
        : [];
      const mgmtApptRows = otherAgentAppts.map(ap => {
        const ag = d.agents.find(g => g.id === ap.agent);
        const agRate = ap.agentRate != null ? ap.agentRate : (ap.client === 'c15' ? (rnAgentPay(ap) ?? 0) : ((ag && ag.rates) ? ((ag.rates[ap.sub] || ag.rates[ap.client]) || 0) : 0));
        const clRate = clientRate(ap);
        const profit = clRate - agRate;
        const commission = Math.round(profit * 0.15 * 100) / 100;
        return { ap, ag, agRate, clRate, profit, commission };
      }).filter(r => r.profit > 0);
      const mgmtFee = hasMgmt ? Math.round(mgmtApptRows.reduce((s2, r) => s2 + r.commission, 0) * 100) / 100 : 0;
      const rawBonus = (d.invoiceStates || {})[approvedKey]?.bonus || null;
      // normalize: old single-object format → array
      const savedBonuses = Array.isArray(rawBonus) ? rawBonus : (rawBonus && rawBonus.amt != null ? [rawBonus] : []);
      const bonusAmount = savedBonuses.reduce((s, b) => s + (parseFloat(b.amt) || 0), 0);
      // Deal commissions: sum all show appointments for this agent/month that have a deal_commission
      const commissionAppts = appts.filter(a => a.dealCommission != null && a.dealCommission > 0);
      const dealCommissionTotal = commissionAppts.reduce((s, a) => s + a.dealCommission, 0);
      const grandTotal = Math.round((setterFee + mgmtFee + bonusAmount + dealCommissionTotal) * 100) / 100;
      const confirming = !!f.confirmApprove;
      const confirmAdjust = !!f.confirmAdjust;
      const invStatus = (s.invoiceStatus || {})[approvedKey] || 'open';
      const statusSteps = [['open', 'Open'], ['invoice_sent', 'Invoice Sent'], ['invoice_paid', 'Invoice Paid']];
      const statusColors = { open: 'var(--info)', invoice_sent: 'var(--warn)', invoice_paid: 'var(--up)' };
      const body = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          e('span', { style: { fontSize: 13, color: 'var(--text-mute)' } }, agent.name + ' \xb7'),
          isApproved ? UI.Pill('Approved', 'var(--up)', 'oklch(0.28 0.06 152 / .4)') : UI.Pill('Open', 'var(--info)', 'oklch(0.22 0.05 220 / .4)')),
        UI.Table([
          { label: 'Client', render: r => e('span', { style: { fontWeight: 600 } }, r.name) },
          { label: 'Appointments', align: 'right', render: r => UI.Mono(String(r.count)) },
          { label: 'Rate / appt', align: 'right', render: r => UI.Mono(r.rateLabel || this.euro(r.rate), { color: 'var(--text-mute)' }) },
          { label: 'Total', align: 'right', render: r => UI.Mono(this.euro(r.total), { fontWeight: 700, color: 'var(--up)' }) },
        ], rows, { min: 400, empty: 'No show appointments this month.' }),
        rows.length > 0 ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 12, background: 'var(--bg-2)', overflow: 'hidden' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--border-soft)' } },
            e('span', { style: { fontSize: 12.5, color: 'var(--text-mute)' } }, 'Setter commission'),
            e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 600, fontSize: 14 } }, this.euro(setterFee))),
          commissionAppts.length > 0 ? e('div', null,
            e('div', { onClick: () => this.setForm('commissionsOpen', !f.commissionsOpen), style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' } },
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                e('span', { style: { fontSize: 12.5, color: 'var(--text-mute)' } }, '💰 Deal commissions'),
                e('span', { style: { fontSize: 13, color: 'var(--text-mute)', transform: f.commissionsOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
              e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 600, fontSize: 14, color: 'var(--up)' } }, this.euro(dealCommissionTotal))),
            f.commissionsOpen ? e('div', { style: { background: 'var(--bg)', borderBottom: '1px solid var(--border-soft)', padding: '6px 18px 10px' } },
              commissionAppts.map(ap => {
                const cl = d.clients.find(c => c.id === ap.client);
                const sc = ap.sub && cl ? (cl.subclients || []).find(s => s.id === ap.sub) : null;
                return e('div', { key: ap.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-soft)', gap: 10 } },
                  e('div', { style: { flex: 1, minWidth: 0 } },
                    e('div', { style: { fontSize: 12.5, fontWeight: 600 } }, ap.lead || '—'),
                    e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 1 } }, [sc ? sc.name : (cl ? cl.name : ''), ap.dateAppt ? this.fmtDate(ap.dateAppt) : null].filter(Boolean).join(' · '))),
                  e('div', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 13, color: 'var(--up)', flexShrink: 0 } }, this.euro(ap.dealCommission)));
              })) : null) : null,
          hasMgmt && mgmtApptRows.length > 0 ? e('div', null,
            e('div', { onClick: () => this.setForm('mgmtOpen', !f.mgmtOpen), style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' } },
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                e('span', { style: { fontSize: 12.5, color: 'var(--text-mute)' } }, 'Management commission (15% of profit)'),
                e('span', { style: { fontSize: 13, color: 'var(--text-mute)', transform: f.mgmtOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
              e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 600, fontSize: 14, color: 'var(--text-mute)' } }, this.euro(mgmtFee))),
            f.mgmtOpen ? e('div', { style: { background: 'var(--bg)', borderBottom: '1px solid var(--border-soft)', padding: '6px 18px 10px' } },
              e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '4px 0 8px' } }, mgmtApptRows.length + ' appointments · other agents'),
              mgmtApptRows.map(({ ap, ag, agRate, clRate, profit, commission }) => {
                const cl = d.clients.find(c => c.id === ap.client);
                const sc = ap.sub && cl ? (cl.subclients || []).find(s => s.id === ap.sub || s.name === ap.sub) : null;
                return e('div', { key: ap.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-soft)', gap: 10 } },
                  e('div', { style: { flex: 1, minWidth: 0 } },
                    e('div', { style: { fontSize: 12.5, fontWeight: 600 } }, ap.lead || '—'),
                    e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 1 } }, [
                      ag ? ag.name : '',
                      sc ? sc.name : (cl ? cl.name : ''),
                      ap.dateAppt ? this.fmtDate(ap.dateAppt) : null
                    ].filter(Boolean).join(' · '))),
                  e('div', { style: { textAlign: 'right', flexShrink: 0 } },
                    e('div', { style: { fontSize: 12, fontFamily: "'JetBrains Mono'", fontWeight: 700, color: 'var(--up)' } }, this.euro(commission)),
                    e('div', { style: { fontSize: 10, color: 'var(--text-mute)' } }, this.euro(clRate) + ' − ' + this.euro(agRate) + ' = ' + this.euro(profit))));
              })) : null) : null,
          savedBonuses.length > 0 || (!readOnly && !isApproved) ? e('div', null,
            // render each saved bonus as its own row
            ...savedBonuses.map((b, i) =>
              e('div', { key: 'b' + i, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--border-soft)' } },
                e('span', { style: { fontSize: 12.5, color: 'var(--text-mute)' } }, b.desc || 'Bonus'),
                e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  e('span', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 600, fontSize: 14 } }, this.euro(parseFloat(b.amt) || 0)),
                  !readOnly && !isApproved ? UI.Btn('×', async () => {
                    const newBonuses = savedBonuses.filter((_, j) => j !== i);
                    const bonus = newBonuses.length > 0 ? newBonuses : null;
                    await API.upsertInvoiceState(f.agentId, ym, { bonus });
                    this.setState(st => ({ data: { ...st.data, invoiceStates: { ...(st.data.invoiceStates || {}), [approvedKey]: { ...(st.data.invoiceStates?.[approvedKey] || {}), bonus } } } }));
                  }, 'soft', { padding: '2px 8px', fontSize: 12, lineHeight: 1 }) : null))),
            // add new bonus form (admin only, not approved)
            !readOnly && !isApproved
              ? f.bonusOpen
                ? e('div', { style: { padding: '12px 18px', borderBottom: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 8 } },
                    e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 } }, 'Add bonus'),
                    e('input', { type: 'text', placeholder: 'Description (shown to agent)…', value: f.bonusDesc || '', onChange: ev => this.setForm('bonusDesc', ev.target.value),
                      style: { padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' } }),
                    e('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                      e('span', { style: { fontSize: 13, color: 'var(--text-mute)' } }, '€'),
                      e('input', { type: 'number', placeholder: '0', value: f.bonusAmt || '', min: 0, step: 0.01, onChange: ev => this.setForm('bonusAmt', ev.target.value),
                        style: { flex: 1, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' } }),
                      UI.Btn('Save', async () => {
                        const desc = (f.bonusDesc || '').trim();
                        const amt = parseFloat(f.bonusAmt) || 0;
                        if (!desc && !amt) { this.setForm('bonusOpen', false); return; }
                        const newBonuses = [...savedBonuses, { desc, amt }];
                        try {
                          await API.upsertInvoiceState(f.agentId, ym, { bonus: newBonuses });
                          this.setState(st => ({ data: { ...st.data, invoiceStates: { ...(st.data.invoiceStates || {}), [approvedKey]: { ...(st.data.invoiceStates?.[approvedKey] || {}), bonus: newBonuses } } }, form: { ...st.form, bonusOpen: false, bonusDesc: '', bonusAmt: '' } }));
                        } catch(err) {
                          this.toast('Fout', 'Kon bonus niet opslaan: ' + (err?.message || err), 'var(--down)');
                        }
                      }, 'primary', { padding: '8px 14px', fontSize: 12 }),
                      UI.Btn('Cancel', () => this.setState(st => ({ form: { ...st.form, bonusOpen: false, bonusDesc: '', bonusAmt: '' } })), 'soft', { padding: '8px 14px', fontSize: 12 })))
                : e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }, onClick: () => this.setForm('bonusOpen', true) },
                    e('span', { style: { fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 } }, '+ Add bonus'))
              : null) : null,
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px' } },
            e('div', null, e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginBottom: 3 } }, 'Total to invoice'), e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 26 } }, this.euro(grandTotal))),
            e('div', { style: { textAlign: 'right' } }, e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginBottom: 3 } }, 'Own shows'), e('div', { style: { fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 18 } }, String(appts.length))))) : null,
        appts.length > 0 ? e('div', { style: { borderRadius: 12, border: '1px solid var(--border-soft)', overflow: 'hidden' } },
          e('div', { onClick: () => this.setForm('showAppts', !f.showAppts), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', cursor: 'pointer', background: f.showAppts ? 'var(--bg-2)' : 'var(--surface)' } },
            e('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' } }, 'Appointments (' + appts.length + ')'),
            e('span', { style: { fontSize: 16, color: 'var(--text-mute)', transform: f.showAppts ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' } }, '›')),
          f.showAppts ? e('div', { style: { borderTop: '1px solid var(--border-soft)' } },
            ...Object.entries(byKey).sort((a, b) => b[1].appts.length - a[1].appts.length).map(([key, g], ci) => {
              const groupName = getGroupName(g.clientId, g.subId);
              const clientOpen = !!f['apptClient_' + key];
              const sorted = g.appts.slice().sort((a, b) => (b.dateAppt || b.dateLog || '').localeCompare(a.dateAppt || a.dateLog || ''));
              return e('div', { key, style: { borderBottom: ci < Object.keys(byKey).length - 1 ? '1px solid var(--border-soft)' : 'none' } },
                e('div', { onClick: () => this.setForm('apptClient_' + key, !clientOpen), style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', cursor: 'pointer', background: clientOpen ? 'oklch(0.16 0.015 256 / .5)' : 'transparent' } },
                  e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--text)' } }, groupName),
                    e('span', { style: { fontSize: 11.5, color: 'var(--text-mute)' } }, sorted.length + ' appt' + (sorted.length !== 1 ? 's' : ''))),
                  e('span', { style: { fontSize: 15, color: 'var(--text-mute)', transform: clientOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block' } }, '›')),
                clientOpen ? UI.Table([
                  { label: 'Logged', render: r => UI.Mono(this.fmtDate(r.dateLog), { fontSize: 12, color: 'var(--text-mute)' }) },
                  { label: 'Appt date', render: r => UI.Mono(this.fmtDate(r.dateAppt), { fontSize: 12 }) },
                  { label: 'Lead', render: r => e('span', { style: { fontWeight: 600, color: 'var(--text)' } }, r.lead) },
                  { label: 'Amount', align: 'right', render: r => { const fallback = (agent.rates || {})[g.subId || g.clientId] || (agent.rates || {})[g.clientId] || 0; const amt = r.agentRate != null ? r.agentRate : (r.client === 'c15' ? (rnAgentPay(r) ?? fallback) : fallback); return e('span', { style: { fontFamily: "'JetBrains Mono'", fontSize: 12, fontWeight: 700, color: 'var(--up)' } }, this.euro(amt)); } },
                ], sorted, { min: 400 }) : null);
            })) : null) : null,
        readOnly ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          e('div', { style: { padding: '14px 16px', borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
            e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 } }, 'Invoice to'),
            e('div', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 3 } }, 'Curabond BV'),
            e('div', { style: { fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 } },
              'Schoolstraat 43, 9200 Appels', e('br', null),
              'BTW: BE 1016.721.633', e('br', null),
              'invoice@infinite-scale.be'),
            e('div', { style: { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, 'Payment due'),
              e('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' } }, '15th of the following month'))),
          isApproved ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            e('div', null,
              e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 } }, 'Invoice number'),
              e('div', { style: { display: 'flex', gap: 8 } },
                e('input', { type: 'text', placeholder: 'e.g. 2026-001', value: f.invNumber !== undefined ? f.invNumber : ((d.invoiceStates || {})[approvedKey]?.invNumber || ''), onChange: ev => this.setForm('invNumber', ev.target.value),
                  style: { flex: 1, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' } }),
                UI.Btn('Save', () => {
                  const num = f.invNumber !== undefined ? f.invNumber : ((d.invoiceStates || {})[approvedKey]?.invNumber || '');
                  API.upsertInvoiceState(f.agentId, ym, { inv_number: num });
                  this.setState(st => ({ data: { ...st.data, invoiceStates: { ...(st.data.invoiceStates || {}), [approvedKey]: { ...(st.data.invoiceStates?.[approvedKey] || {}), invNumber: num } } } }));
                }, 'soft', { padding: '8px 14px', fontSize: 12 }))),
            ((d.invoiceStates || {})[approvedKey]?.invSent)
              ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'oklch(0.28 0.06 152 / .15)', border: '1px solid oklch(0.5 0.12 152 / .4)' } },
                  e('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--up)' } }, '✓ Invoice sent'),
                  ((d.invoiceStates || {})[approvedKey]?.invNumber) ? e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, '· ' + (d.invoiceStates || {})[approvedKey].invNumber) : null)
              : UI.Btn('Mark invoice as sent', () => {
                  API.upsertInvoiceState(f.agentId, ym, { inv_sent: true });
                  this.setState(st => ({ data: { ...st.data, invoiceStates: { ...(st.data.invoiceStates || {}), [approvedKey]: { ...(st.data.invoiceStates?.[approvedKey] || {}), invSent: true } } } }));
                }, 'primary', { width: '100%', textAlign: 'center' }),
            UI.Btn('⬇ Download TTF', () => window.downloadTTF(agent, ym, rows, grandTotal, hasMgmt, mgmtFee, savedBonuses, commissionAppts.map(a => { const cl = d.clients.find(c => c.id === a.client); const sc = a.sub && cl ? (cl.subclients||[]).find(s=>s.id===a.sub) : null; return { lead: a.lead, client: sc ? sc.name : (cl ? cl.name : ''), amt: a.dealCommission }; })), 'soft', { width: '100%', textAlign: 'center', fontSize: 13 })) : e('div', { style: { fontSize: 13, color: 'var(--text-mute)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' } }, 'Waiting for admin approval before you can update status.')
        ) : (
          !isApproved
            ? confirming
              ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 12, background: 'oklch(0.18 0.08 152 / .3)', border: '1px solid var(--up)' } },
                  e('div', { style: { fontSize: 13.5, fontWeight: 600 } }, 'Confirm approval?'),
                  e('div', { style: { fontSize: 12.5, color: 'var(--text-mute)' } }, 'This locks the invoice for ' + label + ' at ' + this.euro(grandTotal) + '. You can still adjust it later.'),
                  e('div', { style: { display: 'flex', gap: 10, marginTop: 4 } },
                    UI.Btn('Confirm & approve', () => {
                      const inv = { ...(this.state.invApproved || {}), [approvedKey]: true };
                      this._saveInvState('inv_approved', inv);
                      API.upsertInvoiceState(f.agentId, ym, { approved: true });
                      this.setState(st => ({ invApproved: { ...(st.invApproved || {}), [approvedKey]: true }, data: { ...st.data, invoiceStates: { ...(st.data.invoiceStates || {}), [approvedKey]: { ...(st.data.invoiceStates?.[approvedKey] || {}), approved: true } } }, form: { ...st.form, confirmApprove: false } }));
                      this._pushNotif('agent', 'Your ' + label + ' invoice has been approved — ' + this.euro(grandTotal), 'pay', { route: 'payments', modal: 'invoiceReview', modalForm: { agentId: f.agentId, ym, label, readOnly: true } });
                      this._pushNotif('admin', 'Invoice approved: ' + agent.name + ' · ' + label + ' · ' + this.euro(grandTotal), 'bill', { route: 'finances', invExpanded: f.agentId, modal: 'invoiceReview', modalForm: { agentId: f.agentId, ym, label } });
                      this.closeModal();
                    }, 'primary'),
                    UI.Btn('Cancel', () => this.setForm('confirmApprove', false), 'soft')))
              : UI.Btn('Review & approve', () => this.setForm('confirmApprove', true), 'primary', { width: '100%', textAlign: 'center' })
            : confirmAdjust
              ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 12, background: 'oklch(0.18 0.08 0 / .3)', border: '1px solid var(--down)' } },
                  e('div', { style: { fontSize: 13.5, fontWeight: 600 } }, 'Unlock for adjustment?'),
                  e('div', { style: { fontSize: 12.5, color: 'var(--text-mute)' } }, 'This removes the approval lock. You\'ll need to re-approve after any changes.'),
                  e('div', { style: { display: 'flex', gap: 10, marginTop: 4 } },
                    UI.Btn('Yes, unlock', () => { API.upsertInvoiceState(f.agentId, ym, { approved: false }); this.setState(st => { const inv = { ...(st.invApproved || {}) }; delete inv[approvedKey]; this._saveInvState('inv_approved', inv); return { invApproved: inv, data: { ...st.data, invoiceStates: { ...(st.data.invoiceStates || {}), [approvedKey]: { ...(st.data.invoiceStates?.[approvedKey] || {}), approved: false } } }, form: { ...st.form, confirmAdjust: false } }; }); this.closeModal(); }, 'soft'),
                    UI.Btn('Cancel', () => this.setForm('confirmAdjust', false), 'soft')))
              : e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                    UI.Pill('Approved ✓', 'var(--up)', 'oklch(0.28 0.06 152 / .4)'),
                    UI.Btn('Adjust', () => this.setForm('confirmAdjust', true), 'soft', { padding: '6px 14px', fontSize: 12 })),
                  ((d.invoiceStates || {})[approvedKey]?.invSent || (d.invoiceStates || {})[approvedKey]?.invNumber) ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
                    (d.invoiceStates || {})[approvedKey]?.invSent ? e('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--up)' } }, '✓ Invoice sent by agent') : null,
                    (d.invoiceStates || {})[approvedKey]?.invNumber ? e('span', { style: { fontSize: 12, color: 'var(--text-mute)', fontFamily: 'var(--mono, monospace)' } }, '· ' + (d.invoiceStates || {})[approvedKey].invNumber) : null) : null)
        ));
      return wrap('Invoice review — ' + label, body, null, '580px');
    }

    if (k === 'timelineAdd') {
      const STAGES = [
        { id: 'kickoff_call', label: 'Kickoff call' },
        { id: 'kickoff_briefing', label: 'Kickoff briefing' },
        { id: 'agent_matching', label: 'Agent matching' },
        { id: 'briefing_training', label: 'Briefing & training' },
        { id: 'test_calls', label: 'Testbelrondes' },
      ];
      const activeOnTimeline = new Set(d.clients.filter(c => (c.kickoff || c.timelineStage) && c.type !== 'agency').map(c => c.id));
      const available = d.clients.filter(c => c.status === 'active' && !activeOnTimeline.has(c.id));
      const selClient = f.tlAddClient || '';
      const selStage = f.tlAddStage || 'kickoff_call';
      const kickoffVal = f.tlAddKickoff || '';
      const selSubclient = f.tlAddSubclient || '';
      const clientOpts = [{ v: '', l: 'Selecteer client…' }, ...available.map(c => ({ v: c.id, l: c.name }))];
      const selClientObj = selClient ? d.clients.find(c => c.id === selClient) : null;
      const subclients = selClientObj && selClientObj.type === 'agency' ? (selClientObj.subclients || []) : [];
      const subclientOpts = [{ v: '', l: 'Alle subclients / geen specifiek' }, ...subclients.map(sc => ({ v: sc.id, l: sc.name }))];
      const body = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        UI.Field('Client', UI.Select(selClient, v => { this.setForm('tlAddClient', v); this.setForm('tlAddSubclient', ''); }, clientOpts)),
        subclients.length > 0 ? UI.Field('Subclient (optioneel)', UI.Select(selSubclient, v => this.setForm('tlAddSubclient', v), subclientOpts)) : null,
        UI.Field('Kickoff datum (optioneel)', e('input', { type: 'date', value: kickoffVal, onChange: ev => this.setForm('tlAddKickoff', ev.target.value), style: { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--accent)', fontSize: 13, outline: 'none', boxSizing: 'border-box' } })),
        UI.Field('Huidige stage',
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            STAGES.map(sg => e('button', { key: sg.id, onClick: () => this.setForm('tlAddStage', sg.id),
              style: { padding: '8px 14px', borderRadius: 8, border: '1.5px solid ' + (selStage === sg.id ? 'var(--accent)' : 'var(--border)'), background: selStage === sg.id ? 'oklch(0.22 0.05 240 / .2)' : 'transparent', color: selStage === sg.id ? 'var(--accent)' : 'var(--text-dim)', fontWeight: selStage === sg.id ? 700 : 400, fontSize: 13, cursor: 'pointer', textAlign: 'left' } }, sg.label)))));
      return wrap('Client toevoegen aan timeline', body,
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'),
         UI.Btn('Toevoegen', () => {
           if (!selClient) { this.toast('Fout', 'Selecteer een client', 'var(--down)'); return; }
           const updatedSubclients = subclients.length > 0
             ? subclients.map(sc => ({ ...sc, timeline_selected: selSubclient ? sc.id === selSubclient : false }))
             : null;
           const selClientObj2 = d.clients.find(x => x.id === selClient);
           const alreadyOnTimeline = selClientObj2 && (selClientObj2.kickoff || selClientObj2.timelineStage);
           const patch = alreadyOnTimeline ? {} : { kickoff: kickoffVal || null, timeline_stage: selStage };
           if (updatedSubclients) patch.subclients = updatedSubclients;
           API.updateClient(selClient, patch);
           this.mutLocal(dd => {
             const c = dd.clients.find(x => x.id === selClient);
             if (c) {
               if (!alreadyOnTimeline) { c.kickoff = kickoffVal || null; c.timelineStage = selStage; }
               if (updatedSubclients) c.subclients = updatedSubclients;
             }
           });
           this.closeModal();
           this.toast('Toegevoegd', alreadyOnTimeline ? 'Subclient bijgewerkt' : 'Client staat nu op de timeline', 'var(--up)');
         }, 'primary')], '480px');
    }

    if (k === 'timelineDetail') {
      const c = d.clients.find(x => x.id === f.clientId); if (!c) return null;
      const vacancyOptions = [['needed', 'Agent needed ⚠️'], ['filled', 'Position filled ✓'], ['open', 'Position open']];
      const vacancyColors = { needed: 'var(--warn)', filled: 'var(--up)', open: 'var(--info)' };
      const agentStartDate = f.agentStartDate !== undefined ? f.agentStartDate : (c.agentStartDate || '');
      const linkedAgentId = f.linkedAgentId !== undefined ? f.linkedAgentId : (c.linkedAgentId || '');
      const linkedRecruitId = f.linkedRecruitId !== undefined ? f.linkedRecruitId : (c.linkedRecruitId || '');
      const agentVacancy = f.agentVacancy !== undefined ? f.agentVacancy : (c.agentVacancy || 'needed');
      const activeAgents = d.agents.filter(a => a.active);
      const agentOptions = [{ v: '', l: 'No agent linked yet…' }, ...activeAgents.map(a => ({ v: a.id, l: a.name }))];
      const recruitOptions = [{ v: '', l: 'No recruit linked…' }, ...(d.recruits || []).filter(r => r.stage !== 'not_qualified').map(r => ({ v: r.id, l: r.name + ' (' + r.stage + ')' }))];
      const kickoffVal = f.kickoff !== undefined ? f.kickoff : (c.kickoff ? c.kickoff.slice(0, 10) : '');
      const detailSubclients = c.type === 'agency' ? (c.subclients || []) : [];
      const currentTimelineSub = detailSubclients.find(sc => sc.timeline_selected);
      const detailSelSub = f.tlDetailSubclient !== undefined ? f.tlDetailSubclient : (currentTimelineSub ? currentTimelineSub.id : '');
      const detailSubOpts = [{ v: '', l: 'Alle subclients / geen specifiek' }, ...detailSubclients.map(sc => ({ v: sc.id, l: sc.name }))];
      const needsLeadlist = f.needsLeadlist !== undefined ? f.needsLeadlist : !!(c.needsLeadlist);
      const body = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        detailSubclients.length > 0 ? UI.Field('Subclient', UI.Select(detailSelSub, v => this.setForm('tlDetailSubclient', v), detailSubOpts)) : null,
        UI.Field('Kickoff call datum', e('input', { type: 'date', value: kickoffVal, onChange: ev => this.setForm('kickoff', ev.target.value), style: { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--accent)', fontSize: 13, outline: 'none', boxSizing: 'border-box' } })),
        e('label', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: '1px solid ' + (needsLeadlist ? 'var(--warn)' : 'var(--border-soft)'), background: needsLeadlist ? 'oklch(0.20 0.06 60 / .25)' : 'var(--bg-2)', cursor: 'pointer' } },
          e('input', { type: 'checkbox', checked: needsLeadlist, onChange: ev => this.setForm('needsLeadlist', ev.target.checked), style: { width: 16, height: 16, accentColor: 'var(--warn)', cursor: 'pointer' } }),
          e('span', { style: { fontWeight: 700, fontSize: 13, color: needsLeadlist ? 'var(--warn)' : 'var(--text-dim)' } }, '📋 Leadlist aanmaken'),
          needsLeadlist ? e('span', { style: { fontSize: 11, color: 'var(--warn)', marginLeft: 4 } }, '— nog te doen') : e('span', { style: { fontSize: 11, color: 'var(--text-mute)', marginLeft: 4 } }, '— niet vereist')),
        UI.Field('Agent startdatum (effectieve opstart)', e('input', { type: 'date', value: agentStartDate, onChange: ev => this.setForm('agentStartDate', ev.target.value), style: { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--accent)', fontSize: 13, outline: 'none', boxSizing: 'border-box' } })),
        UI.Field('Vacancy status',
          e('div', { style: { display: 'flex', gap: 8 } },
            vacancyOptions.map(([val, lbl]) => {
              const active = agentVacancy === val;
              const col = vacancyColors[val];
              return e('button', { key: val, onClick: () => this.setForm('agentVacancy', val),
                style: { flex: 1, padding: '9px 10px', borderRadius: 10, border: '2px solid ' + (active ? col : 'var(--border)'), background: active ? 'oklch(0.18 0.04 120 / .3)' : 'transparent', color: active ? col : 'var(--text-mute)', fontWeight: 700, fontSize: 11.5, cursor: 'pointer', transition: 'all .15s', textAlign: 'center' } }, lbl);
            }))),
        UI.Field('Link to existing agent', UI.Select(linkedAgentId, v => this.setForm('linkedAgentId', v), agentOptions)),
        UI.Field('Link to potential recruit', UI.Select(linkedRecruitId, v => this.setForm('linkedRecruitId', v), recruitOptions)));
      return wrap(c.name + ' — timeline', body,
        [UI.Btn('Verwijder van timeline', () => { if (confirm('Project van timeline verwijderen?')) { API.updateClient(c.id, { kickoff: null, timeline_stage: null }); this.mutLocal(dd => { const cl = dd.clients.find(x => x.id === c.id); if (cl) { cl.kickoff = null; cl.timelineStage = null; } }); this.closeModal(); } }, 'danger', { marginRight: 'auto' }),
         UI.Btn('Cancel', () => this.closeModal(), 'soft'),
         UI.Btn('Save', () => {
           const subPatch = detailSubclients.length > 0
             ? detailSubclients.map(sc => ({ ...sc, timeline_selected: detailSelSub ? sc.id === detailSelSub : false }))
             : null;
           this.saveTimelineData(c.id, agentStartDate, linkedAgentId, linkedRecruitId, agentVacancy, kickoffVal, subPatch, needsLeadlist);
           this.closeModal();
         }, 'primary')], '520px');
    }

    if (k === 'agentDayStats') {
      const a = d.agents.find(x => x.id === f.id); if (!a) return null;
      const today = this.iso(this.today());
      const dialsToday = (d.dials[a.id] || {})[today] || 0;
      const apptsToday = d.appointments.filter(ap => ap.agent === a.id && ap.dateLog === today);
      const earningsToday = apptsToday.reduce((sum, ap) => sum + (ap.amount || 0), 0);

      const statBox = (label, val, color) => e('div', { style: { flex: 1, padding: '14px 16px', borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 4 } },
        e('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.04em' } }, label),
        e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 24, color: color || 'var(--text)', lineHeight: 1.1 } }, val));

      const apptList = apptsToday.length
        ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' } },
            apptsToday.map((ap, i) => {
              const cl = d.clients.find(c => c.id === ap.client);
              return e('div', { key: ap.id, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
                e('div', { style: { width: 24, height: 24, borderRadius: 8, background: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 } },
                  e('span', { style: { fontSize: 11, fontWeight: 700, color: 'var(--accent-ink)' } }, String(i + 1))),
                e('div', { style: { flex: 1 } },
                  e('div', { style: { fontWeight: 600, fontSize: 13, color: 'var(--text)' } }, ap.lead || '—'),
                  e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', marginTop: 1 } }, [cl ? cl.name : ap.client, ap.dateAppt ? ' · appt ' + this.fmtDate(ap.dateAppt) : ''].filter(Boolean).join(''))),
                ap.loggedAt ? e('div', { style: { fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'", flexShrink: 0 } }, new Date(ap.loggedAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })) : null,
                ap.amount ? e('div', { style: { fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 700, color: 'var(--up)' } }, this.euro(ap.amount)) : null);
            }))
        : e('div', { style: { padding: '18px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13, fontStyle: 'italic' } }, 'No appointments logged today.');

      const feedbackSection = e('div', null,
        UI.Sub('Feedback / optimization points', { marginBottom: 7 }),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          (a.feedback || []).length ? a.feedback.map((fb, i) => e('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
            e('div', { style: { flex: 1, fontSize: 13, color: 'var(--text-dim)', padding: '8px 11px', background: 'var(--bg-2)', borderRadius: 9, lineHeight: 1.4 } }, fb),
            e('button', { onClick: () => this.removeAgentFeedback(a.id, i), style: { flexShrink: 0, width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--down)', cursor: 'pointer', fontSize: 14, display: 'grid', placeItems: 'center' } }, '×'))) : [UI.Sub('No feedback yet')],
          e('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            e('input', { value: f.feedbackInput || '', placeholder: 'Add feedback note…', onChange: ev => this.setForm('feedbackInput', ev.target.value), onKeyDown: ev => { if (ev.key === 'Enter') this.addAgentFeedback(a.id, f.feedbackInput || ''); }, style: { flex: 1, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, outline: 'none' } }),
            UI.Btn('Add', () => this.addAgentFeedback(a.id, f.feedbackInput || ''), 'soft', { padding: '8px 12px', fontSize: 12 }))));

      const assignedClients = d.clients.filter(c => (a.clients || []).includes(c.id));
      const clientsSection = assignedClients.length
        ? e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            assignedClients.map(c => e('div', { key: c.id, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-2)', border: '1px solid var(--border-soft)' } },
              e('div', { style: { width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 } }),
              e('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' } }, c.name),
              e('span', { style: { fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'" } }, '€' + ((a.rates || {})[c.id] || 0) + '/appt'))))
        : e('span', { style: { fontSize: 12.5, color: 'var(--text-mute)', fontStyle: 'italic' } }, 'No clients assigned.');

      return wrap(a.name + ' — today', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: { display: 'flex', gap: 10 } },
          statBox('Dials today', String(dialsToday)),
          statBox('Appointments', String(apptsToday.length)),
          statBox('Earned today', this.euro(earningsToday), earningsToday > 0 ? 'var(--up)' : 'var(--text)')),
        e('div', null, UI.Sub('Clients', { marginBottom: 8 }), clientsSection),
        e('div', null, UI.Sub('Appointments logged today', { marginBottom: 8 }), apptList),
        feedbackSection),
        [UI.Btn('Full profile', () => { this.closeModal(); this.openModal('agentProfile', { id: a.id }); }, 'soft')], '560px');
    }

    if (k === 'recruitProfile') {
      const r = d.recruits.find(x => x.id === f.id); if (!r) return null;
      const actLog = f._actLog !== undefined ? f._actLog : (r.activityLog || []);
      const notesVal = f._notes !== undefined ? f._notes : (r.notes || '');
      const notesDirty = f._notesDirty || false;
      const saveNotes = async () => {
        this.mutLocal(dd => { const rec = dd.recruits.find(x => x.id === r.id); if (rec) rec.notes = notesVal; });
        await API.updateRecruit(r.id, { notes: notesVal });
        this.setForm('_notesDirty', false);
        this.toast('Opgeslagen ✓', 'Notities bewaard', 'var(--up)');
      };
      const addActivity = async () => {
        const type = f._actType || 'call';
        const note = (f._actNote || '').trim();
        if (!note) return;
        const entry = { type, note, at: new Date().toISOString(), by: d.me?.name || 'Admin' };
        const newLog = [entry, ...actLog];
        this.setForm('_actLog', newLog);
        this.setForm('_actNote', '');
        this.mutLocal(dd => { const rec = dd.recruits.find(x => x.id === r.id); if (rec) rec.activityLog = newLog; });
        await API.updateRecruit(r.id, { activity_log: newLog });
      };
      const typeOpts = [{ v: 'call', l: '📞 Gebeld' }, { v: 'text', l: '💬 Getekst' }, { v: 'email', l: '✉️ Email' }, { v: 'meeting', l: '🤝 Gesprek' }, { v: 'other', l: '📝 Ander' }];
      const typeLabel = t => ({ call: '📞', text: '💬', email: '✉️', meeting: '🤝', other: '📝' }[t] || '📝');
      const fmtDate = iso => { try { const d2 = new Date(iso); return d2.toLocaleDateString('nl-BE', { day: '2-digit', month: 'short' }) + ' ' + d2.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }); } catch(_) { return iso; } };
      return wrap(r.name, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
        UI.Grid('1fr 1fr', 12, this._kv('Email', r.email || ''), this._kv('Phone', r.phone || ''), this._kv('Country', r.country || ''), this._kv('Language', r.lang || ''), this._kv('Age', String(r.age || '')), this._kv('Source', r.source || ''), this._kv('Position', r.position || ''), this._kv('Can start', r.start || '')),
        e('div', null, UI.Sub('Availability', { marginBottom: 6 }), e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, (r.avail || []).map(x => UI.Pill(x, 'var(--text-dim)', 'var(--bg-2)')))),
        UI.Field('Motivation', e('div', { style: { fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg-2)', borderRadius: 10 } }, r.motivation)),
        this._kv('Experience', r.experience || ''),
        e('div', { style: { borderTop: '1px solid var(--border-soft)', paddingTop: 14 } },
          UI.Sub('Notities', { marginBottom: 8 }),
          e('textarea', {
            value: notesVal,
            onChange: ev => { this.setForm('_notes', ev.target.value); this.setForm('_notesDirty', true); },
            placeholder: 'Voeg notities toe over deze kandidaat…',
            rows: 4,
            style: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit', outline: 'none' },
          }),
          notesDirty ? e('div', { style: { marginTop: 6, display: 'flex', justifyContent: 'flex-end' } }, UI.Btn('Opslaan', saveNotes, 'primary')) : null),
        e('div', { style: { borderTop: '1px solid var(--border-soft)', paddingTop: 14 } },
          UI.Sub('Activiteit loggen', { marginBottom: 8 }),
          e('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
            e('div', { style: { width: 140, flexShrink: 0 } }, UI.Select(f._actType || 'call', v => this.setForm('_actType', v), typeOpts)),
            e('input', {
              type: 'text',
              value: f._actNote || '',
              onChange: ev => this.setForm('_actNote', ev.target.value),
              onKeyDown: ev => { if (ev.key === 'Enter') addActivity(); },
              placeholder: 'Korte beschrijving…',
              style: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' },
            }),
            UI.Btn('Log', addActivity, 'soft')),
          actLog.length > 0 ? e('div', { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 } },
            actLog.map((entry, i) => e('div', { key: i, style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 8, borderLeft: '3px solid var(--accent)' } },
              e('span', { style: { fontSize: 16, flexShrink: 0, marginTop: 1 } }, typeLabel(entry.type)),
              e('div', { style: { flex: 1, minWidth: 0 } },
                e('div', { style: { fontSize: 13, color: 'var(--text)' } }, entry.note),
                e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginTop: 2 } }, fmtDate(entry.at) + (entry.by ? ' · ' + entry.by : ''))))))
          : e('div', { style: { marginTop: 8, fontSize: 12.5, color: 'var(--text-mute)', fontStyle: 'italic' } }, 'Nog geen activiteit gelogd.'))),
        [UI.Btn('Not qualified', () => { this.advanceRecruit(r.id, 'not_qualified'); this.closeModal(); }, 'danger'), UI.Btn('Qualify', () => { this.advanceRecruit(r.id, 'qualified'); this.closeModal(); }, 'soft'), UI.Btn('Move to contract', () => { this.closeModal(); this.openModal('wizard', { step: 0, agent: r.name }); }, 'primary')], '640px');
    }

    if (k === 'wizard') {
      const step = f.step || 0;
      const pt = f.partyType || 'client';
      const isAgent = pt === 'agent';
      const isAddendum = pt === 'addendum';
      const ctypeOpts = isAgent
        ? [{ v: '', l: 'Kies type…' }, { v: '_h1', l: '── Raamovereenkomst ──', disabled: true }, { v: 'Standaardcontract', l: 'Standaardcontract (raamovereenkomst)' }, { v: '_h2', l: '── Addendum templates (bij raamovereenkomst) ──', disabled: true }, { v: 'Addendum — Per afspraak', l: 'Addendum — Per afspraak' }, { v: 'Addendum — Commissie', l: 'Addendum — Commissie (%)' }, { v: 'Addendum — Uurtarief', l: 'Addendum — Uurtarief' }, { v: '_h3', l: '── Standalone overeenkomsten ──', disabled: true }, { v: 'Service agreement', l: 'Samenwerkingsovereenkomst' }, { v: 'Commission', l: 'Commissieovereenkomst' }, { v: 'Hourly rate', l: 'Uurtariefovereenkomst' }]
        : [{ v: '', l: 'Kies type…' }, { v: '_hp', l: '── Pilot (proefperiode) ──', disabled: true }, { v: 'Pilot — Leadopvolging', l: 'Pilot — Leadopvolging' }, { v: 'Pilot — Cold Calling', l: 'Pilot — Cold Calling' }, { v: 'Contract', l: 'MSA / Contract (verlenging / volledig)' }];
      const payTermOpts = [{ v: '7', l: '7 kalenderdagen' }, { v: '14', l: '14 kalenderdagen' }, { v: '30', l: '30 kalenderdagen' }];
      const titleFor = isAddendum ? 'Addendum' : pt === 'agent' ? 'Agentcontract' : 'Klantcontract';

      const _initContractIframe = (vars, agentMode) => {
        setTimeout(async () => {
          const container = document.getElementById('contract-iframe-container');
          if (!container) return;
          if (container._iframeInited) return;
          container._iframeInited = true;

          // Show loading spinner while AI analyses
          const spinner = document.createElement('div');
          spinner.id = 'contract-ai-spinner';
          spinner.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:380px;gap:14px;color:var(--text-mute);font-size:13px;';
          spinner.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg><span>AI analyseert contract…</span>';
          const style = document.createElement('style');
          style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
          document.head.appendChild(style);
          container.appendChild(spinner);

          let aiVars = {};
          try {
            const res = await fetch('/api/enhance-contract', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ctype: vars.ctype, party: vars.party || vars.agentName, rate: vars.rate, setupFee: vars.setupFee, duration: vars.duration, paymentTerm: vars.paymentTerm, notes: vars.notes, isAgent: agentMode }),
            });
            if (res.ok) {
              const data = await res.json();
              aiVars = { aiScopeAddition: data.scopeAddition, aiSpecialConditions: data.specialConditions, aiDurationNote: data.durationNote };
            }
          } catch (_) {}

          container.removeChild(spinner);
          const mergedVars = { ...vars, ...aiVars };
          const html = window.ContractTemplates ? ContractTemplates.generate(mergedVars.ctype, agentMode, mergedVars) : '<p>Template niet beschikbaar.</p>';
          const iframe = document.createElement('iframe');
          iframe.id = 'wizard-contract-iframe';
          iframe.style.cssText = 'width:100%;height:380px;border:none;display:block;background:#fff;';
          container.appendChild(iframe);
          iframe.srcdoc = html;
          iframe.addEventListener('load', () => {
            try {
              iframe.contentDocument.designMode = 'on';
              iframe.contentDocument.body.style.cursor = 'text';
            } catch (_) {}
          });
        }, 60);
      };

      const step3Body = (agentMode, vars) => {
        _initContractIframe(vars, agentMode);
        return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          e('div', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Contractvoorbeeldweergave — klik om te bewerken'),
          e('div', {
            id: 'contract-iframe-container',
            style: { width: '100%', height: 380, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff' },
          }),
          e('div', { style: { padding: 10, borderRadius: 10, background: 'oklch(0.18 0.07 194 / .4)', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 } },
            '✏️ Klik in het contract om tekst te bewerken. Versturen naar: ',
            e('b', { style: { color: 'var(--text)' } }, vars.email || '—'),
            vars.ctype === 'Addendum'
              ? [' · Project: ', e('b', { style: { color: 'var(--text)' } }, vars.endClientName || vars.project || '—')]
              : ['  ·  Tarief: ', e('b', { style: { color: 'var(--text)' } }, vars.rate ? '€' + vars.rate + '/afspraak' : '—')]));
      };

      // Build addendum pay component rows UI
      const addPayRow = () => {
        const rows = Array.isArray(f.payComponents) ? [...f.payComponents] : [];
        rows.push({ type: 'Per geldige afspraak', amount: '' });
        this.setForm('payComponents', rows);
      };
      const removePayRow = (idx) => {
        const rows = Array.isArray(f.payComponents) ? [...f.payComponents] : [];
        rows.splice(idx, 1);
        this.setForm('payComponents', rows);
      };
      const updatePayRow = (idx, key, val) => {
        const rows = Array.isArray(f.payComponents) ? f.payComponents.map(r => ({ ...r })) : [];
        if (rows[idx]) rows[idx][key] = val;
        this.setForm('payComponents', rows);
      };
      const payTypeOpts = [
        { v: 'Vaste maandelijkse vergoeding', l: 'Vaste maandelijkse vergoeding' },
        { v: 'Per geldige afspraak', l: 'Per geldige afspraak' },
        { v: 'Per geverifieerde lead', l: 'Per geverifieerde lead' },
        { v: 'Per uur', l: 'Per uur' },
      ];
      const payRows = Array.isArray(f.payComponents) ? f.payComponents : [];
      const agentOpts = [{ v: '', l: 'Kies agent…' }, ...(d.agents || []).filter(a => a.active !== false).map(a => ({ v: a.id, l: a.name }))];
      const clientOpts = [{ v: '', l: 'Kies eindklant/project…' }, ...(d.clients || []).filter(c => c.status !== 'inactive').map(c => ({ v: c.id, l: c.name }))];

      const addendumTypeOpts = [
        { v: '', l: 'Kies template…' },
        { v: 'per-afspraak', l: 'Per afspraak (standaard)' },
        { v: 'commissie', l: 'Commissie (percentage)' },
        { v: 'uurtarief', l: 'Uurtarief' },
        { v: 'custom', l: 'Vrij invullen' },
      ];
      const applyAddendumTemplate = (tpl) => {
        if (tpl === 'per-afspraak') this.setForm('payComponents', [{ type: 'Per geldige afspraak', amount: '' }]);
        else if (tpl === 'commissie') this.setForm('payComponents', [{ type: 'Commissie %', amount: '' }]);
        else if (tpl === 'uurtarief') this.setForm('payComponents', [{ type: 'Per uur', amount: '' }]);
        else this.setForm('payComponents', []);
        this.setForm('addendumTpl', tpl);
      };

      const steps = isAddendum ? [
        { t: 'Agent & Project', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            UI.Field('Addendum type', UI.Select(f.addendumTpl || '', v => applyAddendumTemplate(v), addendumTypeOpts)),
            f.addendumTpl === 'custom' ? e('div', { style: { fontSize: 13, color: 'var(--accent)', padding: '10px 14px', borderRadius: 9, background: 'rgba(103,220,223,0.08)', border: '1px solid rgba(103,220,223,0.25)', marginTop: -4 } }, '✓ Vrij invullen — stel de vergoedingsstructuur in op de volgende stap.') : null,
            UI.Field('Agent', UI.Select(f.agentId || '', v => {
              const agent = (d.agents || []).find(a => a.id === v);
              this.setForm('agentId', v);
              if (agent) { this.setForm('agentName', agent.name); this.setForm('email', agent.email || ''); }
            }, agentOpts)),
            UI.Field('Eindklant / Project', UI.Select(f.clientId || '', v => {
              const client = (d.clients || []).find(c => c.id === v);
              this.setForm('clientId', v);
              if (client) this.setForm('endClientName', client.name);
            }, clientOpts)),
            UI.Grid('1fr 1fr', 10,
              UI.Field('Ingangsdatum', UI.Input(f.startDate, v => this.setForm('startDate', v), 'DD/MM/YYYY')),
              UI.Field('Datum hoofdovereenkomst', UI.Input(f.mainContractDate, v => this.setForm('mainContractDate', v), 'DD/MM/YYYY'))),
            UI.Field('Omschrijving diensten', UI.Area(f.addendumServices || '', v => this.setForm('addendumServices', v), 'Telefonisch contacteren van leads…'))) },
        { t: 'Vergoeding & Vereisten', body: (() => {
            if (f.addendumTpl === 'custom') {
              // ── Rich "Vrij invullen" composer ──
              const DAY_OPTS = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
              const selDays = Array.isArray(f.customDays) ? f.customDays : [];
              const toggleDay = (d) => {
                const next = selDays.includes(d) ? selDays.filter(x => x !== d) : [...selDays, d];
                this.setForm('customDays', next);
              };
              const PAY_TYPES = [
                { k: 'perAfspraak', l: 'Per afspraak', unit: '€/afspraak' },
                { k: 'perUur',      l: 'Per uur',      unit: '€/uur' },
                { k: 'commissie',   l: 'Commissie',     unit: '%' },
                { k: 'vasteFee',    l: 'Vaste fee',     unit: '€/maand' },
                { k: 'uitzonderlijk', l: 'Uitzonderlijk / overig', unit: null },
              ];
              const sel = f.customPaySel || {};
              const vals = f.customPayVals || {};
              const setPaySel = (k, v) => this.setForm('customPaySel', { ...sel, [k]: v });
              const setPayVal = (k, v) => this.setForm('customPayVals', { ...vals, [k]: v });
              const secLabel = (t) => e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 } }, t);
              return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
                secLabel('Vergoedingsstructuur'),
                e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  ...PAY_TYPES.map(pt =>
                    e('div', { key: pt.k, style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                      e('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text)', minWidth: 160 } },
                        e('input', { type: 'checkbox', checked: !!sel[pt.k], onChange: ev => setPaySel(pt.k, ev.target.checked) }),
                        pt.l),
                      sel[pt.k] && pt.unit && pt.k !== 'uitzonderlijk'
                        ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                            e('input', { type: pt.k === 'commissie' ? 'number' : 'number', min: 0, step: pt.k === 'commissie' ? 0.1 : 0.01, value: vals[pt.k] || '', onChange: ev => setPayVal(pt.k, ev.target.value), placeholder: pt.k === 'commissie' ? '10' : '35', style: { width: 80, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' } }),
                            e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, pt.unit))
                        : null,
                      sel[pt.k] && pt.k === 'uitzonderlijk'
                        ? e('input', { value: vals.uitzonderlijkText || '', onChange: ev => setPayVal('uitzonderlijkText', ev.target.value), placeholder: 'Omschrijf uitzonderlijke vergoeding…', style: { flex: 1, minWidth: 200, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' } })
                        : null))),
                e('div', { style: { height: 1, background: 'var(--border)' } }),
                secLabel('Beschikbaarheid & minimale vereisten'),
                e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                  ...DAY_OPTS.map(d =>
                    e('button', { key: d, onClick: () => toggleDay(d), style: { padding: '5px 11px', borderRadius: 7, border: selDays.includes(d) ? 'none' : '1px solid var(--border)', background: selDays.includes(d) ? 'var(--accent)' : 'var(--surface-2)', color: selDays.includes(d) ? 'oklch(0.12 0 0)' : 'var(--text-dim)', fontWeight: 700, fontSize: 13, cursor: 'pointer' } }, d))),
                UI.Grid('1fr 1fr', 10,
                  UI.Field('Uren per dag', UI.Input(f.customHoursPerDay || '', v => this.setForm('customHoursPerDay', v), 'bv. 4', 'number')),
                  UI.Field('Min. belacties per dag', UI.Input(f.minDials || '', v => this.setForm('minDials', v), 'bv. 50 of /', 'number'))),
                e('div', { style: { height: 1, background: 'var(--border)' } }),
                secLabel('Belmomenten'),
                e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  UI.Field('Van', e('input', { type: 'time', value: f.callFrom || '', onChange: ev => this.setForm('callFrom', ev.target.value), style: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' } })),
                  e('span', { style: { color: 'var(--text-mute)', paddingTop: 20 } }, '–'),
                  UI.Field('Tot', e('input', { type: 'time', value: f.callTo || '', onChange: ev => this.setForm('callTo', ev.target.value), style: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' } }))),
                e('div', { style: { height: 1, background: 'var(--border)' } }),
                secLabel('Kwalificatiecriteria voor een afspraak'),
                UI.Field('', UI.Area(f.validApptDef || '', v => this.setForm('validApptDef', v), 'Een afspraak is geldig wanneer de contactpersoon…')),
                e('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)', marginTop: 4 } },
                  e('input', { type: 'checkbox', checked: !!f.hasNda, onChange: ev => this.setForm('hasNda', ev.target.checked) }),
                  'Eindklant heeft NDA met Infinite Scale (NDA-clausule toevoegen)'));
            }
            // ── Standard pay-row composer (non-custom templates) ──
            return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              e('div', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Vergoedingsstructuur'),
              ...payRows.map((row, idx) =>
                e('div', { key: idx, style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
                  e('div', { style: { flex: 2 } }, UI.Field('Type', UI.Select(row.type, v => updatePayRow(idx, 'type', v), payTypeOpts))),
                  e('div', { style: { flex: 1 } }, UI.Field('Bedrag (€)', UI.Input(row.amount, v => updatePayRow(idx, 'amount', v), '0', 'number'))),
                  e('button', { onClick: () => removePayRow(idx), style: { marginBottom: 2, padding: '6px 10px', background: 'var(--surface-2)', border: 'none', borderRadius: 6, cursor: 'pointer', color: 'var(--text-mute)', fontSize: 14 } }, '✕'))),
              e('button', { onClick: addPayRow, style: { alignSelf: 'flex-start', padding: '6px 14px', background: 'var(--surface-2)', border: '1px dashed var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 13 } }, '+ Vergoeding toevoegen'),
              e('div', { style: { height: 1, background: 'var(--border)', margin: '4px 0' } }),
              UI.Grid('1fr 1fr', 10,
                UI.Field('Beschikbaarheid (dagen)', UI.Input(f.availabilityDays || '', v => this.setForm('availabilityDays', v), 'Ma-Vrij')),
                UI.Field('Uren per dag', UI.Input(f.availabilityHours || '', v => this.setForm('availabilityHours', v), 'bv. 4u per dag'))),
              UI.Field('Minimum belacties per dag', UI.Input(f.minDials || '', v => this.setForm('minDials', v), 'bv. 50 of / indien geen minimum')),
              payRows.some(r => r.type === 'Per geldige afspraak') ? UI.Field('Definitie geldige afspraak', UI.Area(f.validApptDef || '', v => this.setForm('validApptDef', v), 'Een afspraak is geldig wanneer…')) : null,
              payRows.some(r => r.type === 'Per geverifieerde lead') ? UI.Field('Definitie geverifieerde lead', UI.Area(f.validLeadDef || '', v => this.setForm('validLeadDef', v), 'Een lead is geverifieerd wanneer…')) : null,
              e('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' } },
                e('input', { type: 'checkbox', checked: !!f.hasNda, onChange: ev => this.setForm('hasNda', ev.target.checked) }),
                'Eindklant heeft NDA met Infinite Scale (NDA-clausule toevoegen)'));
          })() },
        { t: 'Bekijk & verzend', body: step3Body(true, {
            ctype: 'Addendum',
            agentName: f.agentName,
            email: f.email,
            endClientName: f.endClientName || f.endProject || '',
            project: f.endClientName || '',
            mainContractDate: f.mainContractDate || '',
            startDate: f.startDate || '',
            services: f.addendumServices || '',
            payComponents: (() => {
              if (f.addendumTpl !== 'custom') return Array.isArray(f.payComponents) ? f.payComponents : [];
              const PAY_MAP = [
                { k: 'perAfspraak', type: 'Per geldige afspraak' },
                { k: 'perUur', type: 'Per uur' },
                { k: 'commissie', type: 'Commissie (%)' },
                { k: 'vasteFee', type: 'Vaste maandelijkse vergoeding' },
                { k: 'uitzonderlijk', type: 'Uitzonderlijk / overig' },
              ];
              const sel = f.customPaySel || {};
              const vals = f.customPayVals || {};
              return PAY_MAP.filter(p => sel[p.k]).map(p => ({
                type: p.type,
                amount: p.k === 'uitzonderlijk' ? (vals.uitzonderlijkText || '') : (vals[p.k] || ''),
              }));
            })(),
            minDials: f.minDials || '',
            availabilityDays: f.addendumTpl === 'custom' ? (Array.isArray(f.customDays) ? f.customDays.join(', ') : '') : (f.availabilityDays || ''),
            availabilityHours: f.addendumTpl === 'custom' ? (f.customHoursPerDay || '') : (f.availabilityHours || ''),
            validApptDef: f.validApptDef || '',
            validLeadDef: f.validLeadDef || '',
            hasNda: !!f.hasNda,
            callFrom: f.callFrom || '',
            callTo: f.callTo || '',
            customPaySel: f.customPaySel || {},
            customPayVals: f.customPayVals || {},
            addendumTpl: f.addendumTpl || '',
          }) },
      ] : isAgent ? [
        { t: 'Agentgegevens', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            UI.Field('Naam agent', UI.Input(f.agentName, v => this.setForm('agentName', v), 'Volledige naam')),
            UI.Field('Adres', UI.Input(f.agentAddress || '', v => this.setForm('agentAddress', v), 'Straat 1, 9000 Gent')),
            UI.Grid('1fr 1fr', 10, UI.Field('E-mail', UI.Input(f.email, v => this.setForm('email', v), 'agent@email.com', 'email')), UI.Field('Ondernemingsnummer', UI.Input(f.vat, v => this.setForm('vat', v), 'BE 0123.456.789')))) },
        { t: 'Contractvoorwaarden', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            UI.Field('Contracttype', UI.Select(f.ctype || '', v => this.setForm('ctype', v), ctypeOpts)),
            f.ctype !== 'Standaardcontract' ? UI.Grid('1fr 1fr', 10, UI.Field('Tarief / afspraak', UI.Input(f.rate, v => this.setForm('rate', v), '€35')), UI.Field('Looptijd', UI.Input(f.duration, v => this.setForm('duration', v), '4 weken / doorlopend'))) : null,
            f.ctype !== 'Standaardcontract' ? UI.Grid('1fr 1fr', 10, UI.Field('Betaaltermijn', UI.Select(String(f.paymentTerm || '14'), v => this.setForm('paymentTerm', v), payTermOpts)), UI.Field('Opstartvergoeding (€, optioneel)', UI.Input(f.setupFee, v => this.setForm('setupFee', v), 'bv. 500', 'number'))) : null,
            UI.Field('Bijzondere voorwaarden', UI.Area(f.notes, v => this.setForm('notes', v)))) },
        { t: 'Bekijk & verzend', body: step3Body(true, { ctype: f.ctype || 'Standaardcontract', agentName: f.agentName, agentAddress: f.agentAddress, email: f.email, vat: f.vat, rate: f.rate, setupFee: f.setupFee, duration: f.duration, paymentTerm: f.paymentTerm || '14', notes: f.notes }) },
      ] : (() => {
        const isPilotLeadopvolging = f.ctype === 'Pilot — Leadopvolging';
        const isPilotColdCalling = f.ctype === 'Pilot — Cold Calling';
        const isPilot = isPilotLeadopvolging || isPilotColdCalling;
        const isContract = f.ctype === 'Contract';

        const typeStep = { t: 'Contracttype', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          UI.Field('Wat voor contract wil je aanmaken?', UI.Select(f.ctype || '', v => { this.setForm('ctype', v); this.setForm('step', 0); }, ctypeOpts)),
          f.ctype ? null : e('div', { style: { padding: '14px 16px', borderRadius: 10, background: 'var(--bg-2)', fontSize: 13, color: 'var(--text-mute)', lineHeight: 1.6 } },
            'Selecteer een contracttype om verder te gaan. Pilot — Leadopvolging en Pilot — Cold Calling hebben een specifieke wizard met kwalificatiecriteria en vergoedingsstructuur.')) };

        if (isPilot) {
          const herkomstOpts = [{ v: '', l: 'Kies…' }, { v: 'eigen leads (opdrachtgever)', l: 'Eigen leads (opdrachtgever)' }, { v: 'leads van Infinite Scale', l: 'Leads van Infinite Scale' }, { v: 'gemengd', l: 'Gemengd' }];
          const secLbl = (t) => e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 } }, t);
          const PILOT_PAY = [
            { k: 'perAfspraak', l: 'Per gehouden afspraak', unit: '€/afspraak', placeholder: 'bv. 75' },
            { k: 'perUur', l: 'Per uur', unit: '€/uur', placeholder: 'bv. 45' },
            { k: 'commissie', l: 'Commissie', unit: '%', placeholder: 'bv. 10', step: '0.1' },
            { k: 'opstartkost', l: 'Opstartkost (eenmalig)', unit: '€', placeholder: 'bv. 500' },
            { k: 'capacityFee', l: 'Vaste capaciteitsfee', unit: '€/maand', placeholder: 'bv. 300' },
          ];
          const pilotPaySel = f.pilotPaySel || {};
          const pilotPayVals = f.pilotPayVals || {};
          const setPPSel = (k, v) => this.setForm('pilotPaySel', { ...pilotPaySel, [k]: v });
          const setPPVal = (k, v) => this.setForm('pilotPayVals', { ...pilotPayVals, [k]: v });
          const qualCriteria = Array.isArray(f.qualCriteria) && f.qualCriteria.length > 0 ? f.qualCriteria : [{ text: '' }];
          const addCrit = () => this.setForm('qualCriteria', [...qualCriteria, { text: '' }]);
          const remCrit = (i) => this.setForm('qualCriteria', qualCriteria.filter((_, idx) => idx !== i));
          const updCrit = (i, val) => { const next = qualCriteria.map((c, idx) => idx === i ? { text: val } : c); this.setForm('qualCriteria', next); };

          const bedrijfsStep = { t: 'Bedrijfsgegevens', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            UI.Grid('1fr 1fr', 10, UI.Field('Bedrijfsnaam', UI.Input(f.company, v => this.setForm('company', v), 'ACME BV')), UI.Field('Contactpersoon + functie', UI.Input(f.contact, v => this.setForm('contact', v), 'Jan Janssen, Zaakvoerder'))),
            UI.Grid('1fr 1fr', 10, UI.Field('BTW-nummer', UI.Input(f.vat, v => this.setForm('vat', v), 'BE 0123.456.789')), UI.Field('E-mail', UI.Input(f.email, v => this.setForm('email', v), 'naam@bedrijf.be', 'email'))),
            UI.Field('Adres', UI.Input(f.address, v => this.setForm('address', v), 'Kerkstraat 1, 9000 Gent'))) };

          const vergoedingStep = { t: 'Vergoeding', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            secLbl('Vergoedingsstructuur — selecteer wat van toepassing is'),
            e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              ...PILOT_PAY.map(pt =>
                e('div', { key: pt.k, style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                  e('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text)', minWidth: 240 } },
                    e('input', { type: 'checkbox', checked: !!pilotPaySel[pt.k], onChange: ev => setPPSel(pt.k, ev.target.checked) }), pt.l),
                  pilotPaySel[pt.k] ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    e('input', { type: 'number', min: 0, step: pt.step || 0.01, value: pilotPayVals[pt.k] || '', onChange: ev => setPPVal(pt.k, ev.target.value), placeholder: pt.placeholder, style: { width: 90, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' } }),
                    e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, pt.unit)) : null))),
            e('div', { style: { height: 1, background: 'var(--border)', margin: '2px 0' } }),
            e('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text)' } },
              e('input', { type: 'checkbox', checked: !!f.hasBellijst, onChange: ev => this.setForm('hasBellijst', ev.target.checked) }),
              'Optionele dienst: Infinite Scale stelt ook de bellijst/leadlijst op'),
            f.hasBellijst ? UI.Grid('1fr 1fr', 10,
              UI.Field('Prijs bellijst', UI.Input(f.bellijstPrice || '', v => this.setForm('bellijstPrice', v), 'bv. €150 eenmalig')),
              UI.Field('Bron contactgegevens', UI.Input(f.bellijstBron || '', v => this.setForm('bellijstBron', v), 'bv. LinkedIn Sales Navigator'))) : null,
            e('div', { style: { height: 1, background: 'var(--border)', margin: '2px 0' } }),
            UI.Grid('1fr 1fr', 10,
              UI.Field('Pilootduur (maanden)', UI.Input(f.pilotMonths || '2', v => this.setForm('pilotMonths', v), '2', 'number')),
              UI.Field('Betaaltermijn', UI.Select(String(f.paymentTerm || '14'), v => this.setForm('paymentTerm', v), payTermOpts)))) };

          const pilotVarsBase = { party: f.company, contact: f.contact, email: f.email, vat: f.vat, address: f.address, pilotMonths: f.pilotMonths || '2', paymentTerm: f.paymentTerm || '14', pilotPaySel: f.pilotPaySel || {}, pilotPayVals: f.pilotPayVals || {}, hasBellijst: f.hasBellijst, bellijstPrice: f.bellijstPrice, bellijstBron: f.bellijstBron };

          if (isPilotLeadopvolging) {
            return [
              typeStep,
              bedrijfsStep,
              { t: 'Kwalificatiecriteria', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
                e('div', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Wanneer is een afspraak factureerbaar?'),
                UI.Field('Definitie geldige afspraak', UI.Area(f.validApptDef || '', v => this.setForm('validApptDef', v), 'Een afspraak is factureerbaar wanneer de lead aanwezig was op het afgesproken tijdstip (show-up) en voldeed aan de vooraf afgesproken criteria…'))) },
              vergoedingStep,
              { t: 'Bekijk & verzend', body: step3Body(false, { ctype: 'Pilot — Leadopvolging', ...pilotVarsBase, validApptDef: f.validApptDef }) },
            ];
          }

          return [
            typeStep,
            bedrijfsStep,
            { t: 'Scope & Doelgroep', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              UI.Field('Doelsector / product', UI.Input(f.doelsector || '', v => this.setForm('doelsector', v), 'bv. thuisbatterijen, zonnepanelen')),
              UI.Field('Doelgroep', UI.Input(f.doelgroep || '', v => this.setForm('doelgroep', v), 'bv. B2B — KMO, Vlaanderen, beslisser')),
              UI.Field('Herkomst leads', UI.Select(f.herkomstLeads || '', v => this.setForm('herkomstLeads', v), herkomstOpts))) },
            { t: 'Kwalificatiecriteria', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
              e('div', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Kwalificatiecriteria voor een factureerbare afspraak'),
              e('div', { style: { fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 } }, 'Elk criterium wordt opgenomen in het contract. Voeg toe of verwijder naar wens.'),
              e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                ...qualCriteria.map((c, i) =>
                  e('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    e('span', { style: { fontSize: 12, color: 'var(--text-mute)', minWidth: 82, fontWeight: 600, flexShrink: 0 } }, `Criterium ${i + 1}:`),
                    e('input', { value: c.text, onChange: ev => updCrit(i, ev.target.value), placeholder: i === 0 ? 'bv. Bedrijf actief in doelsector' : i === 1 ? 'bv. Beslisser aan de lijn' : 'bv. Min. 10 medewerkers', style: { flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' } }),
                    qualCriteria.length > 1 ? e('button', { onClick: () => remCrit(i), style: { padding: '6px 10px', background: 'var(--surface-2)', border: 'none', borderRadius: 6, cursor: 'pointer', color: 'var(--text-mute)', fontSize: 14, flexShrink: 0 } }, '✕') : null))),
              e('button', { onClick: addCrit, style: { alignSelf: 'flex-start', padding: '6px 14px', background: 'var(--surface-2)', border: '1px dashed var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 13, marginTop: 4 } }, '+ Criterium toevoegen')) },
            vergoedingStep,
            { t: 'Bekijk & verzend', body: step3Body(false, { ctype: 'Pilot — Cold Calling', ...pilotVarsBase, doelsector: f.doelsector, doelgroep: f.doelgroep, herkomstLeads: f.herkomstLeads, qualCriteria: f.qualCriteria && f.qualCriteria.length > 0 ? f.qualCriteria : [{ text: '' }] }) },
          ];
        }
        return [
          typeStep,
          { t: 'Bedrijfsgegevens', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              UI.Grid('1fr 1fr', 10, UI.Field('Bedrijfsnaam', UI.Input(f.company, v => this.setForm('company', v), 'ACME BV')), UI.Field('Contactpersoon', UI.Input(f.contact, v => this.setForm('contact', v), 'Jan Janssen'))),
              UI.Grid('1fr 1fr', 10, UI.Field('BTW-nummer', UI.Input(f.vat, v => this.setForm('vat', v), 'BE 0123.456.789')), UI.Field('E-mail', UI.Input(f.email, v => this.setForm('email', v), 'naam@bedrijf.be', 'email'))),
              UI.Field('Adres', UI.Input(f.address, v => this.setForm('address', v), 'Kerkstraat 1, 9000 Gent'))) },
          { t: 'Contractvoorwaarden', body: e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              UI.Grid('1fr 1fr', 10, UI.Field('Tarief / afspraak', UI.Input(f.rate, v => this.setForm('rate', v), '€45')), UI.Field('Looptijd', UI.Input(f.duration, v => this.setForm('duration', v), '4 weken / doorlopend'))),
              UI.Grid('1fr 1fr', 10, UI.Field('Betaaltermijn', UI.Select(String(f.paymentTerm || '14'), v => this.setForm('paymentTerm', v), payTermOpts)), UI.Field('Opstartvergoeding (€, optioneel)', UI.Input(f.setupFee, v => this.setForm('setupFee', v), 'bv. 500', 'number'))),
              UI.Field('Bijzondere voorwaarden', UI.Area(f.notes, v => this.setForm('notes', v)))) },
          { t: 'Bekijk & verzend', body: step3Body(false, { ctype: f.ctype, party: f.company, contact: f.contact, email: f.email, vat: f.vat, address: f.address, rate: f.rate, setupFee: f.setupFee, duration: f.duration, paymentTerm: f.paymentTerm || '14', notes: f.notes }) },
        ];
      })();
      const cur = steps[step];
      const totalSteps = steps.length;

      const onBack = () => {
        // Reset iframe so last step regenerates fresh on next visit
        const container = document.getElementById('contract-iframe-container');
        if (container) container._iframeInited = false;
        this.setForm('step', step - 1);
      };

      const onSendContract = () => {
        const iframe = document.getElementById('wizard-contract-iframe');
        if (iframe && iframe.contentDocument) {
          window._editedContractHtml = iframe.contentDocument.documentElement.outerHTML;
        }
        this.sendContract();
      };

      return wrap(titleFor + ' · Stap ' + (step + 1) + '/' + totalSteps + ' — ' + cur.t, cur.body,
        [step > 0 ? UI.Btn('← Terug', onBack, 'soft') : UI.Btn('Annuleren', () => this.closeModal(), 'soft'),
        step < totalSteps - 1 ? UI.Btn('Volgende →', () => this.setForm('step', step + 1), 'primary') : UI.Btn('Genereer & verstuur link', onSendContract, 'primary')], '600px');
    }

    if (k === 'contractDetail') {
      const c = f.contract || {};
      const id = c.id;
      const editing = !!f.editingContract;
      const statuses = ['sent', 'overdue', 'signed', 'canceled', 'void'];
      const statusColor = { sent: 'var(--info)', overdue: 'var(--down)', signed: 'var(--up)', canceled: 'var(--text-mute)', void: 'var(--down)' };
      const statusBg = { sent: 'oklch(0.22 0.05 220 / .35)', overdue: 'oklch(0.22 0.08 0 / .35)', signed: 'oklch(0.22 0.08 152 / .35)', canceled: 'oklch(0.18 0.02 256 / .35)', void: 'oklch(0.22 0.08 0 / .35)' };
      const curStatus = f.contractStatus !== undefined ? f.contractStatus : (c.status || 'sent');
      if (editing) {
        return wrap('Edit contract — ' + c.party, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          UI.Grid('1fr 1fr', 10, UI.Field('Party / company', UI.Input(f.eParty !== undefined ? f.eParty : c.party, v => this.setForm('eParty', v))), UI.Field('Email', UI.Input(f.eEmail !== undefined ? f.eEmail : (c.email || ''), v => this.setForm('eEmail', v)))),
          UI.Grid('1fr 1fr', 10, UI.Field('VAT number', UI.Input(f.eVat !== undefined ? f.eVat : (c.vat || ''), v => this.setForm('eVat', v))), UI.Field('Contract type', UI.Input(f.eType !== undefined ? f.eType : (c.type || ''), v => this.setForm('eType', v)))),
          UI.Field('Address', UI.Input(f.eAddress !== undefined ? f.eAddress : (c.address || ''), v => this.setForm('eAddress', v))),
          UI.Grid('1fr 1fr', 10, UI.Field('Terms / rate', UI.Input(f.eValue !== undefined ? f.eValue : (c.value || ''), v => this.setForm('eValue', v))), UI.Field('Duration', UI.Input(f.eDuration !== undefined ? f.eDuration : (c.duration || ''), v => this.setForm('eDuration', v)))),
          UI.Field('Notes', UI.Area(f.eNotes !== undefined ? f.eNotes : (c.notes || ''), v => this.setForm('eNotes', v)))),
          [UI.Btn('Cancel', () => this.setForm('editingContract', false), 'soft'),
           UI.Btn('Save changes', () => {
             const updates = {
               party: f.eParty !== undefined ? f.eParty : c.party,
               email: f.eEmail !== undefined ? f.eEmail : (c.email || ''),
               vat: f.eVat !== undefined ? f.eVat : (c.vat || ''),
               type: f.eType !== undefined ? f.eType : (c.type || ''),
               address: f.eAddress !== undefined ? f.eAddress : (c.address || ''),
               value: f.eValue !== undefined ? f.eValue : (c.value || ''),
               duration: f.eDuration !== undefined ? f.eDuration : (c.duration || ''),
               notes: f.eNotes !== undefined ? f.eNotes : (c.notes || ''),
             };
             this.updateContract(id, updates);
             this.setForm('editingContract', false);
           }, 'primary')], '580px');
      }
      const row = (label, val) => val ? e('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-start' } },
        e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', minWidth: 90, paddingTop: 1 } }, label),
        e('span', { style: { fontSize: 13.5, color: 'var(--text)', fontWeight: 500 } }, val)) : null;
      return wrap('Contract — ' + c.party, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          statuses.map(st => e('button', { key: st, onClick: () => { this.setForm('contractStatus', st); this.updateContract(id, { status: st }); },
            style: { padding: '7px 16px', borderRadius: 20, border: '2px solid ' + (curStatus === st ? statusColor[st] : 'var(--border)'), background: curStatus === st ? (statusBg[st] || 'oklch(0.22 0.05 220 / .35)') : 'transparent', color: curStatus === st ? statusColor[st] : 'var(--text-mute)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', transition: 'all .15s' } },
            st.charAt(0).toUpperCase() + st.slice(1)))),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 12, background: 'var(--bg-2)', position: 'relative' } },
          e('button', { onClick: () => this.setForm('editingContract', true), title: 'Bewerken',
            style: { position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 } },
            e('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
              e('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
              e('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }))),
          row('Company', c.party), row('Contact', c.contact), row('Email', c.email), row('VAT', c.vat), row('Address', c.address),
          row('Type', c.type), row('Terms', c.value), row('Duration', c.duration), row('Sent', c.sent),
          c.notes ? row('Notes', c.notes) : null,
          c.pdf_url ? e('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4 } },
            e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em', minWidth: 90, paddingTop: 1 } }, 'PDF'),
            e('a', { href: c.pdf_url, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 } }, '📄 Bekijk geüpload contract')) : null),
        c.signing_link ? e('div', { style: { padding: 12, borderRadius: 10, background: 'oklch(0.18 0.04 256 / .5)', border: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } },
          e('div', { style: { flex: 1, minWidth: 0 } },
            e('div', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', marginBottom: 4 } }, 'SIGNING LINK'),
            e('div', { style: { fontSize: 12, fontFamily: "'JetBrains Mono'", color: 'var(--accent)', wordBreak: 'break-all' } }, c.signing_link)),
          c.status !== 'void' ? e('button', {
            onClick: () => {
              if (!c.email) { this.toast('Fout', 'Geen e-mail gevonden', 'var(--down)'); return; }
              const freshLink = 'https://platform.infinite-scale.be/sign?token=' + c.id;
              const updates = { signing_link: freshLink };
              if (c.status === 'signed') updates.status = 'sent';
              this.updateContract(c.id, updates);
              if (c.status === 'signed') this.setForm('contractStatus', 'sent');
              API.sendContractEmail({ to: c.email, party: c.party, contractType: c.type || 'Contract', contractValue: c.value || '—', signingLink: freshLink, notes: c.notes || '' })
                .then(() => this.toast('Verzonden ✓', 'Signing link bezorgd aan ' + c.email, 'var(--up)'))
                .catch(err => this.toast('Mislukt', 'E-mail niet verzonden: ' + (err.message || 'onbekende fout'), 'var(--down)'));
            },
            style: { flexShrink: 0, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-dim)', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'Manrope'" }
          }, c.status === 'signed' ? 'Opnieuw versturen' : 'Resend link') : null) : null,
        (() => {
          const contractEvents = (d.activityLog || []).filter(function(l) {
            return (l.action === 'contract_viewed' || l.action === 'contract_signed') &&
              l.extra && l.extra.contract_id === id;
          }).sort(function(a, b) { return a.created_at > b.created_at ? 1 : -1; });
          if (!contractEvents.length) return null;
          return e('div', { style: { borderRadius: 12, border: '1px solid var(--border-soft)', overflow: 'hidden' } },
            e('div', { style: { padding: '9px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border-soft)', fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.08em' } }, 'Contract activiteit'),
            contractEvents.map(function(ev, i) {
              const isSign = ev.action === 'contract_signed';
              const col = isSign ? 'var(--up)' : 'var(--info)';
              const icon = isSign ? '✅' : '👁';
              const ts = new Date(ev.created_at).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              return e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: i > 0 ? '1px solid var(--border-soft)' : 'none', background: isSign ? 'oklch(0.18 0.06 152 / .15)' : 'transparent' } },
                e('span', { style: { fontSize: 15 } }, icon),
                e('div', { style: { flex: 1 } },
                  e('div', { style: { fontSize: 12.5, fontWeight: 700, color: col } }, isSign ? 'Getekend' : 'Geopend'),
                  e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)' } }, ev.details || '')),
                e('span', { style: { fontSize: 11, fontFamily: "'JetBrains Mono'", color: 'var(--text-mute)' } }, ts));
            }));
        })()),
        [c.status !== 'void' ? UI.Btn('Void contract', () => {
           if (!confirm('Weet je zeker dat je dit contract wil annuleren? ' + (c.email ? 'Er wordt een e-mail gestuurd naar ' + c.email + '.' : ''))) return;
           this.setForm('contractStatus', 'void');
           this.updateContract(c.id, { status: 'void' });
           if (c.email) {
             fetch('/api/send-email', {
               method: 'POST', headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ to: c.email, subject: 'Contract geannuleerd — Infinite Scale', html: `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#0f1117;font-family:'Helvetica Neue',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#181c27;border-radius:18px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;padding:40px 44px;"><p style="margin:0 0 6px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67dcdf;font-weight:700;">Contractmelding</p><h1 style="margin:0 0 20px;font-size:24px;font-weight:800;color:#ffffff;">Contract geannuleerd</h1><p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#8b9bbf;">Beste ${c.party || ''},<br><br>Uw contract <strong style="color:#fff;">${c.type || 'Contract'}</strong> met Infinite Scale is geannuleerd. Heeft u vragen, neem dan contact op via <a href="mailto:info@infinite-scale.be" style="color:#67dcdf;text-decoration:none;">info@infinite-scale.be</a>.</p></td></tr><tr><td style="padding:20px 0;text-align:center;"><p style="margin:0;font-size:11px;color:#3d4d6a;">© ${new Date().getFullYear()} Curabond BV · Infinite Scale</p></td></tr></table></td></tr></table></body></html>` })
             }).then(() => this.toast('E-mail verzonden', 'Annuleringsmail gestuurd naar ' + c.email, 'var(--up)'))
               .catch(() => {});
           }
           this.toast('Geannuleerd', 'Contract gemarkeerd als void', 'var(--text-mute)');
         }, 'danger') : null,
         c.contract_html ? UI.Btn('Bekijken', () => { _showContractOverlay(_signedContractHtml(c), false); }, 'soft') : null,
         c.contract_html ? UI.Btn('PDF downloaden', () => { _showContractOverlay(_signedContractHtml(c), true); }, 'ghost') : null,
         c.status === 'signed' && c.party_type === 'client' && !d.clients.find(cl => cl.name?.toLowerCase() === c.party?.toLowerCase())
           ? UI.Btn('Convert to Client', () => this.convertContractToClient(c), 'primary') : null,
         UI.Btn('Sluiten', () => this.closeModal(), 'primary')], '560px');
    }

    if (k === 'agentFinanceDetail') {
      const agent = d.agents.find(a => a.id === f.agentId); if (!agent) return null;
      const appts = d.appointments.filter(a => a.agent === agent.id && !a.invoiced && a.status === 'show');
      const clientIds = [...new Set(appts.map(a => a.client))];
      const rows = clientIds.map(cid => {
        const cl = d.clients.find(c => c.id === cid);
        const clAppts = appts.filter(a => a.client === cid);
        const rev = clAppts.length * (cl ? cl.rate || 0 : 0);
        const payout = clAppts.reduce((s, a) => s + (a.agentRate != null ? a.agentRate : (a.client === 'c15' ? (rnAgentPay(a) ?? 0) : ((agent.rates || {})[a.client] || 0))), 0);
        return { client: cl ? cl.name : cid, appts: clAppts.length, rev, payout, profit: rev - payout };
      }).sort((a, b) => b.rev - a.rev);
      const totRev = rows.reduce((s, r) => s + r.rev, 0);
      const totPayout = rows.reduce((s, r) => s + r.payout, 0);
      const totProfit = totRev - totPayout;
      return wrap('Revenue & profit — ' + agent.name,
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          UI.Grid('1fr 1fr 1fr', 10,
            UI.C({ borderTop: '3px solid var(--info)', padding: '14px 16px' }, e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600, marginBottom: 4 } }, 'REVENUE'), e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 22 } }, this.euro(totRev))),
            UI.C({ borderTop: '3px solid var(--accent)', padding: '14px 16px' }, e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600, marginBottom: 4 } }, 'PAYOUT'), e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 22 } }, this.euro(totPayout))),
            UI.C({ borderTop: '3px solid ' + (totProfit >= 0 ? 'var(--up)' : 'var(--down)'), padding: '14px 16px' }, e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600, marginBottom: 4 } }, 'PROFIT'), e('div', { style: { fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 22, color: totProfit >= 0 ? 'var(--up)' : 'var(--down)' } }, this.euro(totProfit)))),
          rows.length === 0
            ? e('div', { style: { textAlign: 'center', padding: '24px', color: 'var(--text-mute)', fontSize: 13 } }, 'No uninvoiced shows yet.')
            : UI.C({ padding: 0, overflow: 'hidden' },
                UI.Table([
                  { label: 'Client', render: r => e('span', { style: { fontWeight: 600 } }, r.client) },
                  { label: 'Appts', align: 'right', render: r => String(r.appts) },
                  { label: 'Revenue', align: 'right', render: r => UI.Mono(this.euro(r.rev), { color: 'var(--info)', fontWeight: 700 }) },
                  { label: 'Payout', align: 'right', render: r => UI.Mono(this.euro(r.payout), { color: 'var(--accent)', fontWeight: 700 }) },
                  { label: 'Profit', align: 'right', render: r => UI.Mono(this.euro(r.profit), { color: r.profit >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }) },
                ], rows, { min: 480 }))),
        [UI.Btn('Sluiten', () => this.closeModal(), 'primary')], '620px');
    }

    if (k === 'prospectDetail') {
      const p = f.prospect || {};
      const stages = [['new', 'New lead'], ['first', 'First contact'], ['meeting', 'Meeting booked'], ['followup', 'Follow-up'], ['closed', 'Closed'], ['lost', 'Lost']];
      const editingP = !!f.editingProspect;
      if (editingP) {
        return wrap('Edit prospect — ' + p.company, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          UI.Grid('1fr 1fr', 10, UI.Field('Company', UI.Input(f.pCompany !== undefined ? f.pCompany : (p.company || ''), v => this.setForm('pCompany', v))), UI.Field('Contact', UI.Input(f.pContact !== undefined ? f.pContact : (p.contact || ''), v => this.setForm('pContact', v)))),
          UI.Grid('1fr 1fr', 10, UI.Field('Phone', UI.Input(f.pPhone !== undefined ? f.pPhone : (p.phone || ''), v => this.setForm('pPhone', v))), UI.Field('Email', UI.Input(f.pEmail !== undefined ? f.pEmail : (p.email || ''), v => this.setForm('pEmail', v)))),
          UI.Grid('1fr 1fr', 10, UI.Field('Owner', UI.Input(f.pOwner !== undefined ? f.pOwner : (p.assigned || ''), v => this.setForm('pOwner', v))), UI.Field('Source', UI.Select(f.pSource !== undefined ? f.pSource : (p.source || 'LinkedIn'), v => this.setForm('pSource', v), [{ v: 'LinkedIn', l: 'LinkedIn' }, { v: 'Cold email', l: 'Cold email' }, { v: 'Referral', l: 'Referral' }, { v: 'Meta forms', l: 'Meta forms' }, { v: 'Website', l: 'Website' }, { v: 'Cold call', l: 'Cold call' }]))),
          UI.Grid('1fr 1fr', 10, UI.Field('Meeting / next date', UI.Input(f.pNextDate !== undefined ? f.pNextDate : (p.next_date || ''), v => this.setForm('pNextDate', v), '', 'date')), e('div', null)),
          UI.Field('Notes', UI.Area(f.pNotes !== undefined ? f.pNotes : (p.notes || ''), v => this.setForm('pNotes', v)))),
          [UI.Btn('Cancel', () => this.setForm('editingProspect', false), 'soft'),
           UI.Btn('Save', () => {
             const updates = { company: f.pCompany !== undefined ? f.pCompany : p.company, contact: f.pContact !== undefined ? f.pContact : (p.contact||''), phone: f.pPhone !== undefined ? f.pPhone : (p.phone||''), email: f.pEmail !== undefined ? f.pEmail : (p.email||''), assigned: f.pOwner !== undefined ? f.pOwner : (p.assigned||''), source: f.pSource !== undefined ? f.pSource : (p.source||''), next_date: f.pNextDate !== undefined ? f.pNextDate : (p.next_date||''), notes: f.pNotes !== undefined ? f.pNotes : (p.notes||'') };
             this.updateProspectDetail(p.id, updates);
             this.setState(st => ({ form: { ...st.form, editingProspect: false, prospect: { ...p, ...updates } } }));
           }, 'primary')], '560px');
      }
      const kv = (label, val) => val ? e('div', null, e('span', { style: { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em' } }, label + ': '), e('span', { style: { color: 'var(--text)', fontSize: 13.5 } }, val)) : null;
      return wrap(p.company || 'Prospect', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          stages.map(([sv, sl]) => e('button', { key: sv, onClick: () => { this.moveProspect(p.id, sv); this.setForm('prospect', { ...p, stage: sv }); },
            style: { padding: '6px 14px', borderRadius: 20, border: '2px solid ' + (p.stage === sv ? 'var(--accent)' : 'var(--border)'), background: p.stage === sv ? 'oklch(0.20 0.10 194 / .5)' : 'transparent', color: p.stage === sv ? 'var(--accent)' : 'var(--text-mute)', fontWeight: 700, fontSize: 12, cursor: 'pointer' } }, sl))),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 12, background: 'var(--bg-2)' } },
          kv('Contact', p.contact), kv('Phone', p.phone), kv('Email', p.email), kv('Owner', p.assigned), kv('Source', p.source),
          kv('Next action', p.next_action), kv('Next date', p.next_date), kv('Last follow-up', p.last_followup),
          p.notes ? e('div', { style: { marginTop: 6, padding: 10, borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 } }, p.notes) : null)),
        [UI.Btn('Edit', () => this.setForm('editingProspect', true), 'soft'),
         UI.Btn('Follow-up', () => { this.closeModal(); this.openModal('prospectFollowup', { prospect: p }); }, 'ghost'),
         UI.Btn('Create contract', () => { this.closeModal(); this.openModal('wizard', { step: 0, partyType: 'client', company: p.company, contact: p.contact, email: p.email || '' }); }, 'primary')], '560px');
    }

    if (k === 'prospectFollowup') {
      const p = f.prospect || {};
      const fuType = f.fuType || 'email';
      const tpl = f.tpl || 'checkin';
      const templates = {
        checkin: { label: 'Check-in', subject: 'Quick check-in — ' + p.company, body: 'Hi ' + (p.contact || 'there') + ',\n\nJust checking in — have you had a chance to look at what we discussed?\n\nHappy to jump on a quick call if you have any questions.\n\nBest,\n[Your name]\nInfinite Scale' },
        meeting: { label: 'Meeting request', subject: 'Let\'s reconnect — ' + p.company, body: 'Hi ' + (p.contact || 'there') + ',\n\nI\'d love to schedule a follow-up call to go over the next steps.\n\nWhen works best for you this week or next?\n\nBest,\n[Your name]\nInfinite Scale' },
        postdemo: { label: 'Post-demo follow-up', subject: 'After our call — ' + p.company, body: 'Hi ' + (p.contact || 'there') + ',\n\nThanks for your time earlier! I hope the overview was useful.\n\nDo you have any questions, or is there anything you\'d like to clarify before moving forward?\n\nBest,\n[Your name]\nInfinite Scale' },
        closing: { label: 'Closing push', subject: 'Spot opening up — ' + p.company, body: 'Hi ' + (p.contact || 'there') + ',\n\nWe have a spot opening up next week and I wanted to give you first pick before we go to the next prospect.\n\nShall we lock it in?\n\nBest,\n[Your name]\nInfinite Scale' },
      };
      const cur = templates[tpl] || templates.checkin;
      const emailBody = f.emailBody !== undefined ? f.emailBody : cur.body;
      return wrap('Follow-up — ' + p.company, e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        e('div', { style: { display: 'flex', gap: 8 } },
          [['email', '📧 Email'], ['whatsapp', '💬 WhatsApp'], ['call', '📞 Call logged'], ['meeting', '🤝 Meeting']].map(([tv, tl]) =>
            e('button', { key: tv, onClick: () => this.setForm('fuType', tv), style: { flex: 1, padding: '8px 4px', borderRadius: 10, border: '2px solid ' + (fuType === tv ? 'var(--accent)' : 'var(--border)'), background: fuType === tv ? 'oklch(0.20 0.10 194 / .4)' : 'transparent', color: fuType === tv ? 'var(--accent)' : 'var(--text-mute)', fontWeight: 700, fontSize: 12, cursor: 'pointer' } }, tl))),
        fuType === 'email' ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            Object.entries(templates).map(([tk, tv]) =>
              e('button', { key: tk, onClick: () => { this.setForm('tpl', tk); this.setForm('emailBody', undefined); }, style: { padding: '5px 12px', borderRadius: 20, border: '1px solid ' + (tpl === tk ? 'var(--accent)' : 'var(--border)'), background: tpl === tk ? 'oklch(0.20 0.10 194 / .4)' : 'var(--bg-2)', color: tpl === tk ? 'var(--accent)' : 'var(--text-dim)', fontWeight: 600, fontSize: 12, cursor: 'pointer' } }, tv.label))),
          UI.Field('Subject', UI.Input(cur.subject, () => {})),
          e('textarea', { value: emailBody, onChange: ev => this.setForm('emailBody', ev.target.value), rows: 9, style: { width: '100%', padding: 12, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical', outline: 'none' } }))
        : e('div', { style: { padding: 16, borderRadius: 12, background: 'var(--bg-2)', fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.7 } },
            fuType === 'whatsapp' ? '💬 Log that a WhatsApp message was sent to ' + (p.phone || p.contact || p.company) + '.' : fuType === 'call' ? '📞 Log that a call was made to ' + (p.contact || p.company) + '.' : '🤝 Log that a meeting took place with ' + (p.contact || p.company) + '.'),
        ),
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'),
         UI.Btn(fuType === 'email' ? 'Send email' : 'Log ' + fuType, () => this.sendFollowupEmail(p.id, cur.label, emailBody), 'primary')], '560px');
    }

    if (k === 'tplEditor') {
      return wrap('Template editor — ' + (f.type || ''), e('div', null,
        UI.Row({ gap: 6, marginBottom: 10 }, ['Bold', 'Italic', 'H2', 'List', 'Variable'].map(b => e('button', { key: b, style: { padding: '6px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-dim)', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, b))),
        e('textarea', { defaultValue: `# ${f.type || ''} Agreement\n\nBetween **Infinite Scale** and **{{company}}**.\n\nCompensation: **{{rate}}** per booked appointment.\nPilot period: **{{pilot}}**.\n\nBilling occurs monthly based on approved appointment statuses.\n\nSigned: {{date}}`, rows: 12, style: { width: '100%', padding: 14, borderRadius: 11, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13.5, fontFamily: "'JetBrains Mono'", lineHeight: 1.6, resize: 'vertical' } }),
        UI.Sub('Variables in {{ }} are filled per contract. Stored as Markdown.', { marginTop: 8 })),
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'), UI.Btn('Save template', () => { this.closeModal(); this.toast('Template', 'Saved', 'var(--up)'); }, 'primary')], '600px');
    }

    if (k === 'prospectAdd') {
      return wrap('Add prospect', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        UI.Grid('1fr 1fr', 10, UI.Field('Company', UI.Input(f.company, v => this.setForm('company', v))), UI.Field('Contact', UI.Input(f.contact, v => this.setForm('contact', v)))),
        UI.Grid('1fr 1fr', 10, UI.Field('Phone', UI.Input(f.phone, v => this.setForm('phone', v))), UI.Field('Email', UI.Input(f.email, v => this.setForm('email', v)))),
        UI.Grid('1fr 1fr', 10, UI.Field('Owner', UI.Input(f.assigned || '', v => this.setForm('assigned', v), 'Your name')), UI.Field('Source', UI.Select(f.source || 'LinkedIn', v => this.setForm('source', v), [{ v: 'LinkedIn', l: 'LinkedIn' }, { v: 'Cold email', l: 'Cold email' }, { v: 'Referral', l: 'Referral' }, { v: 'Meta forms', l: 'Meta forms' }, { v: 'Website', l: 'Website' }, { v: 'Cold call', l: 'Cold call' }]))),
        UI.Grid('1fr 1fr', 10, UI.Field('Meeting / next date', UI.Input(f.next_date || '', v => this.setForm('next_date', v), '', 'date')), e('div', null)),
        UI.Field('Notes', UI.Area(f.notes, v => this.setForm('notes', v)))),
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'), UI.Btn('Add prospect', () => { if (!f.company) { this.toast('Error', 'Add a company', 'var(--down)'); return; } this.addProspect(f); }, 'primary')], '560px');
    }

    if (k === 'createAgent' || k === 'createClient') {
      const isC = k === 'createClient';
      const newType = f.newType || 'direct';
      const agencies = isC ? (d.clients || []).filter(x => x.type === 'agency') : [];
      return wrap(isC ? 'Add client' : 'Create call agent', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        UI.Grid('1fr 1fr', 10, UI.Field('Name', UI.Input(f.name, v => this.setForm('name', v))), UI.Field('Email', UI.Input(f.email, v => this.setForm('email', v)))),
        UI.Grid('1fr 1fr', 10, UI.Field('Phone', UI.Input(f.phone, v => this.setForm('phone', v))), isC ? UI.Field('Rate / appt', UI.Input(f.rate, v => this.setForm('rate', v), '€45')) : UI.Field('VAT number', UI.Input(f.vat, v => this.setForm('vat', v)))),
        isC ? UI.Grid('1fr 1fr', 10,
          UI.Field('Type', UI.Select(newType, v => this.setForm('newType', v), [{ v: 'direct', l: 'Direct client' }, { v: 'agency', l: 'Lead agency' }])),
          UI.Field('CRM', UI.Select(f.crm || 'none', v => this.setForm('crm', v), [{ v: 'none', l: 'None' }, { v: 'monday', l: 'Monday' }, { v: 'gohighlevel', l: 'GoHighLevel' }, { v: 'teamleader', l: 'Team Leader' }, { v: 'hubspot', l: 'HubSpot' }, { v: 'sheets', l: 'Google Sheets' }])))
          : UI.Field('Assign clients', UI.Sub('Assign from the Clients page after creating.')),
        isC && newType === 'direct' && agencies.length ? UI.Field('Link to lead agency (optional)', UI.Select(f.linkAgency || '', v => this.setForm('linkAgency', v), [{ v: '', l: '— None —' }, ...agencies.map(a => ({ v: a.id, l: a.name }))])) : null,
        e('div', { style: { padding: 12, borderRadius: 10, background: 'var(--bg-2)', fontSize: 12.5, color: 'var(--text-mute)', lineHeight: 1.5 } }, 'Login credentials are auto-sent by branded email from platform@infinite-scale.be.')),
        [UI.Btn('Cancel', () => this.closeModal(), 'soft'), UI.Btn(isC ? 'Create client' : 'Create agent', () => { if (!f.name) { this.toast('Error', 'Add a name', 'var(--down)'); return; } isC ? this.createClient(f) : this.createAgent(f); }, 'primary')], '560px');
    }

    if (k === 'intakeForm') {
      return wrap('Recruitment intake form (public)', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        UI.Sub('This is the form applicants fill in on the platform. Submissions land in your recruitment pipeline.', { marginBottom: 4 }),
        UI.Grid('1fr 1fr', 10, UI.Field('First name', UI.Input('', () => { })), UI.Field('Last name', UI.Input('', () => { }))),
        UI.Grid('1fr 1fr', 10, UI.Field('Email', UI.Input('', () => { })), UI.Field('Phone', UI.Input('', () => { }))),
        UI.Grid('1fr 1fr 1fr', 10, UI.Field('Gender', UI.Select('', () => { }, [{ v: '', l: '—' }, { v: 'm', l: 'Male' }, { v: 'f', l: 'Female' }])), UI.Field('Country', UI.Input('', () => { })), UI.Field('Age', UI.Input('', () => { }, '', 'number'))),
        UI.Field('Availability', e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, ['Block 1 (9–12)', 'Block 2 (13–17)', 'Block 3 (17–20)', 'Weekends'].map(b => UI.Pill(b, 'var(--text-dim)', 'var(--bg-2)')))),
        UI.Field('Position & motivation', UI.Area('', () => { }))),
        [UI.Btn('Close', () => this.closeModal(), 'soft')], '600px');
    }

    if (k === 'sendReviewEmails') {
      const closeDate = (d.settings && d.settings.billing_close_date) || '4 augustus';
      const allClients = (d.clients || []).filter(c => c.email);
      const selected = f.selected || {};
      const sending = !!f.sending;
      const sent = f.sent || {};

      const now = new Date();
      const month = now.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });

      const toggleAll = checked => {
        const next = {};
        allClients.forEach(c => { next[c.id] = checked; });
        this.setForm('selected', next);
      };
      const anySelected = allClients.some(c => selected[c.id]);
      const allSelected = allClients.length > 0 && allClients.every(c => selected[c.id]);

      const sendEmails = async () => {
        const targets = allClients.filter(c => selected[c.id]);
        if (!targets.length) { this.toast('Geen selectie', 'Selecteer minstens één client.', 'var(--warn)'); return; }
        this.setForm('sending', true);

        const closeLabel = closeDate ? new Date(closeDate + 'T12:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' }) : '4 augustus';
        let sentMap = {};
        for (const cl of targets) {
          try {
            const resp = await fetch('https://cloud.infinite-scale.be/webhook/send-review-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: cl.email,
                to: cl.email,
                clientName: cl.contactPerson || cl.name,
                month,
                closeDate: closeLabel,
                subject: `Overzicht ${month} staat klaar voor review`,
              }),
            });
            sentMap[cl.id] = resp.ok ? 'ok' : 'err';
          } catch(err) { sentMap[cl.id] = 'err'; }
        }
        this.setForm('sending', false);
        this.setForm('sent', sentMap);
        const okCount = Object.values(sentMap).filter(v => v === 'ok').length;
        this.toast('Verzonden', `${okCount} van ${targets.length} emails verstuurd.`, 'var(--up)');
      };

      const sentCount = Object.values(sent).filter(v => v === 'ok').length;

      return wrap('Stuur review emails', e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        e('div', { style: { padding: '10px 14px', borderRadius: 9, background: 'oklch(0.22 0.05 220 / .25)', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 } },
          '🔗 Elke client ontvangt een persoonlijke eenmalige inloglink. Geen wachtwoord nodig. Afspraakcontrole vóór ', e('strong', null, closeDate ? new Date(closeDate + 'T12:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' }) : '4 augustus'), '.'),
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
          UI.Sub('Selecteer clients (' + allClients.filter(c => selected[c.id]).length + ' geselecteerd)', { margin: 0 }),
          e('div', { style: { display: 'flex', gap: 8 } },
            e('button', { onClick: () => toggleAll(true), style: { fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' } }, 'Alles'),
            e('button', { onClick: () => toggleAll(false), style: { fontSize: 12, color: 'var(--text-mute)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' } }, 'Geen'))),
        e('div', { style: { maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 } },
          allClients.map(cl => {
            const isSelected = !!selected[cl.id];
            const status = sent[cl.id];
            return e('label', { key: cl.id, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', background: isSelected ? 'oklch(0.22 0.05 220 / .3)' : 'transparent', transition: 'background .1s' } },
              e('input', { type: 'checkbox', checked: isSelected, onChange: ev => this.setForm('selected', { ...selected, [cl.id]: ev.target.checked }), style: { width: 15, height: 15, cursor: 'pointer' } }),
              e('span', { style: { flex: 1, fontSize: 13.5 } }, cl.name),
              e('span', { style: { fontSize: 12, color: 'var(--text-mute)' } }, cl.email),
              status === 'ok' ? e('span', { style: { fontSize: 11, color: 'var(--up)', fontWeight: 700 } }, '✓ Verstuurd') :
              status === 'no_user' ? e('span', { style: { fontSize: 11, color: 'var(--warn)' } }, '⚠ Geen account') :
              status === 'err' ? e('span', { style: { fontSize: 11, color: 'var(--down)' } }, '✗ Fout') : null);
          })),
        sentCount > 0 ? e('div', { style: { fontSize: 13, color: 'var(--up)', textAlign: 'center', fontWeight: 600 } }, `✓ ${sentCount} emails succesvol verstuurd`) : null),
        [UI.Btn('Annuleer', () => this.closeModal(), 'soft'),
         UI.Btn(sending ? 'Bezig…' : ('Stuur naar ' + allClients.filter(c => selected[c.id]).length + ' clients'), sendEmails, 'primary')], '620px');
    }

    if (k === 'rosterDayDetail') {
      const { agentId, dayIdx, weekDates, weekStart } = f;
      const agent = (d.agents || []).find(a => a.id === agentId);
      if (!agent) return null;
      const COLORS = ['#0891b2','#7c3aed','#059669','#d97706','#dc2626','#db2777','#2563eb','#0e7490','#b45309','#0f766e'];
      const HOUR_START = 7, HOUR_END = 20;
      const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
      const DAY_FULL = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];

      const sc = (d.schedules || []).find(sc2 => sc2.agent_id === agentId && sc2.week_start === weekStart);
      const allSlots = sc ? (sc.slots || []).filter(sl => sl.clientId !== '__off__') : [];
      const daySlots = allSlots.filter(sl => sl.day === dayIdx && typeof sl.hour === 'number');

      const myClients = (d.clients || []).filter(c => (agent.clients || []).includes(c.id));
      const getColor = cid => { const i = myClients.findIndex(c => c.id === cid); return i >= 0 ? COLORS[i % COLORS.length] : '#888'; };

      const dayDate = weekDates && weekDates[dayIdx] ? new Date(weekDates[dayIdx] + 'T12:00:00') : null;
      const dayLabel = DAY_FULL[dayIdx] + (dayDate ? ' ' + dayDate.getDate() + ' ' + dayDate.toLocaleDateString('nl-BE', { month: 'long' }) : '');

      // Group consecutive hours by client into blocks
      const blocks = [];
      if (daySlots.length) {
        const sorted = [...daySlots].sort((a, b) => a.hour - b.hour);
        let curStart = sorted[0].hour, curEnd = sorted[0].hour + 1, curCid = sorted[0].clientId;
        for (let i = 1; i < sorted.length; i++) {
          const sl = sorted[i];
          if (sl.hour === curEnd && sl.clientId === curCid) {
            curEnd = sl.hour + 1;
          } else {
            blocks.push({ start: curStart, end: curEnd, clientId: curCid });
            curStart = sl.hour; curEnd = sl.hour + 1; curCid = sl.clientId;
          }
        }
        blocks.push({ start: curStart, end: curEnd, clientId: curCid });
      }

      // Unique clients for legend
      const clientsToday = [...new Set(daySlots.map(sl => sl.clientId))].map(cid => {
        const cl = myClients.find(c => c.id === cid);
        const hrs = daySlots.filter(sl => sl.clientId === cid).length;
        return { cid, cl, hrs, color: getColor(cid) };
      });

      const totalH = daySlots.length;
      const minH = totalH ? Math.min(...daySlots.map(sl => sl.hour)) : null;
      const maxH = totalH ? Math.max(...daySlots.map(sl => sl.hour)) + 1 : null;

      // Gantt rows per block
      const range = HOUR_END - HOUR_START;
      const ganttRows = blocks.map((blk, bi) => {
        const cl = myClients.find(c => c.id === blk.clientId);
        const col = getColor(blk.clientId);
        const leftPct  = ((blk.start - HOUR_START) / range) * 100;
        const widthPct = ((blk.end - blk.start) / range) * 100;
        const blockH   = blk.end - blk.start;
        return e('div', { key: bi, style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 } },
          e('div', { style: { width: 120, flexShrink: 0, textAlign: 'right' } },
            e('div', { style: { fontSize: 13, fontWeight: 700, color: col } }, blk.start + ':00 – ' + blk.end + ':00'),
            e('div', { style: { fontSize: 11, color: 'var(--text-mute)' } }, blockH + ' uur')),
          e('div', { style: { flex: 1, position: 'relative', height: 36, background: 'var(--bg-2)', borderRadius: 8 } },
            e('div', { style: { position: 'absolute', left: leftPct + '%', width: widthPct + '%', height: '100%', background: col, borderRadius: 8, display: 'flex', alignItems: 'center', paddingLeft: 10, boxSizing: 'border-box', overflow: 'hidden' } },
              e('span', { style: { fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' } }, cl ? cl.name : '?'))));
      });

      // Hour axis labels
      const axis = e('div', { style: { display: 'flex', marginLeft: 132, marginBottom: 6, position: 'relative' } },
        HOURS.map(h => e('div', { key: h, style: { flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono'" } }, h)));

      const body = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
        // Summary header
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 16, padding: '0 0 16px', borderBottom: '1px solid var(--border-soft)', marginBottom: 16, flexWrap: 'wrap' } },
          totalH
            ? e('div', { style: { display: 'flex', gap: 20 } },
                e('div', null,
                  e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginBottom: 2 } }, 'Werktijd'),
                  e('div', { style: { fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--text)' } }, minH + ':00 – ' + maxH + ':00')),
                e('div', null,
                  e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginBottom: 2 } }, 'Totaal'),
                  e('div', { style: { fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--accent)' } }, totalH + ' uur')),
                e('div', null,
                  e('div', { style: { fontSize: 11, color: 'var(--text-mute)', marginBottom: 2 } }, 'Blokken'),
                  e('div', { style: { fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: 'var(--text)' } }, blocks.length)))
            : e('div', { style: { fontSize: 14, color: 'var(--text-mute)' } }, 'Geen rooster voor deze dag.'),
          // Client legend
          clientsToday.length > 0
            ? e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' } },
                clientsToday.map(({ cid, cl, hrs, color }) =>
                  e('div', { key: cid, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: color + '18', border: '1px solid ' + color + '44' } },
                    e('div', { style: { width: 8, height: 8, borderRadius: 2, background: color } }),
                    e('span', { style: { fontSize: 12, fontWeight: 600, color } }, cl ? cl.name : '?'),
                    e('span', { style: { fontSize: 11, color: 'var(--text-mute)' } }, hrs + 'u'))))
            : null),
        // Gantt chart
        totalH > 0
          ? e('div', null,
              axis,
              e('div', { style: { display: 'flex', flexDirection: 'column' } }, ...ganttRows))
          : null);

      return wrap(dayLabel + ' · ' + agent.name, body, [UI.Btn('Sluiten', () => this.closeModal(), 'soft')], '620px');
    }

    return null;
  },

  _admUploadContract(k, f, d) {
    const e = React.createElement;
    const wrap = (title, body, footer, width) => ({
      width: width || '520px', body: e('div', null,
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-soft)' } },
          UI.Hd(title, { fontSize: 18 }),
          e('button', { onClick: () => this.closeModal(), style: { width: 32, height: 32, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-dim)', cursor: 'pointer' } },
            e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, style: { display: 'block', margin: 'auto' } }, e('path', { d: 'M6 6l12 12M18 6 6 18' })))),
        e('div', { style: { padding: '22px' } }, body),
        footer ? e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--border-soft)' } }, ...footer) : null)
    });
    if (k !== 'uploadContract') return null;

    const uploading = !!f.uploading;
    const dragOver = !!f.dragOver;
    const file = f.uploadFile || null;

    const dropZone = e('div', {
      onDragOver: ev => { ev.preventDefault(); this.setForm('dragOver', true); },
      onDragLeave: () => this.setForm('dragOver', false),
      onDrop: ev => {
        ev.preventDefault();
        this.setForm('dragOver', false);
        const dropped = ev.dataTransfer.files[0];
        if (dropped && dropped.type === 'application/pdf') this.setForm('uploadFile', dropped);
        else this.toast('Fout', 'Enkel PDF-bestanden zijn toegestaan', 'var(--down)');
      },
      onClick: () => document.getElementById('_uploadContractInput').click(),
      style: {
        border: '2px dashed ' + (dragOver ? 'var(--accent)' : (file ? 'var(--up)' : 'var(--border)')),
        borderRadius: 12, padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
        background: dragOver ? 'oklch(0.2 0.04 256 / .3)' : (file ? 'oklch(0.18 0.06 152 / .15)' : 'var(--bg-2)'),
        transition: 'all .15s',
      },
    },
      e('input', { id: '_uploadContractInput', type: 'file', accept: 'application/pdf', style: { display: 'none' },
        onChange: ev => { const fi = ev.target.files[0]; if (fi) this.setForm('uploadFile', fi); } }),
      file
        ? e('div', null,
            e('div', { style: { fontSize: 22, marginBottom: 6 } }, '📄'),
            e('div', { style: { fontWeight: 700, color: 'var(--up)', fontSize: 13.5 } }, file.name),
            e('div', { style: { fontSize: 11.5, color: 'var(--text-mute)', marginTop: 4 } }, (file.size / 1024).toFixed(0) + ' KB'))
        : e('div', null,
            e('div', { style: { fontSize: 28, marginBottom: 8 } }, '📂'),
            e('div', { style: { fontWeight: 700, color: 'var(--text-dim)' } }, 'Sleep een PDF hierheen of klik om te kiezen'),
            e('div', { style: { fontSize: 12, color: 'var(--text-mute)', marginTop: 4 } }, 'Alleen PDF bestanden')));

    const inpStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13.5, outline: 'none', boxSizing: 'border-box' };
    const lblStyle = { display: 'flex', flexDirection: 'column', gap: 4 };
    const lblTxt = { fontSize: 11.5, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.05em' };
    const grid2 = (...children) => e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } }, ...children);
    const fld = (label, child) => e('label', { style: lblStyle }, e('span', { style: lblTxt }, label), child);
    const inp = (val, key, extra) => e('input', { value: val, onChange: ev => this.setForm(key, ev.target.value), style: inpStyle, ...extra });

    const body = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      dropZone,
      grid2(
        fld('Bedrijf / partij *', inp(f.uParty || '', 'uParty', { placeholder: 'Acme NV' })),
        fld('Contactpersoon', inp(f.uContact || '', 'uContact', { placeholder: 'Jan Janssen' }))),
      grid2(
        fld('E-mail', inp(f.uEmail || '', 'uEmail', { placeholder: 'jan@acme.be', type: 'email' })),
        fld('BTW-nummer', inp(f.uVat || '', 'uVat', { placeholder: 'BE0123456789' }))),
      grid2(
        fld('Contract type', inp(f.uType || '', 'uType', { placeholder: 'Pay per appointment' })),
        fld('Tarief / waarde', inp(f.uValue || '', 'uValue', { placeholder: '€140/afspraak' }))),
      grid2(
        fld('Handtekeningdatum', inp(f.uSigned || new Date().toISOString().slice(0,10), 'uSigned', { type: 'date' })),
        fld('Type partij', e('select', {
          value: f.uPartyType || 'client',
          onChange: ev => this.setForm('uPartyType', ev.target.value),
          style: { ...inpStyle },
        }, e('option', { value: 'client' }, 'Klant'), e('option', { value: 'agent' }, 'Agent')))),
      e('label', { style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' } },
        e('input', { type: 'checkbox', checked: !!f.uAlsoCreateClient, onChange: ev => this.setForm('uAlsoCreateClient', ev.target.checked),
          style: { width: 16, height: 16, cursor: 'pointer' } }),
        e('span', { style: { fontSize: 13.5, color: 'var(--text-dim)' } }, 'Maak ook een client aan')));

    const submit = async () => {
      if (!f.uParty) { this.toast('Fout', 'Vul een bedrijfsnaam in', 'var(--down)'); return; }
      if (!file) { this.toast('Fout', 'Selecteer eerst een PDF', 'var(--down)'); return; }
      this.setForm('uploading', true);
      try {
        const pdfUrl = await API.uploadContractPdf(file);
        const contractId = 'ct' + Date.now();
        const contract = {
          id: contractId,
          party: f.uParty,
          party_type: f.uPartyType || 'client',
          type: f.uType || 'Geüpload contract',
          value: f.uValue || '',
          sent: f.uSigned || new Date().toISOString().slice(0,10),
          status: 'signed',
          email: f.uEmail || '',
          vat: f.uVat || '',
          contact: f.uContact || '',
          address: '',
          duration: '',
          notes: '',
          setup_fee: '',
          signing_link: '',
          signed_at: new Date().toISOString(),
          signer_name: f.uContact || f.uParty,
          pdf_url: pdfUrl,
        };
        await API.addContract(contract);
        this.mutLocal(d => d.contracts.unshift(contract));
        if (f.uAlsoCreateClient) {
          const rateMatch = (f.uValue || '').match(/[\d,]+/);
          const rate = rateMatch ? +(rateMatch[0].replace(',', '.')) : 0;
          const row = { name: f.uParty, type: 'direct', status: 'starting', crm: 'none', crm_on: false,
            kickoff: new Date().toISOString().slice(0,10), rate, contact_person: f.uContact || f.uParty,
            email: f.uEmail || '', company: f.uParty, bill_status: 'pending', subclients: [] };
          const res = await API.createClient(row);
          if (res) {
            const norm = { ...row, id: res[0]?.id || 'c' + Date.now(), agents: [], clients: [],
              crmOn: false, contactPerson: row.contact_person, billStatus: row.bill_status };
            this.mutLocal(d => d.clients.push(norm));
            this.toast('Klaar', f.uParty + ' toegevoegd als client én contract geüpload', 'var(--up)');
          }
        } else {
          this.toast('Geüpload', 'Contract opgeslagen voor ' + f.uParty, 'var(--up)');
        }
        this.closeModal();
      } catch(err) {
        this.toast('Fout', err.message || 'Upload mislukt', 'var(--down)');
        this.setForm('uploading', false);
      }
    };

    return wrap('Contract uploaden', body,
      [UI.Btn('Annuleren', () => this.closeModal(), 'soft'),
       UI.Btn(uploading ? 'Bezig…' : 'Upload & opslaan', submit, 'primary')], '580px');
  },

  _admUploadClientContract(k, f, d) {
    if (k !== 'uploadClientContract') return null;
    const e = React.createElement;
    const wrap = (title, body, footer, width) => ({
      width: width || '620px', body: e('div', null,
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-soft)' } },
          UI.Hd(title, { fontSize: 18 }),
          e('button', { onClick: () => this.closeModal(), style: { width: 32, height: 32, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-dim)', cursor: 'pointer' } },
            e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, style: { display: 'block', margin: 'auto' } }, e('path', { d: 'M6 6l12 12M18 6 6 18' })))),
        e('div', { style: { padding: '22px', overflowY: 'auto', maxHeight: '70vh' } }, body),
        footer ? e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--border-soft)' } }, ...footer) : null)
    });

    const uploading = !!f.uploading;
    const dragOver = !!f.dragOver;
    const file = f.uploadFile || null;

    const dropZone = e('div', {
      onDragOver: ev => { ev.preventDefault(); this.setForm('dragOver', true); },
      onDragLeave: () => this.setForm('dragOver', false),
      onDrop: ev => {
        ev.preventDefault(); this.setForm('dragOver', false);
        const dropped = ev.dataTransfer.files[0];
        if (dropped && dropped.type === 'application/pdf') this.setForm('uploadFile', dropped);
        else this.toast('Fout', 'Enkel PDF-bestanden zijn toegestaan', 'var(--down)');
      },
      onClick: () => document.getElementById('_uploadCCInput').click(),
      style: { border: '2px dashed ' + (dragOver ? 'var(--accent)' : (file ? 'var(--up)' : 'var(--border)')), borderRadius: 12, padding: '20px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'oklch(0.2 0.04 256 / .3)' : (file ? 'oklch(0.18 0.06 152 / .15)' : 'var(--bg-2)'), transition: 'all .15s' },
    },
      e('input', { id: '_uploadCCInput', type: 'file', accept: 'application/pdf', style: { display: 'none' }, onChange: ev => { const fi = ev.target.files[0]; if (fi) this.setForm('uploadFile', fi); } }),
      file
        ? e('div', null, e('span', { style: { fontSize: 18, marginRight: 8 } }, '📄'), e('span', { style: { fontWeight: 700, color: 'var(--up)', fontSize: 13.5 } }, file.name), e('span', { style: { fontSize: 11.5, color: 'var(--text-mute)', marginLeft: 8 } }, (file.size / 1024).toFixed(0) + ' KB'))
        : e('div', null, e('span', { style: { fontSize: 20, marginRight: 8 } }, '📂'), e('span', { style: { color: 'var(--text-dim)', fontSize: 13.5 } }, 'Sleep een PDF hierheen of klik om te kiezen (optioneel)')));

    const sec = (title) => e('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 4, marginBottom: 2 } }, title);

    const agencies = (d.clients || []).filter(x => x.type === 'agency');
    const clientType = f.ccType || 'direct';

    const body = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      sec('Klantgegevens'),
      UI.Grid('1fr 1fr', 10,
        UI.Field('Bedrijf *', UI.Input(f.ccName || '', v => this.setForm('ccName', v), 'Acme NV')),
        UI.Field('Contactpersoon', UI.Input(f.ccContact || '', v => this.setForm('ccContact', v), 'Jan Janssen'))),
      UI.Grid('1fr 1fr', 10,
        UI.Field('E-mail', UI.Input(f.ccEmail || '', v => this.setForm('ccEmail', v), 'jan@acme.be', 'email')),
        UI.Field('Telefoon', UI.Input(f.ccPhone || '', v => this.setForm('ccPhone', v), '+32 499 ...'))),
      UI.Grid('1fr 1fr', 10,
        UI.Field('BTW-nummer', UI.Input(f.ccVat || '', v => this.setForm('ccVat', v), 'BE0123456789')),
        UI.Field('Type', UI.Select(clientType, v => this.setForm('ccType', v), [{ v: 'direct', l: 'Direct client' }, { v: 'agency', l: 'Lead agency' }]))),
      clientType === 'direct' && agencies.length ? UI.Field('Koppelen aan lead agency (optioneel)', UI.Select(f.ccLinkAgency || '', v => this.setForm('ccLinkAgency', v), [{ v: '', l: '— Geen —' }, ...agencies.map(a => ({ v: a.id, l: a.name }))])) : null,

      sec('Vergoedingstructuur'),
      UI.Grid('1fr 1fr', 10,
        UI.Field('Per afspraak (€)', UI.Input(f.ccPerAppt || '', v => this.setForm('ccPerAppt', v), 'bv. 140', 'number')),
        UI.Field('Per uur (€)', UI.Input(f.ccPerHour || '', v => this.setForm('ccPerHour', v), 'bv. 75', 'number'))),
      UI.Grid('1fr 1fr 1fr', 10,
        UI.Field('Vaste maandelijkse fee (€)', UI.Input(f.ccMonthly || '', v => this.setForm('ccMonthly', v), 'bv. 1500', 'number')),
        UI.Field('Commissie (%)', UI.Input(f.ccCommission || '', v => this.setForm('ccCommission', v), 'bv. 10', 'number')),
        UI.Field('Vaste close fee (€)', UI.Input(f.ccCloseFee || '', v => this.setForm('ccCloseFee', v), 'bv. 500', 'number'))),
      UI.Grid('1fr 1fr', 10,
        UI.Field('Opstartkost eenmalig (€)', UI.Input(f.ccSetup || '', v => this.setForm('ccSetup', v), 'bv. 500', 'number')),
        UI.Field('Betalingstermijn (dagen)', UI.Input(f.ccPayDays || '', v => this.setForm('ccPayDays', v), 'bv. 30', 'number'))),

      sec('Contract PDF (optioneel)'),
      dropZone);

    const submit = async () => {
      if (!f.ccName) { this.toast('Fout', 'Vul een bedrijfsnaam in', 'var(--down)'); return; }
      this.setForm('uploading', true);
      try {
        let pdfUrl = null;
        if (file) pdfUrl = await API.uploadContractPdf(file);

        // Build rate string for contract value
        const parts = [];
        if (f.ccPerAppt) parts.push('€' + f.ccPerAppt + '/afspraak');
        if (f.ccPerHour) parts.push('€' + f.ccPerHour + '/uur');
        if (f.ccMonthly) parts.push('€' + f.ccMonthly + '/maand');
        if (f.ccCommission) parts.push(f.ccCommission + '% commissie');
        if (f.ccCloseFee) parts.push('€' + f.ccCloseFee + '/close');
        if (f.ccSetup) parts.push('€' + f.ccSetup + ' opstart');

        const primaryRate = +(f.ccPerAppt || f.ccPerHour || f.ccMonthly || 0) || 0;
        const row = {
          name: f.ccName, type: clientType, status: 'starting',
          crm: 'none', crm_on: false,
          kickoff: new Date().toISOString().slice(0, 10),
          rate: primaryRate,
          contact_person: f.ccContact || f.ccName,
          email: f.ccEmail || '',
          company: f.ccName,
          bill_status: 'pending',
          subclients: [],
          per_hour: f.ccPerHour ? +f.ccPerHour : null,
          monthly_fee: f.ccMonthly ? +f.ccMonthly : null,
          commission: f.ccCommission ? +f.ccCommission : null,
          close_fee: f.ccCloseFee ? +f.ccCloseFee : null,
          setup_fee: f.ccSetup ? +f.ccSetup : null,
          pay_days: f.ccPayDays ? +f.ccPayDays : null,
        };
        const res = await API.createClient(row);
        if (res) {
          const norm = { ...row, id: res[0]?.id || 'c' + Date.now(), agents: [], clients: [], crmOn: false, contactPerson: row.contact_person, billStatus: row.bill_status };
          this.mutLocal(d => d.clients.push(norm));
          if (clientType === 'direct' && f.ccLinkAgency) {
            const agency = (this.state.data.clients || []).find(x => x.id === f.ccLinkAgency);
            if (agency) {
              const newSubs = [...(agency.subclients || []), { name: f.ccName, rate: primaryRate }];
              this.mutLocal(d => { const ag = d.clients.find(x => x.id === f.ccLinkAgency); if (ag) ag.subclients = newSubs; });
              await API.updateClient(f.ccLinkAgency, { subclients: newSubs });
            }
          }
        }

        if (pdfUrl || parts.length) {
          const contract = {
            id: 'ct' + Date.now(),
            party: f.ccName,
            party_type: 'client',
            type: parts.length > 1 ? 'Gecombineerd' : (f.ccPerAppt ? 'Pay per appointment' : f.ccMonthly ? 'Vaste fee' : 'Geüpload contract'),
            value: parts.join(' + '),
            sent: new Date().toISOString().slice(0, 10),
            status: 'signed',
            email: f.ccEmail || '',
            vat: f.ccVat || '',
            contact: f.ccContact || '',
            address: '', duration: f.ccPayDays ? f.ccPayDays + ' dagen betalingstermijn' : '',
            notes: '', setup_fee: f.ccSetup || '', signing_link: '',
            signed_at: new Date().toISOString(),
            signer_name: f.ccContact || f.ccName,
            pdf_url: pdfUrl || null,
          };
          await API.addContract(contract);
          this.mutLocal(d => d.contracts.unshift(contract));
        }

        this.toast('Klaar', f.ccName + ' aangemaakt' + (pdfUrl ? ' + contract geüpload' : ''), 'var(--up)');
        this.closeModal();
      } catch(err) {
        this.toast('Fout', err.message || 'Aanmaken mislukt', 'var(--down)');
        this.setForm('uploading', false);
      }
    };

    return wrap('Klant aanmaken + contract', body,
      [UI.Btn('Annuleren', () => this.closeModal(), 'soft'),
       UI.Btn(uploading ? 'Bezig…' : 'Opslaan', submit, 'primary')], '620px');
  },
};
