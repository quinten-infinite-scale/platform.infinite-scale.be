// Shared screens: settings, appt toolbar/filter
const ScreenShared = {
  _settings(d, s, user) {
    const e = React.createElement;
    const me = d.agents.find(a => a.id === this.myAgentId);
    const cl = d.clients.find(c => c.id === this.myClientId);
    const profile = user || me || cl || {};
    const f = s.form;
    const nl = (s.lang || 'nl') === 'nl';

    const curName = f.settingName !== undefined ? f.settingName : (profile.name || profile.contactPerson || '');
    const curEmail = f.settingEmail !== undefined ? f.settingEmail : (profile.email || '');
    const curPhone = f.settingPhone !== undefined ? f.settingPhone : (profile.phone || '');

    const isAdmin = s.role === 'admin';

    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 } },
      UI.C({}, UI.Hd(nl ? 'Profiel' : 'Profile', { fontSize: 15, marginBottom: 14 }),
        UI.Grid('1fr 1fr', 12,
          UI.Field(nl ? 'Naam' : 'Name', UI.Input(curName, v => this.setForm('settingName', v))),
          UI.Field('Email', UI.Input(curEmail, v => this.setForm('settingEmail', v)))),
        s.role === 'agent' ? UI.Field(nl ? 'Telefoon' : 'Phone', UI.Input(curPhone, v => this.setForm('settingPhone', v))) : null,
        isAdmin ? e('div', { style: { marginTop: 8, padding: 11, borderRadius: 9, background: 'var(--bg-2)', fontSize: 12.5, color: 'var(--text-mute)' } }, nl ? 'Admin profiel is gekoppeld aan je Supabase auth account.' : 'Admin profile is linked to your Supabase auth account.') : null,
        e('div', { style: { marginTop: 12 } }, UI.Btn(nl ? 'Profiel opslaan' : 'Save profile', () => this.saveSettings(), 'primary'))),
      UI.C({}, UI.Hd(nl ? 'Beveiliging' : 'Security', { fontSize: 15, marginBottom: 14 }),
        UI.Grid('1fr 1fr', 12,
          UI.Field(nl ? 'Nieuw wachtwoord' : 'New password', UI.Input(f.newPassword || '', v => this.setForm('newPassword', v), '••••••••', 'password')),
          UI.Field(nl ? 'Bevestig wachtwoord' : 'Confirm password', UI.Input(f.confirmPassword || '', v => this.setForm('confirmPassword', v), '••••••••', 'password'))),
        e('div', { style: { marginTop: 12 } }, UI.Btn(nl ? 'Wachtwoord bijwerken' : 'Update password', () => this.saveSettings(), 'primary'))),
      UI.C({}, UI.Hd(s.lang === 'nl' ? 'Taal' : 'Language', { fontSize: 15, marginBottom: 12 }), UI.Seg(s.lang || 'nl', v => { try { localStorage.setItem('is_lang', v); } catch(ex) {} this.setState({ lang: v }); }, [{ v: 'en', l: 'English' }, { v: 'nl', l: 'Nederlands' }])),
      (s.role === 'client' || s.role === 'agency') ? UI.C({},
        UI.Hd(nl ? 'CRM-koppeling' : 'CRM connection', { fontSize: 15, marginBottom: 6 }),
        UI.Sub(nl ? 'Koppel je CRM om live leadaantallen op te halen. Ondersteund: Team Leader, Monday, GoHighLevel, HubSpot, Google Sheets.' : 'Connect your CRM to pull live lead counts. Supported: Team Leader, Monday, GoHighLevel, HubSpot, Google Sheets.', { marginBottom: 12 }),
        UI.Grid('2fr 1fr', 12,
          UI.Field('API key', UI.Input(f.apikey || '', v => this.setForm('apikey', v), nl ? 'Plak API-sleutel…' : 'Paste API key…')),
          UI.Field(nl ? 'Bron' : 'Source', UI.Select(f.crm || cl?.crm || 'monday', v => this.setForm('crm', v), [{ v: 'monday', l: 'Monday' }, { v: 'gohighlevel', l: 'GoHighLevel' }, { v: 'teamleader', l: 'Team Leader' }, { v: 'hubspot', l: 'HubSpot' }, { v: 'sheets', l: 'Google Sheets' }]))),
        e('div', { style: { marginTop: 12 } }, UI.Btn(nl ? 'Verbinden' : 'Connect', () => this.toast('CRM', nl ? 'Integratie opgeslagen' : 'Integration saved (API key stored on server)', 'var(--accent)'), 'primary'))) : null,
      isAdmin ? UI.C({},
        UI.Hd(nl ? 'Rechtenbeheer' : 'Rights management', { fontSize: 15, marginBottom: 6 }),
        UI.Sub(nl ? 'Beheer welke pagina\'s elk accounttype kan zien.' : 'Manage which pages each account type can see.', { marginBottom: 12 }),
        UI.Btn(nl ? 'Rechten beheren →' : 'Manage rights →', () => this.go('rights'), 'soft')) : null,
      isAdmin ? UI.C({},
        UI.Hd('Meta Ads Integratie', { fontSize: 15, marginBottom: 6 }),
        UI.Sub('Koppel Facebook/Instagram Lead Ads aan de Prospect CRM. Leads komen automatisch binnen via een webhook.', { marginBottom: 12 }),
        UI.Btn('Meta Ads instellen →', () => this.go('meta'), 'soft')) : null,
      isAdmin ? ScreenShared._navCustomizer.call(this, d, s) : null);
  },

  _navCustomizer(d, s) {
    const e = React.createElement;
    const DEFAULT_SECTIONS = [
      { key: 'overview',    label: 'Overzicht',          items: ['dashboard', 'finances', 'stats', 'activity'] },
      { key: 'floor',       label: 'Floor',              items: ['apptadmin', 'eodadmin', 'rooster', 'todos', 'tickets'] },
      { key: 'acquisition', label: 'Acquisitie',         items: ['prospects', 'recruitment', 'targets', 'roadmap'] },
      { key: 'team_ops',    label: 'Team Operations',    items: ['agents', 'salespeople', 'managers', 'opa', 'coaching'] },
      { key: 'client_ops',  label: 'Client Operations',  items: ['clients', 'clientsuccess', 'whatsapp', 'timeline'] },
      { key: 'legal',       label: 'Legal',              items: ['contracts'] },
    ];
    const ALL_TAB_KEYS = ['dashboard','finances','stats','activity','apptadmin','eodadmin','rooster','todos','tickets','prospects','recruitment','targets','roadmap','agents','salespeople','managers','opa','coaching','clients','clientsuccess','contracts','whatsapp','timeline'];
    const TAB_LABELS = { dashboard:'Dashboard', finances:'Finances', stats:'Statistics', activity:'Activity', apptadmin:'Appointments', eodadmin:'EOD Reports', rooster:'Roosters', todos:'To-Do', tickets:'Tickets', prospects:'Prospect CRM', recruitment:'Recruitment', targets:'Targets', roadmap:'€100K Roadmap', agents:'Call Agents', salespeople:'Salespeople', managers:'Managers', opa:'OPA', coaching:'Coaching', clients:'Clients', clientsuccess:'Client Success', contracts:'Contracts', whatsapp:'WhatsApp', timeline:'Project Timeline' };

    const rawCfg = (d.settings || {}).nav_sections_config;
    const savedSections = (() => { try { const p = JSON.parse(rawCfg || ''); if (Array.isArray(p) && p.length) return p; } catch(_) {} return null; })();
    const editing = s._navEdit !== undefined ? s._navEdit : null;
    const sections = editing !== null ? editing : (savedSections || DEFAULT_SECTIONS);

    const setSections = (next) => this.setState({ _navEdit: next });

    const saveNav = async () => {
      const val = JSON.stringify(sections);
      this.mutLocal(dd => { dd.settings = dd.settings || {}; dd.settings.nav_sections_config = val; });
      await API.saveSetting('nav_sections_config', val);
      this.setState({ _navEdit: null });
      // Reset localStorage collapse state so new keys work
      try { localStorage.removeItem('isp-nav-sections'); } catch(_) {}
      this.toast('Navigatie', 'Secties opgeslagen', 'var(--up)');
    };
    const resetNav = async () => {
      this.mutLocal(dd => { dd.settings = dd.settings || {}; dd.settings.nav_sections_config = null; });
      await API.saveSetting('nav_sections_config', null);
      this.setState({ _navEdit: null });
      try { localStorage.removeItem('isp-nav-sections'); } catch(_) {}
      this.toast('Navigatie', 'Teruggezet naar standaard', 'var(--text-mute)');
    };

    const assignedKeys = new Set(sections.flatMap(sec => sec.items));
    const unassigned = ALL_TAB_KEYS.filter(k => !assignedKeys.has(k));

    const moveItem = (key, fromSecKey, toSecKey) => {
      setSections(sections.map(sec => {
        if (sec.key === fromSecKey) return { ...sec, items: sec.items.filter(i => i !== key) };
        if (sec.key === toSecKey) return { ...sec, items: [...sec.items, key] };
        return sec;
      }));
    };
    const removeItem = (key, secKey) => setSections(sections.map(sec => sec.key === secKey ? { ...sec, items: sec.items.filter(i => i !== key) } : sec));
    const renameSection = (secKey, newLabel) => setSections(sections.map(sec => sec.key === secKey ? { ...sec, label: newLabel } : sec));
    const deleteSection = (secKey) => setSections(sections.filter(sec => sec.key !== secKey));
    const addSection = () => {
      const key = 'custom_' + Date.now();
      setSections([...sections, { key, label: 'Nieuwe sectie', items: [] }]);
    };
    const addUnassigned = (tabKey, secKey) => setSections(sections.map(sec => sec.key === secKey ? { ...sec, items: [...sec.items, tabKey] } : sec));

    const isDirty = editing !== null;

    return UI.C({},
      UI.Row({ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
        e('div', null,
          UI.Hd('Navigatie aanpassen', { fontSize: 15, marginBottom: 2 }),
          UI.Sub('Pas secties en tabvolgorde aan in de sidebar.', {})),
        UI.Row({ gap: 6 },
          isDirty ? UI.Btn('Opslaan', saveNav, 'primary') : null,
          isDirty ? UI.Btn('Annuleren', () => this.setState({ _navEdit: null }), 'soft') : null,
          !isDirty ? UI.Btn('Reset naar standaard', resetNav, 'ghost') : null)),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        sections.map((sec, si) =>
          e('div', { key: sec.key, style: { border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' } },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border-soft)' } },
              e('input', { value: sec.label, onChange: ev => renameSection(sec.key, ev.target.value), style: { flex: 1, fontSize: 13, fontWeight: 700, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)' } }),
              e('button', { onClick: () => deleteSection(sec.key), title: 'Sectie verwijderen', style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', fontSize: 16, lineHeight: 1, padding: '2px 4px' } }, '×')),
            e('div', { style: { padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 } },
              sec.items.map(key =>
                e('div', { key, style: { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 20, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12.5, fontWeight: 600 } },
                  e('span', null, TAB_LABELS[key] || key),
                  e('select', { value: '', onChange: ev => { if (ev.target.value) moveItem(key, sec.key, ev.target.value); }, title: 'Verplaatsen naar…', style: { fontSize: 11, border: 'none', background: 'transparent', color: 'var(--text-mute)', cursor: 'pointer', padding: '0 2px', outline: 'none' } },
                    e('option', { value: '' }, '→'),
                    sections.filter(s2 => s2.key !== sec.key).map(s2 => e('option', { key: s2.key, value: s2.key }, s2.label))),
                  e('button', { onClick: () => removeItem(key, sec.key), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', fontSize: 13, lineHeight: 1, padding: '0 1px' } }, '×'))),
              unassigned.length > 0
                ? e('select', { value: '', onChange: ev => { if (ev.target.value) { addUnassigned(ev.target.value, sec.key); } }, style: { fontSize: 12, padding: '4px 8px', borderRadius: 20, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-mute)', cursor: 'pointer', outline: 'none' } },
                    e('option', { value: '' }, '+ Tab toevoegen'),
                    unassigned.map(k => e('option', { key: k, value: k }, TAB_LABELS[k] || k)))
                : null))),
        e('button', { onClick: addSection, style: { alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' } }, '+ Nieuwe sectie')));
  },

  _apptToolbar(d, s, opts) {
    const e = React.createElement; const q = s.q || ''; const fs = s.fstatus || 'all';
    const selStyle = { padding: '9px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer' };
    const showClientFilter = opts && opts.showClientFilter;
    const clientFilter = s.fclient || '';
    const dateFilter = s.fdate || '';
    // Build unique client list from the appointment list passed in opts, or from d.clients
    const clientOpts = showClientFilter ? (opts.clients || d.clients).filter(c => c.id && c.name).sort((a, b) => a.name < b.name ? -1 : 1) : [];
    return e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 } },
      e('div', { style: { position: 'relative', flex: '1 1 200px', minWidth: 160 } },
        e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--text-mute)', strokeWidth: 2, style: { position: 'absolute', left: 11, top: 11 } }, e('circle', { cx: 11, cy: 11, r: 7 }), e('path', { d: 'M21 21l-4-4' })),
        e('input', { value: q, placeholder: 'Search lead, phone…', onChange: ev => this.setState({ q: ev.target.value }), style: { width: '100%', padding: '9px 12px 9px 34px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13.5, outline: 'none' } })),
      showClientFilter ? e('select', { value: clientFilter, onChange: ev => this.setState({ fclient: ev.target.value }), style: selStyle },
        e('option', { value: '' }, 'All clients'),
        clientOpts.map(c => e('option', { key: c.id, value: c.id }, c.name))) : null,
      showClientFilter ? e('input', { type: 'date', value: dateFilter, onChange: ev => this.setState({ fdate: ev.target.value }), style: { ...selStyle, flex: '0 0 auto' } }) : null,
      UI.Seg(fs, v => this.setState({ fstatus: v }), [{ v: 'all', l: 'All' }, { v: 'open', l: 'Open' }, { v: 'show', l: 'Show' }, { v: 'no_show', l: 'No-show' }, { v: 'cancel', l: 'Cancelled' }]));
  },

  _filterAppts(list, s) {
    const q = (s.q || '').toLowerCase(); const fs = s.fstatus || 'all';
    const fc = s.fclient || ''; const fd = s.fdate || '';
    return list.filter(a =>
      (fs === 'all' || a.status === fs) &&
      (!fc || a.client === fc) &&
      (!fd || a.dateLog === fd || a.dateAppt === fd) &&
      (!q || (a.lead || '').toLowerCase().includes(q) || (a.phone || '').replace(/\s/g,'').includes(q.replace(/\s/g,''))));
  },
};
