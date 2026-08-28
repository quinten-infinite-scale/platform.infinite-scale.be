// Main application controller — thin delegation layer over modules
class Component extends DCLogic {
  constructor(props) {
    super(props);
    try { localStorage.setItem('is_dbg', 'constructor ran'); } catch(e) {}
    // Handle magic link tokens in URL hash
    (() => { try { const h = new URLSearchParams(location.hash.slice(1)); const at = h.get('access_token'), rt = h.get('refresh_token'), ei = parseInt(h.get('expires_in')||'3600'); if (at) { const ea = Math.floor(Date.now()/1000)+ei; localStorage.setItem('is_session', JSON.stringify({access_token:at,refresh_token:rt,expires_in:ei,expires_at:ea})); history.replaceState(null,'',location.pathname+location.search); } } catch(e) {} })();
    // Try to restore session from localStorage
    const session = SB.loadSession();
    try { localStorage.setItem('is_dbg', localStorage.getItem('is_dbg') + ' session=' + (session ? 'ok' : 'null')); } catch(e) {}
    this.myAgentId = null;
    this.myClientId = null;
    const savedLang = (() => { try { return localStorage.getItem('is_lang') || 'nl'; } catch(e) { return 'nl'; } })();
    this.state = {
      role: null,
      route: 'dashboard',
      modal: null, modalKind: null,
      toasts: [], notifOpen: false, sidebarOpen: false,
      tourStep: null, agencyView: 'all', form: {},
      loading: !!session,
      loginError: null,
      loginEmail: '', loginPassword: '',
      lang: savedLang,
      data: this._emptyData(),
    };
    if (session) this._loadData(false);
    this._onKeyDown = e => { if (e.key === 'Escape' && this.state.modal) this.closeModal(); };
  }

  componentDidMount() { document.addEventListener('keydown', this._onKeyDown); }
  componentWillUnmount() { document.removeEventListener('keydown', this._onKeyDown); }

  _emptyData() {
    return { agents: [], clients: [], appointments: [], dials: {}, tickets: [], recruits: [], prospects: [], contracts: [], events: [], notifs: {}, eods: [], activityLog: [], leaderPeriod: 'daily' };
  }

  _tourSeenKey(uid) { return 'is_tour_seen_' + uid; }
  _markTourSeen(uid) { try { localStorage.setItem(this._tourSeenKey(uid), '1'); } catch (e) { } }

  _saveInvState(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {} }
  _loadInvState(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : {}; } catch(e) { return {}; } }
  _deriveInvState(data) {
    const invApproved = {};
    const invoiceStatus = {};
    for (const [key, is] of Object.entries((data && data.invoiceStates) || {})) {
      if (is.approved) invApproved[key] = true;
      if (is.payStatus && is.payStatus !== 'open') invoiceStatus[key] = is.payStatus;
    }
    return { invApproved, invoiceStatus };
  }

  // ---- Auth ----
  async _doLogin(email, password) {
    this.setState({ loading: true, loginError: null });
    const res = await SB.signIn(email, password);
    if (!res.access_token) {
      this.setState({ loading: false, loginError: 'Invalid email or password.' });
      return;
    }
    await this._loadData(true);
  }

  // freshLogin: true only right after the user submits the login form — the tour
  // should never reappear on a page reload/session restore.
  async _loadData(freshLogin) {
    const _dbg = (msg) => { try { localStorage.setItem('is_dbg', (localStorage.getItem('is_dbg')||'') + '\n' + Date.now() + ' ' + msg); } catch(e) {} };
    _dbg('_loadData freshLogin=' + freshLogin);
    const session = SB.getSession();
    _dbg('session=' + (session ? 'ok uid=' + session.user?.id : 'NULL'));
    if (!session) { this.setState({ loading: false }); return; }
    const uid = session.user?.id;

    // Stale-while-revalidate: if we have any cached data, render it immediately
    // then refresh in the background. Only skip cache on fresh login (just signed in).
    if (!freshLogin) {
      try {
        const cached = JSON.parse(localStorage.getItem('is_cache_' + uid) || 'null');
        _dbg('cached=' + (cached ? 'HIT role=' + cached.role : 'MISS'));
        if (cached && cached.data && cached.role) {
          this.myAgentId = cached.agentId;
          this.myClientId = cached.clientId;
          const { invApproved, invoiceStatus } = this._deriveInvState(cached.data);
          this.setState({ role: cached.role, loading: false, data: cached.data, route: 'dashboard', notifOpen: false, sidebarOpen: false, tourStep: null, invApproved, invoiceStatus });
          this._updatePresence('dashboard');
          this._startPolling();
          // Refresh data in the background without blocking the UI
          this._refreshCache(uid, cached.role, cached.agentId, cached.clientId);
          return;
        }
      } catch(e) {}
    }

    // No cache or fresh login — full blocking load
    await this._doFullLoad(uid, freshLogin);
  }

  async _doFullLoad(uid, freshLogin) {
    const _dbg = (msg) => { try { localStorage.setItem('is_dbg', (localStorage.getItem('is_dbg')||'') + '\n' + Date.now() + ' ' + msg); } catch(e) {} };
    _dbg('_doFullLoad start uid=' + uid);
    const role = await SB.rpc('get_user_role', { uid });
    _dbg('role=' + role);
    if (!role) {
      await SB.signOut();
      this.setState({ loading: false, loginError: 'Geen account gevonden. Neem contact op met Infinite Scale.' });
      return;
    }
    let agentId = null, clientId = null, subClientId = null;
    if (role === 'agent') agentId = await SB.rpc('get_agent_id', { uid });
    if (role === 'client' || role === 'agency') clientId = await SB.rpc('get_client_id', { uid });
    if (role === 'subclient') {
      // Find which subclient this user is by scanning client.subclients for user_id match
      const allClients = await SB.get('clients', '?select=id,subclients');
      for (const cl of (allClients || [])) {
        const sc = (cl.subclients || []).find(x => x.user_id === uid);
        if (sc) { clientId = cl.id; subClientId = sc.id; break; }
      }
      if (!subClientId) {
        await SB.signOut();
        this.setState({ loading: false, loginError: 'Subclient account niet gevonden. Neem contact op met Infinite Scale.' });
        return;
      }
    }
    this.myAgentId = agentId;
    this.myClientId = clientId;
    this.scClientId = clientId;
    this.scSubId = subClientId;
    _dbg('calling loadAll');
    const data = await API.loadAll(role, agentId, clientId, subClientId);
    _dbg('loadAll done appts=' + data?.appointments?.length);
    let tourSeen = true;
    try { tourSeen = !!localStorage.getItem(this._tourSeenKey(uid)); } catch(e) {}
    const tourStep = (freshLogin && !tourSeen && (role === 'agent' || role === 'client' || role === 'agency')) ? 0 : null;
    const { invApproved, invoiceStatus } = this._deriveInvState(data);
    this.setState({ role, loading: false, data, route: 'dashboard', notifOpen: false, sidebarOpen: false, tourStep, invApproved, invoiceStatus });
    if (freshLogin) setTimeout(() => this._logActivity('login', 'Logged in to platform'), 200);
    this._updatePresence('dashboard');
    this._startPolling();
    // Persist to cache for instant loads next time (exclude heavy/transient fields)
    try {
      const cacheData = { ...data, activityLog: [], presence: [] };
      const serialized = JSON.stringify({ data: cacheData, role, agentId, clientId });
      localStorage.setItem('is_cache_' + uid, serialized);
      _dbg('cache written size=' + serialized.length);
    } catch(e) { _dbg('cache FAILED: ' + e.message); }
  }

  async _refreshCache(uid, role, agentId, clientId) {
    try {
      const data = await API.loadAll(role, agentId, clientId);
      const cacheData = { ...data, activityLog: [], presence: [] };
      localStorage.setItem('is_cache_' + uid, JSON.stringify({ data: cacheData, role, agentId, clientId }));
      const { invApproved, invoiceStatus } = this._deriveInvState(data);
      this.setState({ data, invApproved, invoiceStatus });
    } catch(e) { console.error('Cache refresh failed:', e.message); }
  }

  _getPresenceId() {
    const s = this.state;
    const session = SB.getSession();
    return session?.user?.id || null;
  }

  _getPresenceName() {
    const s = this.state;
    if (s.role === 'agent' && this.myAgentId) {
      return (s.data.agents || []).find(a => a.id === this.myAgentId)?.name || '';
    } else if ((s.role === 'client' || s.role === 'agency') && this.myClientId) {
      return (s.data.clients || []).find(c => c.id === this.myClientId)?.name || '';
    } else if (s.role === 'admin') {
      return SB.getSession()?.user?.email?.split('@')[0] || 'Admin';
    }
    return '';
  }

  _updatePresence(route) {
    const uid = this._getPresenceId();
    if (!uid) return;
    const name = this._getPresenceName();
    const role = this.state.role;
    const routeLabels = { dashboard: 'Dashboard', log: 'Appointment Log', appointments: 'Appointments', eod: 'End of Day', payments: 'Payments', clients: 'Clients', agents: 'Call Agents', rooster: 'Rooster', stats: 'Statistics', settings: 'Settings', contracts: 'Contracts', finances: 'Finances', eodadmin: 'EOD Reports', timeline: 'Project Timeline', prospects: 'Prospect CRM', recruitment: 'Recruitment', apptadmin: 'Appointments', activity: 'Activity Feed', legal: 'Legal', billing: 'Billing', support: 'Support', todos: 'To-Do' };
    API.updatePresence(uid, name, role, route, routeLabels[route] || route);
  }

  _startPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._pollTimer = setInterval(() => this._poll(), 5000);
    this._heartbeatTimer = setInterval(() => this._updatePresence(this.state.route), 30000);
  }

  async _poll() {
    const role = this.state.role;
    if (!role) return;
    try {
      // All roles: poll for new notifications
      const rawNotifs = await SB.get('notifications', `?target_role=eq.${role}&order=created_at.desc&limit=20`);
      const d = this.state.data;
      const existing = d.notifs[role] || [];
      const kindAction = k => ({ appt: { route: 'apptadmin' }, pay: { route: 'payments' }, todo: { route: 'dashboard' }, bill: { route: 'finances' }, eod: { route: 'eodadmin' }, ticket: { route: 'support' }, contract: { route: 'contracts' } }[k] || null);
      for (const rec of (rawNotifs || [])) {
        if (!existing.find(n => n.id === rec.id)) {
          let action = null;
          if (rec.meta) { try { action = typeof rec.meta === 'string' ? JSON.parse(rec.meta) : rec.meta; } catch(e) {} }
          if (!action) action = kindAction(rec.kind);
          const n = { id: rec.id, text: rec.text, time: rec.time, read: rec.read, kind: rec.kind, action };
          this.mutLocal(dd => { if (!dd.notifs[role]) dd.notifs[role] = []; dd.notifs[role].unshift(n); });
          if (!rec.read) this.toast(rec.text, '', kindAction(rec.kind) ? 'var(--accent)' : 'var(--info)');
        }
      }

      if (role !== 'admin') return;

      const [rawAppts, rawAgents, rawPresence, rawRecruits] = await Promise.all([
        SB.get('appointments', '?order=date_logged.desc'),
        SB.get('agents', '?order=name'),
        SB.get('presence', '').catch(() => []),
        SB.get('recruits', '?order=created_at.desc'),
      ]);

      // Detect new appointments
      for (const rec of (rawAppts || [])) {
        if (!d.appointments.find(a => a.id === rec.id)) {
          const appt = {
            id: rec.id, agent: rec.agent_id, client: rec.client_id,
            sub: rec.sub_client_id || '', lead: rec.lead_name, phone: rec.phone || '',
            dateLog: rec.date_logged, dateAppt: rec.date_appt,
            status: rec.status, amount: rec.amount || 0, invoiced: rec.invoiced || false, paid: rec.paid || false,
          };
          const agentName = (d.agents.find(a => a.id === appt.agent) || {}).name || 'Agent';
          const clientName = (d.clients.find(c => c.id === appt.client) || {}).name || 'Client';
          this.mutLocal(dd => dd.appointments.unshift(appt));
          this._pushAdminNotif(`${agentName} booked ${appt.lead} for ${clientName}`, 'appt', { route: 'apptadmin', modal: 'appointmentDetail', modalForm: { id: appt.id } });
          this.toast('New appointment', `${agentName} · ${appt.lead} · ${clientName}`, 'var(--info)');
        }
      }

      // Sync appointment status/amount changes from other sessions
      for (const rec of (rawAppts || [])) {
        const cur = d.appointments.find(a => a.id === rec.id);
        if (cur && (cur.status !== rec.status || cur.amount !== (rec.amount || 0) || cur.invoiced !== (rec.invoiced || false) || cur.paid !== (rec.paid || false))) {
          this.mutLocal(dd => { const a = dd.appointments.find(x => x.id === rec.id); if (a) { a.status = rec.status; a.amount = rec.amount || 0; a.invoiced = rec.invoiced || false; a.paid = rec.paid || false; } });
        }
      }

      // Kickoff notifications (1 day and 3 days before)
      const todayMs = new Date(this.iso(this.today())).getTime();
      const sentKo = this.state.sentKickoffNotifs || {};
      for (const c of d.clients) {
        if (!c.kickoff) continue;
        const koMs = new Date(c.kickoff.slice(0, 10)).getTime();
        const daysLeft = Math.round((koMs - todayMs) / 86400000);
        if (daysLeft === 3 && !sentKo[c.id + '-3']) {
          this.setState(st => ({ sentKickoffNotifs: { ...(st.sentKickoffNotifs || {}), [c.id + '-3']: true } }));
          this._pushAdminNotif('Kickoff in 3 days: ' + c.name, 'info', { route: 'timeline' });
          this.toast('Kickoff soon', c.name + ' kicks off in 3 days', 'var(--warn)');
        }
        if (daysLeft === 1 && !sentKo[c.id + '-1']) {
          this.setState(st => ({ sentKickoffNotifs: { ...(st.sentKickoffNotifs || {}), [c.id + '-1']: true } }));
          this._pushAdminNotif('Kickoff tomorrow: ' + c.name + '!', 'info', { route: 'timeline' });
          this.toast('Kickoff tomorrow', c.name + ' kicks off tomorrow!', 'var(--down)');
        }
      }

      // Update presence data
      if (rawPresence) this.mutLocal(dd => { dd.presence = rawPresence; });

      // Detect agent working-status changes
      for (const rec of (rawAgents || [])) {
        const cur = d.agents.find(a => a.id === rec.id);
        if (cur && cur.working !== rec.working) {
          this.mutLocal(dd => {
            const a = dd.agents.find(x => x.id === rec.id);
            if (a) { a.working = rec.working; a.workSince = rec.work_since || null; }
          });
          this._pushAdminNotif(`${cur.name} is now ${rec.working ? 'online' : 'offline'}`);
          this.toast(cur.name, rec.working ? 'Now online' : 'Now offline', rec.working ? 'var(--up)' : 'var(--text-mute)');
        }
      }

      // Sync recruits (new candidates + stage changes from other sessions)
      if (rawRecruits) {
        const recruitsNorm = rawRecruits.map(r => ({ id: r.id, name: r.name, email: r.email || '', phone: r.phone || '', position: r.position || '', country: r.country || '', lang: r.lang || '', source: r.source || '', stage: r.stage || 'new', notes: r.notes || '', created_at: r.created_at }));
        for (const rec of recruitsNorm) {
          const cur = d.recruits.find(x => x.id === rec.id);
          if (!cur) {
            this.mutLocal(dd => dd.recruits.unshift(rec));
            this._pushAdminNotif('New recruit application: ' + rec.name, 'recruit', { route: 'recruitment' });
          } else if (cur.stage !== rec.stage && !(this._pendingRecruitStages && this._pendingRecruitStages[rec.id])) {
            this.mutLocal(dd => { const r = dd.recruits.find(x => x.id === rec.id); if (r) r.stage = rec.stage; });
          }
        }
      }

      // Refresh todos for current day if on todos screen
      if (this.state.route === 'todos') {
        const todayStr = new Date().toISOString().slice(0, 10);
        const day = this.state.todosDay || todayStr;
        const rawTodos = await SB.get('todos', `?day=eq.${day}&order=order_idx.asc,created_at.asc`).catch(() => null);
        if (rawTodos) {
          const curList = this.state.todosList;
          const hasChanges = !curList || rawTodos.length !== curList.length || rawTodos.some(t => { const c = curList.find(x => x.id === t.id); return !c || c.completed_at !== t.completed_at || c.order_idx !== t.order_idx || c.title !== t.title; });
          if (hasChanges) this.setState({ todosList: rawTodos, _todosLoaded: true });
        }
      }
    } catch (e) {}
  }

  _pushNotif(role, text, kind, action) {
    const n = { id: 'rt' + Date.now(), text, time: new Date().toISOString().slice(0, 16).replace('T', ' '), read: false, kind: kind || 'info', action };
    this.mutLocal(d => { if (!d.notifs[role]) d.notifs[role] = []; d.notifs[role].unshift(n); });
    API.pushNotif(role, text, kind, action);
  }
  _pushAdminNotif(text, kind, action) { this._pushNotif('admin', text, kind || 'info', action); }

  handleNotifClick(n) {
    if (!n || !n.action) return;
    const a = n.action;
    this.setState({ notifOpen: false });
    if (a.invExpanded) this.setState(st => ({ invExpanded: { ...(st.invExpanded || {}), [a.invExpanded]: true } }));
    if (a.route) this.setState({ route: a.route });
    if (a.modal) setTimeout(() => this.openModal(a.modal, a.modalForm || {}), 40);
  }

  async _doLogout() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    API.clearPresence(this._getPresenceId());
    try { const uid = SB.getSession()?.user?.id; if (uid) localStorage.removeItem('is_cache_' + uid); } catch(e) {}
    await SB.signOut();
    this.myAgentId = null;
    this.myClientId = null;
    this.setState({ role: null, modal: null, notifOpen: false, tourStep: null, data: this._emptyData(), loginEmail: '', loginPassword: '' });
  }

  // ---- Navigation ----
  _logActivity(action, details) {
    const s = this.state;
    if (!s.role || s.loading) return;
    let userName = '';
    if (s.role === 'agent' && this.myAgentId) {
      const me = (s.data.agents || []).find(a => a.id === this.myAgentId);
      userName = me?.name || '';
    } else if ((s.role === 'client' || s.role === 'agency') && this.myClientId) {
      const me = (s.data.clients || []).find(c => c.id === this.myClientId);
      userName = me?.name || '';
    } else if (s.role === 'admin') {
      const sess = SB.getSession();
      userName = sess?.user?.email?.split('@')[0] || 'Admin';
    }
    API.logActivity(userName, s.role, action, details);
  }

  go(route) {
    const labels = { dashboard: 'Dashboard', log: 'Appointment Log', appointments: 'Appointments', eod: 'End of Day', payments: 'Payments', clients: 'Clients', agents: 'Call Agents', rooster: 'Rooster / Schedule', stats: 'Statistics', settings: 'Settings', contracts: 'Contracts', finances: 'Finances', eodadmin: 'EOD Reports', timeline: 'Project Timeline', prospects: 'Prospect CRM', recruitment: 'Recruitment', apptadmin: 'Appointments', activity: 'Activity Feed', legal: 'Legal', billing: 'Billing', support: 'Support', todos: 'To-Do' };
    this._logActivity('navigate', 'Opened ' + (labels[route] || route));
    this._updatePresence(route);
    this.setState({ route, notifOpen: false, sidebarOpen: false });
  }
  openModal(kind, form) { this.setState({ modal: true, modalKind: kind, form: form || {}, notifOpen: false }); }
  closeModal() { this.setState({ modal: null, modalKind: null, form: {} }); }
  setForm(k, v) { this.setState(s => ({ form: { ...s.form, [k]: v, apptError: null } })); }

  // ---- Mutations (update local state + persist to Supabase) ----
  mutLocal(fn) {
    this.setState(s => { const d = JSON.parse(JSON.stringify(s.data)); fn(d, s); return { data: d }; });
  }

  async saveApptEdits(id) {
    console.log('[SAE] called with id:', id);
    const f = this.state.form;
    const d = this.state.data;
    const ap = d.appointments.find(x => x.id === id);
    console.log('[SAE] ap found:', !!ap, 'apIds:', d.appointments.slice(0,3).map(x=>x.id));
    if (!ap) return;
    const rawAgentRate = f.eApptAgentRate !== undefined ? f.eApptAgentRate : (ap.agentRate != null ? String(ap.agentRate) : '');
    const rawCommission = f.eApptCommission !== undefined ? f.eApptCommission : (ap.dealCommission != null ? String(ap.dealCommission) : '');
    const rawDealAmount = f.eApptDealAmount !== undefined ? f.eApptDealAmount : (ap.dealAmount != null ? String(ap.dealAmount) : '');
    const fields = {
      lead_name: f.eApptLead !== undefined ? f.eApptLead.trim() : ap.lead,
      phone: f.eApptPhone !== undefined ? f.eApptPhone : (ap.phone || ''),
      client_id: f.eApptClient !== undefined ? f.eApptClient : ap.client,
      sub_client_id: f.eApptSub !== undefined ? (f.eApptSub || null) : (ap.sub || null),
      agent_id: f.eApptAgent !== undefined ? f.eApptAgent : ap.agent,
      amount: f.eApptAmount !== undefined ? (parseFloat(f.eApptAmount) || 0) : (ap.amount || 0),
      date_appt: f.eApptDate !== undefined ? f.eApptDate : ap.dateAppt,
      date_logged: f.eApptDateLog !== undefined ? f.eApptDateLog : ap.dateLog,
      agent_rate: rawAgentRate !== '' ? (parseFloat(rawAgentRate) ?? null) : null,
      deal_commission: rawCommission !== '' ? (parseFloat(rawCommission) || null) : null,
      deal_amount: rawDealAmount !== '' ? (parseFloat(rawDealAmount) || null) : null,
    };
    this.mutLocal(dd => {
      const a = dd.appointments.find(x => x.id === id); if (!a) return;
      a.lead = fields.lead_name; a.phone = fields.phone;
      a.client = fields.client_id; a.sub = fields.sub_client_id || '';
      a.agent = fields.agent_id; a.amount = fields.amount;
      a.dateAppt = fields.date_appt; a.dateLog = fields.date_logged;
      a.agentRate = fields.agent_rate;
      a.dealCommission = fields.deal_commission;
      a.dealAmount = fields.deal_amount;
    });
    console.log('[saveApptEdits] fields:', JSON.stringify({deal_amount: fields.deal_amount, deal_commission: fields.deal_commission, eApptDealAmount: f.eApptDealAmount, eApptCommission: f.eApptCommission}));
    const ok = await API.patchAppointment(id, fields);
    this.setState(st => ({ form: { ...st.form, apptEditing: false, eApptLead: undefined, eApptPhone: undefined, eApptClient: undefined, eApptSub: undefined, eApptAgent: undefined, eApptAmount: undefined, eApptDate: undefined, eApptDateLog: undefined, eApptAgentRate: undefined, eApptCommission: undefined, eApptDealAmount: undefined } }));
    if (ok && ok.ok !== false) this.toast('Saved ✓', 'Appointment updated', 'var(--up)');
    else this.toast('Fout', 'Opslaan mislukt', 'var(--down)');
  }

  async setApptStatus(id, status) {
    const d = this.state.data;
    const ap = d.appointments.find(x => x.id === id);
    const cl = ap ? d.clients.find(c => c.id === ap.client) : null;
    let clientRate = (cl || {}).rate || 0;
    if (ap && ap.sub && cl && cl.subclients) {
      const sc = cl.subclients.find(s => s.id === ap.sub || s.name === ap.sub);
      if (sc) clientRate = sc.rate || clientRate;
    }
    const amount = status === 'show' ? clientRate : 0;
    this.mutLocal(dd => { const a = dd.appointments.find(x => x.id === id); if (a) { a.status = status; a.amount = amount; } });
    await API.setApptStatus(id, status, amount);
    const m = { show: 'Marked as Show', no_show: 'Marked as No-show', cancel: 'Marked as Cancelled' };
    this._logActivity('appointment_updated', 'Set appointment status → ' + status + (ap ? ' — Lead: ' + ap.lead : ''));
    this.toast('Updated', m[status] || 'Status updated', status === 'show' ? 'var(--up)' : 'var(--down)');
  }

  async saveApptFeedback(id, feedback) {
    this.mutLocal(dd => { const a = dd.appointments.find(x => x.id === id); if (a) a.clientFeedback = feedback; });
    await API.saveApptFeedback(id, feedback);
    this.toast('Saved', 'Feedback saved', 'var(--accent)');
  }

  async toggleWorking() {
    const me = this.state.data.agents.find(a => a.id === this.myAgentId);
    if (!me) return;
    const working = !me.working;
    const workSince = working ? new Date().toISOString() : null;
    this.mutLocal(d => { const a = d.agents.find(x => x.id === this.myAgentId); if (a) { a.working = working; a.workSince = workSince; } });
    await API.setWorking(this.myAgentId, working);
    this.toast('Status', working ? 'You are now online' : 'You are now offline', 'var(--accent)');
  }

  async toggleTodo(id, me) {
    const agent = me || this.state.data.agents.find(a => a.id === this.myAgentId);
    if (!agent) return;
    const todos = (agent.todos || []).map(t => t.id === id ? { ...t, done: !t.done } : t);
    this.mutLocal(d => { const a = d.agents.find(x => x.id === agent.id); if (a) a.todos = todos; });
    await API.saveTodos(agent.id, todos);
  }

  async addTodo(text) {
    if (!text) return;
    const agent = this.state.data.agents.find(a => a.id === this.myAgentId);
    if (!agent) return;
    const todos = [...(agent.todos || []), { id: 't' + Date.now(), text, done: false }];
    this.mutLocal(d => { const a = d.agents.find(x => x.id === this.myAgentId); if (a) a.todos = todos; });
    await API.saveTodos(this.myAgentId, todos);
    this.toast('Added', 'To-do created', 'var(--accent)');
  }

  async markAllRead() {
    this.mutLocal(d => { (d.notifs[this.state.role] || []).forEach(n => n.read = true); });
    await API.markAllNotifsRead(this.state.role);
  }

  async markPaid(clientId) {
    this.mutLocal(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.billStatus = 'paid'; d.appointments.forEach(a => { if (a.client === clientId && a.invoiced) a.paid = true; }); });
    await API.markInvoicePaid(clientId);
    this.toast('Billing', 'Invoice marked as paid', 'var(--up)');
  }

  async unmarkPaid(clientId) {
    this.mutLocal(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.billStatus = 'pending'; d.appointments.forEach(a => { if (a.client === clientId) a.paid = false; }); });
    await API.setBillStatus(clientId, 'pending');
    this.toast('Billing', 'Reset to pending', 'var(--warn)');
  }

  async cycleClientStatus(clientId) {
    const cycle = { active: 'starting', starting: 'inactive', inactive: 'active' };
    const cur = (this.state.data.clients.find(x => x.id === clientId) || {}).status || 'active';
    const next = cycle[cur] || 'active';
    this.mutLocal(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.status = next; });
    await API.setClientStatus(clientId, next);
    this.toast('Status', next.charAt(0).toUpperCase() + next.slice(1), 'var(--accent)');
  }

  async moveProspect(id, stage) {
    this.mutLocal(d => { const p = d.prospects.find(x => x.id === id); if (p) p.stage = stage; });
    await API.updateProspectStage(id, stage);
  }

  async addProspect(f) {
    if (!f.company) { this.toast('Error', 'Add a company', 'var(--down)'); return; }
    const row = { company: f.company, contact: f.contact || '', phone: f.phone || '', email: f.email || '', assigned: f.assigned || 'Quinten', source: f.source || 'LinkedIn', stage: 'new', next_action: 'Qualify', next_date: this.iso(this.today()), notes: f.notes || '' };
    this.mutLocal(d => d.prospects.unshift({ id: 'p' + Date.now(), ...row, next: row.next_action, nextDate: row.next_date }));
    await API.addProspect(row);
    this.closeModal();
    this.toast('Prospect', 'Added to pipeline', 'var(--accent)');
  }

  async advanceRecruit(id, stage) {
    if (!this._pendingRecruitStages) this._pendingRecruitStages = {};
    this._pendingRecruitStages[id] = stage;
    this.mutLocal(d => { const r = d.recruits.find(x => x.id === id); if (r) r.stage = stage; });
    await API.advanceRecruit(id, stage);
    delete this._pendingRecruitStages[id];
    this.toast('Recruitment', 'Candidate moved to ' + stage.replace('_', ' '), 'var(--accent)');
  }

  async createClient(f) {
    const type = f.newType || 'direct';
    const rate = +(String(f.rate || '45').replace(/\D/g, '')) || 45;
    const row = { name: f.name, type, status: 'starting', crm: f.crm || 'none', crm_on: f.crm && f.crm !== 'none', kickoff: this.iso(this.today()), rate, contact_person: f.name, email: f.email || '', company: f.name, bill_status: 'pending', subclients: [] };
    const res = await API.createClient(row);
    if (res) {
      const norm = { ...row, id: res[0]?.id || 'c' + Date.now(), agents: [], clients: [], crmOn: row.crm_on, contactPerson: row.contact_person, billStatus: row.bill_status };
      this.mutLocal(d => d.clients.push(norm));
      // If linking this new client to an existing agency, add it to that agency's subclients
      if (type === 'direct' && f.linkAgency) {
        const agency = this.state.data.clients.find(x => x.id === f.linkAgency);
        if (agency) {
          const newSubs = [...(agency.subclients || []), { name: f.name, rate }];
          this.mutLocal(d => { const ag = d.clients.find(x => x.id === f.linkAgency); if (ag) ag.subclients = newSubs; });
          await API.updateClient(f.linkAgency, { subclients: newSubs });
        }
      }
    }
    this.closeModal();
    this.toast('Created', 'Client added & email sent', 'var(--up)');
  }

  async createAgent(f) {
    const row = { name: f.name, email: f.email || '', phone: f.phone || '', vat: f.vat || '', business: '', active: true, status: 'signed', lifetime_paid: 0, working: false, feedback: [], todos: [] };
    const res = await API.createAgent(row);
    if (res) { const norm = { ...row, id: res[0]?.id || 'a' + Date.now(), clients: [], rates: {}, lifetime: 0 }; this.mutLocal(d => d.agents.push(norm)); }
    this.closeModal();
    this.toast('Created', 'Agent added & email sent', 'var(--up)');
  }

  async toggleAgent(id, active) {
    this.mutLocal(d => { const a = d.agents.find(x => x.id === id); if (a) a.active = active; });
    await API.toggleAgentActive(id, active);
    this.toast('Agent', active ? 'Reactivated' : 'Deactivated', active ? 'var(--up)' : 'var(--down)');
  }

  async deactivateClient(id) {
    this.mutLocal(d => { const c = d.clients.find(x => x.id === id); if (c) c.status = 'inactive'; });
    await API.deactivateClient(id);
    this.toast('Client', 'Deactivated', 'var(--down)');
  }

  async logAppointment() {
    const f = this.state.form;
    const isRenocheck = f.client === 'c15';
    const rnFullName = isRenocheck ? ((f.rnFirst || '') + ' ' + (f.rnLast || '')).trim() : f.lead;
    const rnPhone = isRenocheck ? f.phone : f.phone;
    let apptError = null;
    if (!f.client || !f.dateAppt) apptError = 'Vul client en datum in.';
    else if (isRenocheck && !f.rnFirst) apptError = 'Voornaam is verplicht.';
    else if (isRenocheck && !f.rnCategory) apptError = 'Selecteer een Renocheck categorie.';
    else if (!isRenocheck && !f.lead) apptError = 'Lead naam is verplicht.';
    else if (!String(f.phone || '').trim()) apptError = 'Telefoonnummer is verplicht.';
    if (apptError) { this.setState(s => ({ form: { ...s.form, apptError } })); this.toast('Fout', apptError, 'var(--down)'); return; }
    this.setState(s => ({ form: { ...s.form, apptError: null } }));
    const c = this.state.data.clients.find(x => x.id === f.client);
    let amount = c ? c.rate : 0;
    if (f.sub && c && c.subclients) {
      const sc = c.subclients.find(s => s.id === f.sub);
      if (sc) amount = sc.rate || amount;
    }
    const RN_RATES = { 'Airco': { revenue: 25, payout: 8 }, 'Thuisbatt': { revenue: 40, payout: 12 }, 'Zonnepanelen': { revenue: 50, payout: 15 }, 'Keukens': { revenue: 55, payout: 15 }, 'Badkamers': { revenue: 55, payout: 15 }, 'Ramen en deuren': { revenue: 70, payout: 15 }, 'Crepi': { revenue: 70, payout: 15 }, 'Dak': { revenue: 80, payout: 20 } };
    const dateLogged = this.iso(this.today());
    const leadName = isRenocheck ? rnFullName : f.lead;
    if (isRenocheck && f.rnCategory && RN_RATES[f.rnCategory]) { amount = RN_RATES[f.rnCategory].payout; }

    let clientFeedback = null;
    if (isRenocheck) {
      const c = f.rnCategory;
      const intakeData = c === 'Dak' ? {
        eigenaar: f.rnEigenaar || '', type_dak: f.rnTypeDak || '', groote_dak: f.rnGrooteDak || '',
        zonnepanelen: f.rnZonnepanelen || '', zonnepanelen_gewenst: f.rnZonnepanelenGewenst || '',
        asbest: f.rnAsbest || '', lekkages: f.rnLekkages || '', isolatie_nodig: f.rnIsolatieNodig || '',
        dikte_isolatie: f.rnDikteIsolatie || '', kleur_dakpannen: f.rnKleurDakpannen || '',
        info_project: f.rnInfoProject || '', timing: f.rnTiming || '',
        financiering: f.rnFinanciering || '', premie_aanvraag: f.rnPremie || '', voorkeur_belmoment: f.rnBelmoment || [],
      } : c === 'Crepi' ? {
        eigenaar: f.rnEigenaar || '', aantal_gevels: f.rnAantalGevels || '', voorgevel: f.rnVoorgevel || '',
        oprit: f.rnOprit || '', afmeting: f.rnAfmeting || '', isolatie_nodig: f.rnIsolatieNodig || '',
        dikte_isolatie: f.rnDikteIsolatie || '', kleur_crepi: f.rnKleurCrepi || '',
        info_project: f.rnInfoProject || '', timing: f.rnTiming || '',
        financiering: f.rnFinanciering || '', premie_aanvraag: f.rnPremie || '', voorkeur_belmoment: f.rnBelmoment || [],
      } : c === 'Airco' ? {
        eigenaar: f.rnEigenaar || '', type_woning: f.rnTypeWoning || '', aantal_ruimtes: f.rnAantalRuimtes || '',
        grootte_ruimte: f.rnGrootteRuimte || '', merk: f.rnMerk || '', vergelijken: f.rnVergelijken || '',
        financiering: f.rnFinanciering || '', info_project: f.rnInfoProject || '', timing: f.rnTiming || '',
        premie_aanvraag: f.rnPremie || '', voorkeur_belmoment: f.rnBelmoment || [],
      } : c === 'Ramen en deuren' ? {
        eigenaar: f.rnEigenaar || '', type_werk: f.rnTypeWerk || '', materiaal: f.rnMateriaal || '',
        type_glas: f.rnTypeGlas || '', kleur: f.rnKleur || '', rolluiken: f.rnRolluiken || '',
        vervanging: f.rnVervanging || '', financiering: f.rnFinanciering || '',
        info_project: f.rnInfoProject || '', timing: f.rnTiming || '',
        premie_aanvraag: f.rnPremie || '', voorkeur_belmoment: f.rnBelmoment || [],
      } : c === 'Thuisbatt' ? {
        eigenaar: f.rnEigenaar || '', doel_batterij: f.rnDoelBatterij || '', jaarverbruik: f.rnJaarverbruik || '',
        piekverbruik: f.rnPiekverbruik || '', capaciteit: f.rnCapaciteit || '', digitale_meter: f.rnDigitaleMeter || '',
        merk: f.rnMerk || '', locatie: f.rnLocatie || '', laadpaal: f.rnLaadpaal || '',
        financiering: f.rnFinanciering || '', info_project: f.rnInfoProject || '', timing: f.rnTiming || '',
        premie_aanvraag: f.rnPremie || '', voorkeur_belmoment: f.rnBelmoment || [],
      } : c === 'Zonnepanelen' ? {
        eigenaar: f.rnEigenaar || '', type_installatie: f.rnTypeInstallatie || '', jaarverbruik: f.rnJaarverbruik || '',
        type_dak: f.rnTypeDak || '', dakoppervlakte: f.rnGrooteDak || '', orientatie: f.rnOrientatie || '',
        schaduw: f.rnSchaduw || '', asbest: f.rnAsbest || '', digitale_meter: f.rnDigitaleMeter || '',
        thuisbatterij: f.rnThuisbatterij || '', capaciteit: f.rnCapaciteit || '', laadpaal: f.rnLaadpaal || '',
        airco: f.rnAirco || '', financiering: f.rnFinanciering || '', info_project: f.rnInfoProject || '',
        timing: f.rnTiming || '', premie_aanvraag: f.rnPremie || '', voorkeur_belmoment: f.rnBelmoment || [],
      } : c === 'Badkamers' ? {
        eigenaar: f.rnEigenaar || '', type_project: f.rnTypeProject || '', afmeting: f.rnAfmeting || '',
        douche: f.rnDouche || '', bad: f.rnBad || '', lavabo: f.rnLavabo || '', toilet: f.rnToilet || '',
        tegelwerk: f.rnTegelwerk || '', sanitair: f.rnSanitair || '', loodgieterij: f.rnLoodgieterij || '',
        elektriciteit: f.rnElektriciteit || '', financiering: f.rnFinanciering || '',
        info_project: f.rnInfoProject || '', timing: f.rnTiming || '',
        premie_aanvraag: f.rnPremie || '', voorkeur_belmoment: f.rnBelmoment || [],
      } : c === 'Keukens' ? {
        eigenaar: f.rnEigenaar || '', type_project: f.rnTypeProject || '', afmeting: f.rnAfmeting || '',
        financiering: f.rnFinanciering || '', info_project: f.rnInfoProject || '', timing: f.rnTiming || '',
        premie_aanvraag: f.rnPremie || '', voorkeur_belmoment: f.rnBelmoment || [],
      } : null;
      const description = intakeData ? [intakeData.info_project || '', intakeData.timing || ''].filter(Boolean).join(' — ') : '';
      const rnPayload = {
        category: f.rnCategory,
        firstname: f.rnFirst || '',
        lastname: f.rnLast || '',
        email: f.rnEmail || '',
        phonenumber: f.phone,
        street: f.rnStreet || '',
        number: f.rnNumber || '',
        zipcode: f.rnPostal || '',
        city: f.rnCity || '',
        ...(description ? { description } : {}),
        ...(intakeData ? { data: intakeData } : {}),
      };
      try {
        const rnRes = await fetch('/api/renocheck-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rnPayload) });
        if (!rnRes.ok) {
          const errText = await rnRes.text();
          console.error('Renocheck API error:', errText);
          this.toast('Renocheck fout', 'Lead kon niet naar Renocheck gestuurd worden: ' + errText.slice(0, 80), 'var(--down)');
          return;
        }
      } catch (err) {
        console.error('Renocheck fetch failed:', err);
        this.toast('Renocheck fout', 'Kon Renocheck niet bereiken. Probeer opnieuw.', 'var(--down)');
        return;
      }
      const rnRev = (RN_RATES[f.rnCategory] || {}).revenue || 0;
      clientFeedback = JSON.stringify({ _rn: true, revenue: rnRev, category: f.rnCategory, email: f.rnEmail || '', street: f.rnStreet || '', number: f.rnNumber || '', zipcode: f.rnPostal || '', city: f.rnCity || '', ...(intakeData ? { data: intakeData } : {}) });
    }

    const result = await API.logAppointment(this.myAgentId, f.client, f.sub || null, leadName, f.phone, f.dateAppt, dateLogged, amount, clientFeedback);
    if (!result) {
      this.setState(s => ({ form: { ...s.form, apptError: 'Opslaan mislukt — probeer opnieuw of contacteer de admin.' } }));
      this.toast('Fout bij opslaan', 'Afspraak kon niet worden opgeslagen. Probeer opnieuw.', 'var(--down)');
      return;
    }
    const saved = Array.isArray(result) ? result[0] : result;
    this.mutLocal(d => d.appointments.unshift({ id: saved?.id || ('ap' + Date.now()), agent: this.myAgentId, client: f.client, sub: f.sub || '', lead: leadName, phone: f.phone || '', dateLog: dateLogged, dateAppt: f.dateAppt, status: 'open', amount, invoiced: false, paid: false, clientFeedback: clientFeedback || '' }));
    this._logActivity('appointment_logged', 'Logged appointment — ' + (this.state.data.clients.find(x => x.id === f.client)?.name || f.client) + ' — Lead: ' + leadName + ' (€' + amount + ')');
    this.closeModal();
    this.toast('Logged', isRenocheck ? 'Lead verzonden naar Renocheck & afspraak gelogd' : 'Appointment added', 'var(--up)');
  }

  async submitEOD() {
    const f = this.state.form;
    const date = this.iso(this.today());
    this.mutLocal(d => d.eods.unshift({ id: 'e' + Date.now(), agent: this.myAgentId, date, clients: f.clients || [], calls: f.calls || {}, appts: f.appts || {}, well: f.well || '', bad: f.bad || '', goal: f.goal || '', callBlocks: f.callBlocks || [] }));
    await API.submitEOD(this.myAgentId, date, f.clients || [], f.calls || {}, f.appts || {}, f.well || '', f.bad || '', f.goal || '', f.callBlocks || []);
    const totalCalls = Object.values(f.calls || {}).reduce((a, b) => a + (parseInt(b) || 0), 0);
    const totalAppts = Object.values(f.appts || {}).reduce((a, b) => a + (parseInt(b) || 0), 0);
    this._logActivity('eod_submitted', 'Submitted EOD report — ' + totalCalls + ' calls, ' + totalAppts + ' appointments');
    this.closeModal();
    this.toast('Report', 'End-of-day report submitted', 'var(--up)');
  }

  async submitTicket() {
    const f = this.state.form;
    if (!f.title) { this.toast('Error', 'Add a title first', 'var(--down)'); return; }
    this.mutLocal(d => d.tickets.push({ id: 'tk' + Date.now(), time: this.iso(this.today()) + ' ' + new Date().toTimeString().slice(0, 5), title: f.title, cat: f.cat || 'General', client: this.myClientId, desc: f.desc || '', status: 'open' }));
    await API.submitTicket(this.myClientId, f.title, f.cat || 'General', f.desc || '');
    this._logActivity('ticket_submitted', 'Submitted support ticket — "' + f.title + '" (' + (f.cat || 'General') + ')');
    this.closeModal();
    this.toast('Support', 'Ticket submitted', 'var(--accent)');
  }

  async requestChange(id, leadName) {
    const cl = this._data ? this._data.clients.find(c => c.id === this.myClientId) : null;
    const clName = cl ? cl.name : 'Client';
    await API.submitTicket(this.myClientId, `Wijzigingsverzoek: ${leadName || id}`, 'change_request', `${clName} vraagt een wijziging voor afspraak met lead "${leadName || id}" (ID: ${id}).`);
    await API.pushNotif('admin', `${clName} vraagt een wijziging voor een afspraak`, 'ticket', { route: 'support' });
    this.toast('Verzonden', 'Wijzigingsverzoek verzonden naar admin', 'var(--info)');
  }
  async approveInvoice(agentId) {
    await API.approveAgentInvoice(agentId);
    this.mutLocal(d => d.appointments.forEach(a => { if (a.agent === agentId) a.invoiced = true; }));
    this.toast('Approved', 'Invoicing approved — agent can now invoice', 'var(--up)');
  }
  async sendContract() {
    const f = this.state.form;
    if (!f.email) { this.toast('Error', 'Add a recipient email', 'var(--down)'); return; }
    const partyType = f.partyType || 'client';
    const isAddendum = partyType === 'addendum';
    const contractId = 'ct' + Date.now();
    const signingLink = 'https://platform.infinite-scale.be/sign?token=' + contractId;
    const party = (partyType === 'agent' || isAddendum) ? (f.agentName || '') : (f.company || '');
    const contractType = isAddendum ? ('Addendum — ' + (f.endClientName || f.endProject || 'Project')) : (f.ctype || 'Contract');
    const payComps = isAddendum && Array.isArray(f.payComponents) ? f.payComponents : [];
    const contractValue = isAddendum
      ? (payComps.map(c => c.type + ': €' + (c.amount || '?')).join(' / ') || '—')
      : (f.rate ? '€' + f.rate + ' / appointment' : (f.duration || '—'));
    const contract = {
      id: contractId,
      party,
      party_type: isAddendum ? 'agent' : partyType,
      type: contractType,
      value: f.rate ? '€' + f.rate + '/appt' : (f.duration || ''),
      sent: new Date().toISOString().slice(0, 10),
      status: 'sent',
      email: f.email,
      vat: f.vat || '',
      address: f.address || '',
      contact: f.contact || '',
      duration: f.duration || '',
      notes: f.notes || '',
      setup_fee: f.setup_fee || '',
      signing_link: signingLink,
    };
    this.mutLocal(d => d.contracts.unshift(contract));
    this.closeModal();
    this.toast('Verzenden…', 'Contract wordt verstuurd naar ' + f.email, 'var(--accent)');
    try {
      await API.addContract(contract);
    } catch(e) {
      this.mutLocal(d => { d.contracts = d.contracts.filter(c => c.id !== contract.id); });
      this.toast('FOUT: Contract NIET opgeslagen', 'DB write mislukt — probeer opnieuw: ' + (e.message || e), 'var(--down)');
      return;
    }
    this._logActivity('contract_sent', 'Sent contract to ' + party + ' <' + f.email + '> — ' + contractType);
    API.sendContractEmail({ to: f.email, party, contractType, contractValue, signingLink, notes: f.notes || '' })
      .then(() => this.toast('Verzonden', 'Contract e-mail bezorgd aan ' + f.email, 'var(--up)'))
      .catch(() => this.toast('E-mail mislukt', 'Contract opgeslagen maar e-mail niet bezorgd', 'var(--down)'));
  }

  async convertContractToClient(contract) {
    // Parse rate from contract value string like "€140/afspraak"
    const rateMatch = (contract.value || '').match(/[\d,]+/);
    const rate = rateMatch ? +(rateMatch[0].replace(',', '.')) : 0;
    const name = contract.party || '';

    const kickoff = await new Promise(resolve => {
      const defaultDate = new Date().toISOString().slice(0, 10);
      const input = prompt('Kickoff datum (YYYY-MM-DD):', defaultDate);
      resolve(input || defaultDate);
    });
    if (kickoff === null) return; // cancelled

    const row = {
      name,
      type: 'direct',
      status: 'starting',
      crm: 'none',
      crm_on: false,
      kickoff,
      rate,
      contact_person: contract.contact || name,
      email: contract.email || '',
      company: name,
      bill_status: 'pending',
      subclients: [],
    };

    const res = await API.createClient(row);
    if (res) {
      const clientId = res[0]?.id || 'c' + Date.now();
      const norm = { ...row, id: clientId, agents: [], clients: [], crmOn: false, contactPerson: row.contact_person, billStatus: row.bill_status };
      this.mutLocal(d => d.clients.push(norm));
      this._logActivity('client_created', 'Client aangemaakt vanuit contract: ' + name);
      // Link profile_id if an auth account already exists for this email
      // (handles case where prospect created account before admin pressed Convert to Client)
      if (row.email) {
        fetch('/api/create-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: row.email, party: name, party_type: 'client', link_only: true }),
        }).catch(() => {});
      }
      this.closeModal();
      this.toast('Client aangemaakt ✓', name + ' toegevoegd als client', 'var(--up)');
      await this._loadData(false);
      this.openModal('clientProfile', { id: clientId });
    } else {
      this.toast('Fout', 'Client aanmaken mislukt', 'var(--down)');
    }
  }

  async updateContract(contractId, updates) {
    const existing = this.state.data.contracts.find(x => x.id === contractId);
    this.mutLocal(d => { const c = d.contracts.find(x => x.id === contractId); if (c) Object.assign(c, updates); });
    await API.updateContract(contractId, updates);
    if (updates.status) this._logActivity('contract_updated', 'Changed contract status → ' + updates.status + (existing ? ' (' + existing.party + ')' : ''));
    this.toast('Saved', 'Contract updated', 'var(--up)');
  }

  async sendFollowupEmail(prospectId, templateName, body) {
    await this.updateProspectDetail(prospectId, { last_followup: new Date().toISOString().slice(0, 10), last_followup_type: templateName });
    this.closeModal();
    this.toast('Email sent', templateName + ' sent', 'var(--accent)');
  }

  async saveDials(count) {
    const today = this.iso(this.today());
    const n = Math.max(0, parseInt(count) || 0);
    this.mutLocal(d => { if (!d.dials[this.myAgentId]) d.dials[this.myAgentId] = {}; d.dials[this.myAgentId][today] = n; });
    await API.upsertDials(this.myAgentId, today, n);
    this._logActivity('dials_updated', 'Updated dial count to ' + n);
    this.toast('Dials', 'Logged ' + n + ' dials', 'var(--accent)');
  }

  async saveClientEdits() {
    window.__saveClientEditsVersion = 'v20260723d-NEW';
    const f = this.state.form;
    const id = f.id;
    const d = this.state.data;
    const c = d.clients.find(x => x.id === id);
    if (!c) return;
    // Always include all fields — use form value if changed, else current client value
    const name = f.editName !== undefined ? f.editName : c.name;
    const contact = f.editContact !== undefined ? f.editContact : (c.contactPerson || '');
    const email = f.editEmail !== undefined ? f.editEmail : (c.email || '');
    const phone = f.editPhone !== undefined ? f.editPhone : (c.phone || '');
    const vat = f.editVat !== undefined ? f.editVat : (c.vat || '');
    const rate = f.editRate !== undefined ? +(String(f.editRate).replace(/\D/g, '')) || 0 : c.rate;
    const status = f.editStatus !== undefined ? f.editStatus : (c.status || 'starting');
    const crm = f.editCrm !== undefined ? f.editCrm : (c.crm || 'none');
    const koDate = f.editKickoffDate !== undefined ? f.editKickoffDate : (c.kickoff || '').slice(0, 10);
    const koTime = f.editKickoffTime !== undefined ? f.editKickoffTime : ((c.kickoff || '').slice(11, 16) || '09:00');
    const kickoff = koDate ? koDate + 'T' + koTime : null;
    const type = f.editType !== undefined ? f.editType : (c.type || 'direct');
    const subclients = f.editSubclients !== undefined ? f.editSubclients : (c.subclients || []);
    const updates = {
      name, contact_person: contact, email, vat, rate,
      status, crm, crm_on: crm !== 'none', kickoff, type,
      subclients: type === 'agency' ? subclients : (c.subclients || []),
    };
    this.mutLocal(dd => {
      const cl = dd.clients.find(x => x.id === id); if (!cl) return;
      cl.name = name; cl.contactPerson = contact; cl.email = email;
      cl.phone = phone; cl.vat = vat; cl.rate = rate;
      cl.status = status; cl.crm = crm; cl.crmOn = crm !== 'none'; cl.kickoff = kickoff;
      cl.type = type; if (type === 'agency') cl.subclients = subclients;
    });
    this.setForm('editing', false);
    const ok = await API.updateClient(id, updates);
    if (ok !== null) this.toast('Saved ✓', 'Client updated', 'var(--up)');
    else this.toast('Fout', 'Opslaan mislukt — check console', 'var(--down)');
  }

  async saveTimelineData(clientId, agentStartDate, linkedAgentId, linkedRecruitId, agentStatus, kickoff, subclients) {
    const updates = { agent_start_date: agentStartDate || null, linked_agent_id: linkedAgentId || null, linked_recruit_id: linkedRecruitId || null, agent_vacancy: agentStatus || 'needed', ...(kickoff !== undefined ? { kickoff: kickoff || null } : {}), ...(kickoff === '' ? { timeline_stage: null } : {}), ...(subclients ? { subclients } : {}) };
    this.mutLocal(d => {
      const c = d.clients.find(x => x.id === clientId); if (!c) return;
      c.agentStartDate = agentStartDate; c.linkedAgentId = linkedAgentId; c.linkedRecruitId = linkedRecruitId; c.agentVacancy = agentStatus;
      if (kickoff !== undefined) c.kickoff = kickoff || null;
      if (subclients) c.subclients = subclients;
    });
    await API.updateClient(clientId, updates);
    this.toast('Saved', 'Timeline updated', 'var(--up)');
  }

  async createSubclientAccount(clientId, subclientId, email, name) {
    const KEY = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc4MjQ1NDUxOCwgImV4cCI6IDE5NDAxMzQ1MTh9.d7t6XFTyksADGN-ZaER4bNhc85TSn0g12FRsLGEbaU0';
    // Create Supabase auth user
    const res = await fetch('https://database.infinite-scale.be/auth/v1/admin/users', {
      method: 'POST',
      headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'InfiniteScale2026!', email_confirm: true }),
    });
    const user = await res.json();
    if (!user.id) throw new Error(user.msg || user.error_description || 'Failed to create user');
    const uid = user.id;
    // Create profile row with role=subclient
    await fetch('https://database.infinite-scale.be/rest/v1/profiles', {
      method: 'POST',
      headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ id: uid, name, email, role: 'subclient' }),
    });
    // Store user_id + email in the subclient JSON
    const cl = this.state.data.clients.find(c => c.id === clientId);
    const newSubs = (cl.subclients || []).map(sc => sc.id === subclientId ? { ...sc, email, user_id: uid } : sc);
    await API.updateClient(clientId, { subclients: newSubs });
    this.mutLocal(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.subclients = newSubs; });
    this.toast('Account created', name + ' can now log in', 'var(--up)');
  }

  async deleteSubclientAccount(clientId, subclientId) {
    const KEY = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc4MjQ1NDUxOCwgImV4cCI6IDE5NDAxMzQ1MTh9.d7t6XFTyksADGN-ZaER4bNhc85TSn0g12FRsLGEbaU0';
    const cl = this.state.data.clients.find(c => c.id === clientId);
    const sc = (cl.subclients || []).find(x => x.id === subclientId);
    if (!sc || !sc.user_id) return;
    // Delete auth user
    await fetch('https://database.infinite-scale.be/auth/v1/admin/users/' + sc.user_id, {
      method: 'DELETE',
      headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY },
    });
    // Delete profile
    await fetch('https://database.infinite-scale.be/rest/v1/profiles?id=eq.' + sc.user_id, {
      method: 'DELETE',
      headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY },
    });
    // Remove user_id + email from subclient JSON
    const newSubs = (cl.subclients || []).map(x => x.id === subclientId ? { ...x, email: undefined, user_id: undefined } : x);
    await API.updateClient(clientId, { subclients: newSubs });
    this.mutLocal(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.subclients = newSubs; });
    this.toast('Account removed', sc.name + ' can no longer log in', 'var(--text-mute)');
  }

  async saveAgentEdits() {
    const f = this.state.form;
    const id = f.id;
    const updates = {};
    if (f.editName !== undefined) updates.name = f.editName;
    if (f.editEmail !== undefined) updates.email = f.editEmail;
    if (f.editPhone !== undefined) updates.phone = f.editPhone;
    if (f.editStage !== undefined) updates.status = f.editStage;
    this.mutLocal(d => {
      const a = d.agents.find(x => x.id === id); if (!a) return;
      if (updates.name) a.name = updates.name;
      if (updates.email !== undefined) a.email = updates.email;
      if (updates.phone !== undefined) a.phone = updates.phone;
      if (updates.status !== undefined) a.status = updates.status;
    });
    await API.updateAgent(id, updates);
    this.setForm('editing', false);
    this.toast('Saved', 'Agent updated', 'var(--up)');
  }

  async addAgentFeedback(agentId, text) {
    if (!text.trim()) return;
    const agent = this.state.data.agents.find(a => a.id === agentId);
    if (!agent) return;
    const feedback = [...(agent.feedback || []), text.trim()];
    this.mutLocal(d => { const a = d.agents.find(x => x.id === agentId); if (a) a.feedback = feedback; });
    await API.addFeedback(agentId, feedback);
    this.setForm('feedbackInput', '');
    this.toast('Saved', 'Feedback added', 'var(--up)');
  }

  async removeAgentFeedback(agentId, idx) {
    const agent = this.state.data.agents.find(a => a.id === agentId);
    if (!agent) return;
    const feedback = (agent.feedback || []).filter((_, i) => i !== idx);
    this.mutLocal(d => { const a = d.agents.find(x => x.id === agentId); if (a) a.feedback = feedback; });
    await API.addFeedback(agentId, feedback);
  }

  async toggleAgentClient(agentId, clientId, rate) {
    const agent = this.state.data.agents.find(a => a.id === agentId);
    if (!agent) return;
    const hasClient = (agent.clients || []).includes(clientId);
    if (hasClient) {
      this.mutLocal(d => { const a = d.agents.find(x => x.id === agentId); if (a) { a.clients = a.clients.filter(c => c !== clientId); delete (a.rates || {})[clientId]; } });
      await API.removeAgentClient(agentId, clientId);
      this.toast('Updated', 'Client removed from agent', 'var(--down)');
    } else {
      const r = +(rate || 0);
      this.mutLocal(d => { const a = d.agents.find(x => x.id === agentId); if (a) { if (!a.clients) a.clients = []; a.clients.push(clientId); if (!a.rates) a.rates = {}; a.rates[clientId] = r; } });
      await API.setAgentClient(agentId, clientId, r);
      this.toast('Updated', 'Client assigned to agent', 'var(--up)');
    }
  }

  async updateAgentRate(agentId, clientId, rate) {
    const r = +(rate || 0);
    this.mutLocal(d => { const a = d.agents.find(x => x.id === agentId); if (a) { if (!a.rates) a.rates = {}; a.rates[clientId] = r; } });
    await API.setAgentClient(agentId, clientId, r);
    this.toast('Saved', 'Rate updated', 'var(--up)');
  }

  async addEvent(title, tag, date) {
    if (!title || !date) { this.toast('Error', 'Add title and date', 'var(--down)'); return; }
    const ev = { id: 'ev' + Date.now(), title, tag: tag || 'Update', date };
    this.mutLocal(d => d.events.push(ev));
    await API.addEvent({ title, tag: tag || 'Update', event_date: date });
    this.setForm('evTitle', ''); this.setForm('evDate', ''); this.setForm('evTag', '');
    this.toast('Added', 'Event created', 'var(--accent)');
  }

  async deleteEvent(id) {
    this.mutLocal(d => { d.events = d.events.filter(e => e.id !== id); });
    await API.deleteEvent(id);
    this.toast('Deleted', 'Event removed', 'var(--down)');
  }

  async updateProspectDetail(id, data) {
    this.mutLocal(d => { const p = d.prospects.find(x => x.id === id); if (p) Object.assign(p, data); });
    await API.updateProspect(id, data);
  }

  async saveSettings() {
    const f = this.state.form;
    const s = this.state;
    const d = s.data;
    if (f.newPassword && f.newPassword !== f.confirmPassword) { this.toast('Error', 'Passwords do not match', 'var(--down)'); return; }
    if (f.newPassword && f.newPassword.length < 8) { this.toast('Error', 'Password must be at least 8 characters', 'var(--down)'); return; }
    if (f.newPassword) { const r = await API.changePassword(f.newPassword); if (!r) { this.toast('Error', 'Password update failed', 'var(--down)'); return; } }
    const me = d.agents.find(a => a.id === this.myAgentId);
    const cl = d.clients.find(c => c.id === this.myClientId);
    if (me && (f.settingName || f.settingPhone)) {
      const upd = {}; if (f.settingName) upd.name = f.settingName; if (f.settingPhone) upd.phone = f.settingPhone;
      this.mutLocal(dd => { const a = dd.agents.find(x => x.id === this.myAgentId); if (a) Object.assign(a, upd); });
      await API.updateAgent(this.myAgentId, upd);
    }
    if (cl && (f.settingName || f.settingContact || f.settingEmail)) {
      const upd = {}; if (f.settingName) upd.name = f.settingName; if (f.settingContact) upd.contact_person = f.settingContact; if (f.settingEmail) upd.email = f.settingEmail;
      this.mutLocal(dd => { const c = dd.clients.find(x => x.id === this.myClientId); if (c) { if (upd.name) c.name = upd.name; if (upd.contact_person) c.contactPerson = upd.contact_person; if (upd.email) c.email = upd.email; } });
      await API.updateClient(this.myClientId, upd);
    }
    this.setState({ form: {} });
    this.toast('Saved', 'Settings updated', 'var(--up)');
  }

  // ---- Tour ----
  tourData() {
    const map = {
      agent: [{ t: 'Welcome, ' + (this.state.data.agents.find(a => a.id === this.myAgentId) || {}).name?.split(' ')[0] || 'agent', b: 'This is your command center. Your most recent appointments sit up top, with live daily stats and your to-do list beside them.' }, { t: 'Flip the work switch', b: 'Use the green switch in the top bar when you start dialing. It logs your working time for the team.' }, { t: 'Log appointments fast', b: 'The floating button opens the form. Submit and it locks — instantly reflected in your stats and payments.' }, { t: 'Track your money', b: 'The Payments tab shows a live running total and your monthly approval of invoicing. You\'re all set.' }],
      client: [{ t: 'Welcome to Infinite Scale', b: 'Every appointment your agents book lands here in real time — no more spreadsheets.' }, { t: 'Set the status', b: 'On each appointment choose Show, No-show or Cancel. This drives your monthly billing automatically.' }, { t: 'Billing made simple', b: 'Five days before month-end you get a reminder. When the month closes, your billing summary appears in the Billing tab.' }],
      agency: [{ t: 'Welcome to your agency workspace', b: 'Your lead-agency dashboard shows every appointment across all of your clients in one login.' }, { t: 'Switch between clients', b: 'Use the selector in the top bar to view appointments and stats broken down per client.' }, { t: 'One billing relationship', b: 'You invoice as the agency — statuses you set across all clients roll into a single monthly summary.' }],
    };
    return map[this.state.role] || [];
  }

  // ---- Main render ----
  renderVals() {
    const s = this.state, d = s.data, R = React.createElement;

    // Loading screen
    if (s.loading) {
      return {
        loggedOut: false, loggedIn: false,
        screen: R('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' } },
          R('div', { style: { textAlign: 'center' } },
            R('div', { style: { width: 40, height: 40, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%', animation: 'isp-spin 1s linear infinite', margin: '0 auto 16px' } }),
            R('div', { style: { color: 'var(--text-mute)', fontSize: 14 } }, 'Loading…'))),
        modal: false, tourActive: false, toasts: [],
      };
    }

    const out = {
      loggedOut: !s.role, loggedIn: !!s.role,
      stop: e => e.stopPropagation(),
      onLogout: () => this._doLogout(),
      onCloseModal: () => this.closeModal(),
      onToggleSidebar: () => this.setState(x => ({ sidebarOpen: !x.sidebarOpen })),
      onToggleNotif: () => this.setState(x => ({ notifOpen: !x.notifOpen })),
      onMarkAllRead: () => this.markAllRead(),
      sidebarOpen: s.sidebarOpen, notifOpen: s.notifOpen, modal: s.modal,
      routeKey: (s.role || '') + '/' + s.route, sidebarCls: s.sidebarOpen ? 'isp-open' : '',
      showFab: s.role === 'agent' && s.route !== 'log', onFabLog: () => this.openModal('log'),
    };

    // Login
    out.loginError = s.loginError;
    out.loginEmail = s.loginEmail;
    out.loginPassword = s.loginPassword;
    out.onLoginEmailChange = e => this.setState({ loginEmail: e.target.value });
    out.onLoginPasswordChange = e => this.setState({ loginPassword: e.target.value });
    out.onLoginSubmit = e => { e.preventDefault(); this._doLogin(s.loginEmail, s.loginPassword); };

    if (!s.role) { return out; }

    // Me
    const roleLabels = { admin: 'Admin workspace', agency: 'Lead agency', client: 'Client portal', agent: 'Call agent' };
    out.roleLabel = roleLabels[s.role];
    const me = d.agents.find(a => a.id === this.myAgentId);
    const cl = d.clients.find(c => c.id === this.myClientId);
    const session = SB.getSession();
    const profileName = me?.name || cl?.contactPerson || session?.user?.email?.split('@')[0] || 'User';
    const scCl = d.clients.find(c => c.id === this.scClientId);
    const scSub = scCl && (scCl.subclients || []).find(x => x.id === this.scSubId);
    const meMap = { admin: { name: 'Quinten Eeckhoudt', sub: 'Admin', tint: 'oklch(0.30 0.06 295)', ink: 'var(--violet)' }, agency: { name: cl?.name || 'Agency', sub: 'Lead agency', tint: 'oklch(0.30 0.06 240)', ink: 'var(--info)' }, client: { name: cl?.name || 'Client', sub: 'Client', tint: 'oklch(0.30 0.11 194)', ink: 'var(--accent)' }, agent: { name: me?.name || 'Agent', sub: 'Call agent', tint: 'oklch(0.30 0.05 85)', ink: 'var(--warn)' }, subclient: { name: scSub?.name || scCl?.name || 'Subclient', sub: scCl?.name || 'Subclient', tint: 'oklch(0.30 0.06 160)', ink: 'var(--up)' } };
    const meInfo = meMap[s.role];
    out.meName = meInfo.name; out.meSub = meInfo.sub; out.initials = this.initialsOf(meInfo.name); out.avatarTint = meInfo.tint; out.avatarInk = meInfo.ink;

    // Nav
    const navDefs = {
      agent: [['dashboard', 'Dashboard', 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z'], ['log', 'Appointment Log', 'M5 3h14v18H5zM9 9h6M9 13h6M9 17h4'], ['appointments', 'Appointments', 'M4 6h16M4 12h16M4 18h16'], ['eod', 'End of Day', 'M8 4h8M7 4h10v17H7zM10 10h4M10 14h4'], ['payments', 'Payments', 'M3 6h18v12H3zM3 10h18M7 15h3'], ['clients', 'My Clients', 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20a6 6 0 0 1 12 0M17 11a3 3 0 0 0 0-6M21 20a6 6 0 0 0-4-5.6'], ['rooster', 'Rooster', 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 16l2 2 4-4'], ['stats', 'Statistics', 'M4 20V10M10 20V4M16 20v-7M22 20H2'], ['settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12 2v3M12 19v3M2 12h3M19 12h3']],
      client: [['dashboard', 'Dashboard', 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z'], ['appointments', 'Appointments', 'M4 6h16M4 12h16M4 18h16'], ['billing', 'Billing', 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'], ['legal', 'Legal', 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z'], ['support', 'Support', 'M4 5h16v11H9l-4 4z'], ['settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12 2v3M12 19v3M2 12h3M19 12h3']],
      agency: [['dashboard', 'Dashboard', 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z'], ['appointments', 'Appointments', 'M4 6h16M4 12h16M4 18h16'], ['billing', 'Billing', 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'], ['legal', 'Legal', 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z'], ['support', 'Support', 'M4 5h16v11H9l-4 4z'], ['settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12 2v3M12 19v3M2 12h3M19 12h3']],
      admin: [['dashboard', 'Dashboard', 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z'], ['finances', 'Finances', 'M3 7h18v12H3zM3 11h18M7 15h4'], ['stats', 'Statistics', 'M4 20V10M10 20V4M16 20v-7M22 20H2'], ['apptadmin', 'Appointments', 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'], ['clients', 'Clients', 'M3 9l9-6 9 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 21V12h6v9'], ['agents', 'Call Agents', 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20a6 6 0 0 1 12 0M17 11a3 3 0 0 0 0-6M21 20a6 6 0 0 0-4-5.6'], ['rooster', 'Roosters', 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 16l2 2 4-4'], ['eodadmin', 'EOD Reports', 'M8 4h8M7 4h10v17H7zM10 10h4M10 14h4'], ['timeline', 'Project Timeline', 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4'], ['prospects', 'Prospect CRM', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10'], ['recruitment', 'Recruitment', 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20a6 6 0 0 1 12 0M18 8v6M15 11h6'], ['contracts', 'Contracts', 'M7 3h10v18H7zM10 8h4M10 12h4M10 16h2'], ['todos', 'To-Do', 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'], ['activity', 'Activity', 'M22 12h-4l-3 9L9 3l-3 9H2'], ['settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12 2v3M12 19v3M2 12h3M19 12h3']],
    };
    const badges = { admin: { recruitment: String(d.recruits.filter(r => r.stage === 'new').length || ''), eodadmin: '' }, agent: {} };
    out.nav = (navDefs[s.role] || []).map(([key, label, icon]) => {
      const active = s.route === key;
      return { label, icon, badge: (badges[s.role] && badges[s.role][key]) || '', onClick: () => this.go(key), style: 'display:flex; align-items:center; gap:11px; padding:9px 12px; border-radius:10px; border:none; cursor:pointer; font-size:13.5px; font-weight:600; transition:all .12s; ' + (active ? 'background:var(--surface-2); color:var(--text); box-shadow:inset 0 0 0 1px var(--border);' : 'background:transparent; color:var(--text-mute);') };
    });

    // Notifications
    const myNotifs = d.notifs[s.role] || [];
    out.hasUnread = myNotifs.some(n => !n.read);
    const ndot = { appt: 'var(--accent)', pay: 'var(--warn)', todo: 'var(--info)', remind: 'var(--warn)', bill: 'var(--accent)', eod: 'var(--info)', recruit: 'var(--violet)', ticket: 'var(--down)', contract: 'var(--accent)' };
    out.notifications = myNotifs.map(n => ({ text: n.text, time: n.time, dot: ndot[n.kind] || 'var(--accent)', style: 'display:flex; gap:10px; padding:12px 14px; border-bottom:1px solid var(--border-soft); ' + (n.read ? 'opacity:.6;' : 'background:oklch(0.215 0.014 256 / .5);') }));

    out.toasts = s.toasts;

    // Working switch
    out.showWorkingSwitch = s.role === 'agent';
    if (s.role === 'agent' && me) {
      out.workingLabel = me.working ? 'Working' : 'Offline';
      out.workingDot = me.working ? 'var(--up)' : 'var(--text-mute)';
      out.workingDotRing = me.working ? 'oklch(0.84 0.16 194 / .25)' : 'transparent';
      out.workingDotAnim = me.working ? 'animation:isp-pulse 2s infinite;' : '';
      out.workingTime = me.working && me.workSince ? ('since ' + (me.workSince || '').slice(11, 16)) : '';
      out.workingBtnStyle = 'display:flex; align-items:center; gap:9px; padding:8px 14px; border-radius:11px; cursor:pointer; border:1px solid ' + (me.working ? 'oklch(0.84 0.16 194 / .4)' : 'var(--border)') + '; background:' + (me.working ? 'oklch(0.30 0.10 194 / .4)' : 'var(--surface)') + '; color:var(--text);';
      out.onToggleWorking = () => this.toggleWorking();
    }

    // Agency switch
    out.showAgencySwitch = s.role === 'agency';
    if (s.role === 'agency' && cl) {
      out.agencyClients = [{ value: 'all', label: 'All clients' }, ...(cl.subclients || []).map(sc => ({ value: sc.id, label: sc.name }))];
      out.agencyView = s.agencyView;
      out.onAgencyClientChange = e => this.setState({ agencyView: e.target.value });
    }

    // Page title
    const titles = { dashboard: 'Dashboard', log: 'Appointment Log', appointments: 'Appointments', apptadmin: 'Appointments', eod: 'End of Day Report', payments: 'Payments', clients: s.role === 'admin' ? 'Clients' : 'My Clients', stats: 'Statistics', settings: 'Settings', billing: 'Billing', legal: 'Legal & Contracts', support: 'Support', finances: 'Finances', agents: 'Call Agents', eodadmin: 'End of Day Reports', timeline: 'Project Timeline', prospects: 'Prospect CRM', recruitment: 'Recruitment', contracts: 'Contracts', todos: 'To-Do' };
    out.pageTitle = titles[s.route] || 'Dashboard';
    const subMap = { dashboard: { agent: 'Welcome back', client: 'Live appointment overview', agency: 'All clients, one view', admin: 'Everything, in real time' } };
    out.pageSub = (subMap[s.route] && subMap[s.route][s.role]) || roleLabels[s.role];

    // Tour — rendered as a React element so it never exists in the DOM unless active
    const tour = this.tourData();
    const tourActive = s.tourStep != null && tour.length > 0 && s.tourStep < tour.length;
    if (tourActive) {
      const step = tour[s.tourStep];
      const isLast = s.tourStep === tour.length - 1;
      const onNext = () => this.setState(x => {
        const done = x.tourStep + 1 >= tour.length;
        if (done) this._markTourSeen(session?.user?.id);
        return { tourStep: done ? null : x.tourStep + 1 };
      });
      const onSkip = () => { this._markTourSeen(session?.user?.id); this.setState({ tourStep: null }); };
      out.tourOverlay = R('div', { style: { position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.66)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 } },
        R('div', { style: { width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, boxShadow: 'var(--shadow)', padding: 26 } },
          R('div', { style: { fontFamily: "'JetBrains Mono'", fontSize: 11.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12 } }, 'Quick tour · ' + (s.tourStep + 1) + ' of ' + tour.length),
          R('h3', { style: { fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 21, margin: '0 0 10px' } }, step.t),
          R('p', { style: { fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-dim)', margin: '0 0 22px' } }, step.b),
          R('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            R('button', { onClick: onSkip, style: { background: 'none', border: 'none', color: 'var(--text-mute)', fontSize: 13, fontWeight: 600, cursor: 'pointer' } }, 'Skip tour'),
            R('button', { onClick: onNext, style: { padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' } }, isLast ? 'Get started' : 'Next')
          )
        )
      );
    } else {
      out.tourOverlay = null;
    }

    // Screen render
    try { out.screen = this.renderScreen(R, d, s); } catch (err) { out.screen = R('div', { style: { color: 'var(--down)', padding: 20 } }, 'Render error: ' + err.message + ' — ' + err.stack?.split('\n')[0]); }

    const mod = this.renderModalBody(R, d, s);
    out.modalBody = mod ? mod.body : null;
    out.modalWidth = mod ? mod.width : '520px';

    return out;
  }

  renderScreen(R, d, s) {
    if (s.role === 'agent') return ScreenAgent.scrAgent.call(this, d, s);
    if (s.role === 'client' || s.role === 'agency') return ScreenClient.scrClient.call(this, d, s);
    if (s.role === 'subclient') return ScreenSubclient.scrSubclient.call(this, d, s);
    if (s.role === 'admin') return ScreenAdmin.scrAdmin.call(this, d, s);
    return R('div', null, '');
  }

  renderModalBody(R, d, s) { return Modals.renderModalBody.call(this, R, d, s); }

  // Inject signature block into stored contract HTML for admin preview / PDF
  _signedContractHtml(c) {
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

  // Delegate mixin methods
  euro(n) { return Helpers.euro.call(this, n); }
  pad(n) { return Helpers.pad.call(this, n); }
  iso(d) { return Helpers.iso.call(this, d); }
  today() { return Helpers.today.call(this); }
  daysAgo(n) { return Helpers.daysAgo.call(this, n); }
  fmtDate(s) { return Helpers.fmtDate.call(this, s); }
  fmtFull(s) { return Helpers.fmtFull.call(this, s); }
  initialsOf(n) { return Helpers.initialsOf.call(this, n); }
  toast(tag, text, color) { return Helpers.toast.call(this, tag, text, color); }
  clientName(id, d) { return Helpers.clientName.call(this, id, d); }
  agentName(id, d) { return Helpers.agentName.call(this, id, d); }
  _kv(k, v) { return Helpers._kv.call(this, k, v); }
  C(...a) { return UI.C(...a); }
  Row(...a) { return UI.Row(...a); }
  Col(...a) { return UI.Col(...a); }
  Grid(...a) { return UI.Grid(...a); }
  Hd(...a) { return UI.Hd(...a); }
  Sub(...a) { return UI.Sub(...a); }
  Mono(...a) { return UI.Mono(...a); }
  Pill(...a) { return UI.Pill(...a); }
  statusPill(st) { return UI.statusPill(st); }
  Btn(...a) { return UI.Btn(...a); }
  Field(...a) { return UI.Field(...a); }
  Input(...a) { return UI.Input(...a); }
  Select(...a) { return UI.Select(...a); }
  Area(...a) { return UI.Area(...a); }
  Stat(...a) { return UI.Stat(...a); }
  Donut(...a) { return UI.Donut(...a); }
  Bars(...a) { return UI.Bars(...a); }
  Line(...a) { return UI.Line(...a); }
  LineDual(...a) { return UI.LineDual(...a); }
  Table(...a) { return UI.Table(...a); }
  SectionHd(...a) { return UI.SectionHd(...a); }
  Seg(...a) { return UI.Seg(...a); }
  _settings(...a) { return ScreenShared._settings.call(this, ...a); }
  _apptToolbar(...a) { return ScreenShared._apptToolbar.call(this, ...a); }
  _filterAppts(...a) { return ScreenShared._filterAppts.call(this, ...a); }
  _finCard(...a) { return ScreenAdmin._finCard.call(this, ...a); }
  _fin(d) { return ScreenAdmin._fin.call(this, d); }
  _agentDash(...a) { return ScreenAgent._agentDash.call(this, ...a); }
  _agentLog(...a) { return ScreenAgent._agentLog.call(this, ...a); }
  _agentAppointments(...a) { return ScreenAgent._agentAppointments.call(this, ...a); }
  _agentEod(...a) { return ScreenAgent._agentEod.call(this, ...a); }
  _agentPayments(...a) { return ScreenAgent._agentPayments.call(this, ...a); }
  _agentClients(...a) { return ScreenAgent._agentClients.call(this, ...a); }
  _agentStats(...a) { return ScreenAgent._agentStats.call(this, ...a); }
  _admDash(...a) { return ScreenAdmin._admDash.call(this, ...a); }
  _admFin(...a) { return ScreenAdmin._admFin.call(this, ...a); }
  _admStats(...a) { return ScreenAdmin._admStats.call(this, ...a); }
  _admClients(...a) { return ScreenAdmin._admClients.call(this, ...a); }
  _admAgents(...a) { return ScreenAdmin._admAgents.call(this, ...a); }
  _admEod(...a) { return ScreenAdmin._admEod.call(this, ...a); }
  _admTimeline(...a) { return ScreenAdmin._admTimeline.call(this, ...a); }
  _admProspects(...a) { return ScreenAdmin._admProspects.call(this, ...a); }
  _admRecruit(...a) { return ScreenAdmin._admRecruit.call(this, ...a); }
  _admAppointments(...a) { return ScreenAdmin._admAppointments.call(this, ...a); }
  _admContracts(...a) { return ScreenAdmin._admContracts.call(this, ...a); }
  _agentRooster(...a) { return ScreenAgent._agentRooster.call(this, ...a); }
  _admRooster(...a) { return ScreenAdmin._admRooster.call(this, ...a); }
  _admActivity(...a) { return ScreenAdmin._admActivity.call(this, ...a); }
  _weekStart(dateStr) {
    const d = new Date((dateStr || new Date().toISOString().slice(0,10)) + 'T12:00:00');
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  }
  _scrSubclient(...a) { return ScreenSubclient.scrSubclient.call(this, ...a); }
  _clientDash(...a) { return ScreenClient._clientDash.call(this, ...a); }
  _clientAppointments(...a) { return ScreenClient._clientAppointments.call(this, ...a); }
  _clientBilling(...a) { return ScreenClient._clientBilling.call(this, ...a); }
  _clientLegal(...a) { return ScreenClient._clientLegal.call(this, ...a); }
  _clientSupport(...a) { return ScreenClient._clientSupport.call(this, ...a); }
  _adminModals(...a) { return Modals._adminModals.call(this, ...a); }
}
