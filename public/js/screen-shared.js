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
        e('div', { style: { marginTop: 12 } }, UI.Btn(nl ? 'Verbinden' : 'Connect', () => this.toast('CRM', nl ? 'Integratie opgeslagen' : 'Integration saved (API key stored on server)', 'var(--accent)'), 'primary'))) : null);
  },

  _apptToolbar(d, s) {
    const e = React.createElement; const q = s.q || ''; const fs = s.fstatus || 'all';
    return e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 } },
      e('div', { style: { position: 'relative', flex: '1 1 220px', minWidth: 180 } },
        e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--text-mute)', strokeWidth: 2, style: { position: 'absolute', left: 11, top: 11 } }, e('circle', { cx: 11, cy: 11, r: 7 }), e('path', { d: 'M21 21l-4-4' })),
        e('input', { value: q, placeholder: 'Search lead, phone…', onChange: ev => this.setState({ q: ev.target.value }), style: { width: '100%', padding: '9px 12px 9px 34px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13.5, outline: 'none' } })),
      UI.Seg(fs, v => this.setState({ fstatus: v }), [{ v: 'all', l: 'All' }, { v: 'open', l: 'Open' }, { v: 'show', l: 'Show' }, { v: 'no_show', l: 'No-show' }, { v: 'cancel', l: 'Cancelled' }]));
  },

  _filterAppts(list, s) {
    const q = (s.q || '').toLowerCase(); const fs = s.fstatus || 'all';
    return list.filter(a => (fs === 'all' || a.status === fs) && (!q || a.lead.toLowerCase().includes(q) || (a.phone || '').replace(/\s/g,'').includes(q.replace(/\s/g,''))));
  },
};
