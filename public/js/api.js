// Data access layer — all Supabase calls go through here
const API = {

  async loadAll(role, agentId, clientId, subClientId) {
    const [agents, clients, acRows, appointments, dials, dialsHourlyRows, eods, tickets,
      recruits, prospects, contracts, events, notifications, schedules, activityLog, platformSettings, presenceRows, invoiceStateRows] = await Promise.all([
      SB.get('agents', '?order=name'),
      SB.get('clients', '?order=name'),
      SB.get('agent_clients'),
      role === 'agent'
        ? SB.get('appointments', '?select=id,agent_id,client_id,sub_client_id,lead_name,phone,date_logged,created_at,date_appt,client_feedback,status,invoiced,paid,agent_rate,deal_commission,deal_amount&order=date_logged.desc')
        : role === 'subclient'
        ? SB.get('appointments', `?select=id,agent_id,client_id,sub_client_id,lead_name,phone,date_logged,created_at,date_appt,client_feedback,status,amount,invoiced,paid,agent_rate,deal_commission,deal_amount&client_id=eq.${clientId}&sub_client_id=eq.${subClientId}&order=date_logged.desc`)
        : role === 'client'
        ? SB.get('appointments', `?select=id,agent_id,client_id,sub_client_id,lead_name,phone,date_logged,created_at,date_appt,client_feedback,status,amount,invoiced,paid,agent_rate,deal_commission,deal_amount&client_id=eq.${clientId}&order=date_logged.desc`)
        : role === 'agency'
        ? SB.get('appointments', `?select=id,agent_id,client_id,sub_client_id,lead_name,phone,date_logged,created_at,date_appt,client_feedback,status,amount,invoiced,paid,agent_rate,deal_commission,deal_amount&client_id=eq.${clientId}&order=date_logged.desc`)
        : SB.get('appointments', '?select=id,agent_id,client_id,sub_client_id,lead_name,phone,date_logged,created_at,date_appt,client_feedback,status,amount,invoiced,paid,agent_rate,deal_commission,deal_amount&order=date_logged.desc'),
      SB.get('dials', '?select=agent_id,dial_date,count&order=dial_date.desc'),
      role === 'admin' ? SB.get('dials_hourly', '?select=agent_id,dial_date,hour,count&order=dial_date.desc,hour.asc').catch(() => []) : Promise.resolve([]),
      role === 'agent'
        ? SB.get('eod_reports', `?agent_id=eq.${agentId}&order=report_date.desc`)
        : SB.get('eod_reports', '?order=report_date.desc'),
      role === 'admin' ? SB.get('tickets', '?order=submitted_at.desc') :
        clientId ? SB.get('tickets', `?client_id=eq.${clientId}&order=submitted_at.desc`) : [],
      role === 'admin' ? SB.get('recruits', '?order=created_at.desc') : [],
      role === 'admin' ? SB.get('prospects', '?order=created_at.desc') : [],
      SB.get('contracts', '?order=sent.desc'),
      SB.get('events', '?order=event_date'),
      SB.get('notifications', `?target_role=eq.${role}&order=created_at.desc`),
      role === 'agent'
        ? SB.get('agent_schedules', `?agent_id=eq.${agentId}&order=week_start.desc`).catch(() => [])
        : SB.get('agent_schedules', '?order=week_start.desc').catch(() => []),
      role === 'admin' ? SB.get('activity_log', '?order=created_at.desc&limit=500').catch(() => []) : Promise.resolve([]),
      SB.get('platform_settings', '').catch(() => []),
      role === 'admin' ? SB.get('presence', '').catch(() => []) : Promise.resolve([]),
      role === 'agent'
        ? SB.get('invoice_states', `?agent_id=eq.${agentId}`).catch(() => [])
        : SB.get('invoice_states', '').catch(() => []),
    ]);

    // Build dials map: { agentId: { date: count } }
    const dialsMap = {};
    for (const row of (dials || [])) {
      if (!dialsMap[row.agent_id]) dialsMap[row.agent_id] = {};
      dialsMap[row.agent_id][row.dial_date] = row.count;
    }

    // Build hourly dials map: { agentId: { date: { hour: count } } }
    const dialsHourlyMap = {};
    for (const row of (dialsHourlyRows || [])) {
      if (!dialsHourlyMap[row.agent_id]) dialsHourlyMap[row.agent_id] = {};
      if (!dialsHourlyMap[row.agent_id][row.dial_date]) dialsHourlyMap[row.agent_id][row.dial_date] = {};
      dialsHourlyMap[row.agent_id][row.dial_date][row.hour] = row.count;
    }

    // Build agent.clients and agent.rates from junction table
    const agentsWithClients = (agents || []).map(a => {
      const myRows = (acRows || []).filter(r => r.agent_id === a.id);
      return {
        ...a,
        clients: myRows.map(r => r.client_id),
        rates: Object.fromEntries(myRows.map(r => [r.client_id, r.rate])),
        feedback: a.feedback || [],
        todos: a.todos || [],
        working: a.working || false,
        workSince: a.work_since || null,
        lifetime: a.lifetime_paid || 0,
      };
    });

    const clientsNorm = (clients || []).map(c => {
      const norm = {
        ...c,
        subclients: c.subclients || [],
        crmOn: c.crm_on,
        contactPerson: c.contact_person,
        billStatus: c.bill_status,
        kickoff: c.kickoff,
        phone: c.phone || '',
        vat: c.vat || '',
        agentStartDate: c.agent_start_date || '',
        linkedAgentId: c.linked_agent_id || '',
        linkedRecruitId: c.linked_recruit_id || '',
        agentVacancy: c.agent_vacancy || 'needed',
        timelineStage: c.timeline_stage || null,
      };
      if (role === 'agent') {
        delete norm.rate;
        delete norm.billing_history;
        norm.subclients = norm.subclients.map(sc => { const s = { ...sc }; delete s.rate; return s; });
      }
      return norm;
    });

    const aptsNorm = (appointments || []).map(a => ({
      id: a.id,
      agent: a.agent_id,
      client: a.client_id,
      sub: a.sub_client_id || '',
      lead: a.lead_name,
      phone: a.phone || '',
      dateLog: a.date_logged,
      loggedAt: a.created_at || '',
      dateAppt: a.date_appt,
      clientFeedback: a.client_feedback || '',
      status: a.status,
      amount: a.amount != null ? a.amount : null,
      invoiced: a.invoiced || false,
      paid: a.paid || false,
      agentRate: a.agent_rate != null ? a.agent_rate : null,
      dealCommission: a.deal_commission != null ? a.deal_commission : null,
      dealAmount: a.deal_amount != null ? a.deal_amount : null,
    }));

    const eodsNorm = (eods || []).map(r => ({
      id: r.id,
      agent: r.agent_id,
      date: r.report_date,
      clients: r.clients_called || [],
      calls: r.calls || {},
      appts: r.appts || {},
      well: r.went_well || '',
      bad: r.went_bad || '',
      goal: r.tomorrow_goal || '',
      callBlocks: r.call_blocks || [],
    }));

    const ticketsNorm = (tickets || []).map(t => ({
      id: t.id,
      time: (t.submitted_at || '').slice(0, 16).replace('T', ' '),
      title: t.title,
      cat: t.category,
      client: t.client_id,
      desc: t.description || '',
      status: t.status,
    }));

    const recruitsNorm = (recruits || []).map(r => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone,
      gender: r.gender, country: r.country, lang: r.language, vat: r.vat || '',
      avail: r.availability || [], start: r.can_start, position: r.position,
      motivation: r.motivation, source: r.source, experience: r.experience,
      age: r.age, stage: r.stage,
    }));

    const eventsNorm = (events || []).map(e => ({
      id: e.id, title: e.title, date: e.event_date, tag: e.tag,
    }));

    const kindAction = k => ({ appt: { route: 'apptadmin' }, pay: { route: 'payments' }, todo: { route: 'dashboard' }, bill: { route: 'finances' }, eod: { route: 'eodadmin' }, recruit: { route: 'recruitment' }, ticket: { route: 'support' }, contract: { route: 'contracts' } }[k] || null);
    const notifsNorm = (notifications || []).map(n => {
      let action = null;
      if (n.meta) { try { action = typeof n.meta === 'string' ? JSON.parse(n.meta) : n.meta; } catch(e) {} }
      if (!action) action = kindAction(n.kind);
      return { id: n.id, text: n.text, time: n.time, read: n.read, kind: n.kind, action };
    });

    const invoiceStatesMap = {};
    for (const is of (invoiceStateRows || [])) {
      invoiceStatesMap[is.id] = {
        approved: is.approved || false,
        invSent: is.inv_sent || false,
        invNumber: is.inv_number || '',
        payStatus: is.pay_status || 'open',
        bonus: is.bonus || null,
      };
    }

    return {
      agents: agentsWithClients,
      clients: clientsNorm,
      appointments: aptsNorm,
      dials: dialsMap,
      dialsHourly: dialsHourlyMap,
      tickets: ticketsNorm,
      recruits: recruitsNorm,
      prospects: prospects || [],
      contracts: contracts || [],
      events: eventsNorm,
      notifs: { [role]: notifsNorm },
      eods: eodsNorm,
      schedules: (schedules || []).map(s => ({ ...s, slots: s.slots || [] })),
      activityLog: activityLog || [],
      leaderPeriod: 'daily',
      settings: Object.fromEntries((platformSettings || []).map(r => [r.key, r.value])),
      presence: presenceRows || [],
      invoiceStates: invoiceStatesMap,
    };
  },

  logActivity(userName, userRole, action, details, sessionId, extra) {
    const session = SB.getSession();
    const body = {
      id: 'al' + Date.now() + Math.random().toString(36).slice(2, 5),
      user_id: session?.user?.id || '',
      user_name: userName || '',
      user_role: userRole || '',
      action,
      details: details || null,
      session_id: sessionId || null,
      extra: extra || null,
    };
    fetch(window.SUPABASE_URL + '/rest/v1/activity_log', {
      method: 'POST',
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  },

  updatePresence(userId, userName, userRole, route, detail) {
    if (!userId) return;
    const body = { user_id: userId, user_name: userName || '', user_role: userRole || '', route: route || '', detail: detail || null, last_seen: new Date().toISOString() };
    fetch(window.SUPABASE_URL + '/rest/v1/presence', {
      method: 'POST',
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  },

  clearPresence(userId) {
    if (!userId) return;
    fetch(window.SUPABASE_URL + '/rest/v1/presence?user_id=eq.' + encodeURIComponent(userId), {
      method: 'DELETE',
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY },
    }).catch(() => {});
  },

  async saveSchedule(agentId, weekStart, slots) {
    return SB.upsert('agent_schedules', 'agent_id,week_start', {
      id: 'sch_' + agentId + '_' + weekStart,
      agent_id: agentId,
      week_start: weekStart,
      slots,
    });
  },

  async logAppointment(agentId, clientId, subClientId, leadName, phone, dateAppt, dateLogged, amount, clientFeedback = null) {
    return SB.post('appointments', {
      id: 'ap' + Date.now(),
      agent_id: agentId,
      client_id: clientId,
      sub_client_id: subClientId || null,
      lead_name: leadName,
      phone: phone || '',
      date_logged: dateLogged,
      date_appt: dateAppt,
      status: 'open',
      amount: amount,
      invoiced: false,
      paid: false,
      ...(clientFeedback ? { client_feedback: clientFeedback } : {}),
    });
  },

  async setApptStatus(id, status, amount) {
    return SB.patch('appointments', `?id=eq.${id}`, { status, amount });
  },
  async saveApptFeedback(id, feedback) {
    return SB.patch('appointments', `?id=eq.${id}`, { client_feedback: feedback });
  },

  async setWorking(agentId, working) {
    const workSince = working ? new Date().toISOString() : null;
    return SB.patch('agents', `?id=eq.${agentId}`, { working, work_since: workSince });
  },

  async saveTodos(agentId, todos) {
    return SB.patch('agents', `?id=eq.${agentId}`, { todos });
  },

  async saveFeedback(agentId, feedback) {
    return SB.patch('agents', `?id=eq.${agentId}`, { feedback });
  },

  async submitEOD(agentId, date, clientsCalled, calls, appts, well, bad, goal, callBlocks) {
    return SB.post('eod_reports', {
      id: 'e' + Date.now(),
      agent_id: agentId,
      report_date: date,
      clients_called: clientsCalled,
      calls, appts,
      went_well: well,
      went_bad: bad,
      tomorrow_goal: goal,
      call_blocks: callBlocks || [],
    });
  },

  async deleteAppointment(id) {
    return SB.del('appointments', '?id=eq.' + id);
  },

  async submitTicket(clientId, title, category, description) {
    return SB.post('tickets', {
      id: 'tk' + Date.now(),
      client_id: clientId,
      title, category, description,
      status: 'open',
    });
  },

  async markAllNotifsRead(role) {
    return SB.patch('notifications', `?target_role=eq.${role}`, { read: true });
  },

  async pushNotif(targetRole, text, kind, action) {
    try {
      await SB.post('notifications', {
        id: 'n' + Date.now(),
        target_role: targetRole, text, kind: kind || 'info', read: false,
        time: new Date().toISOString().slice(0, 16).replace('T', ' '),
        meta: action ? JSON.stringify(action) : null,
      });
    } catch(e) {}
  },

  async upsertInvoiceState(agentId, ym, fields) {
    const id = agentId + '-' + ym;
    const dbFields = { id, agent_id: agentId, ym, updated_at: new Date().toISOString() };
    if (fields.approved !== undefined) dbFields.approved = fields.approved;
    if (fields.inv_sent !== undefined) dbFields.inv_sent = fields.inv_sent;
    if (fields.inv_number !== undefined) dbFields.inv_number = fields.inv_number;
    if (fields.pay_status !== undefined) dbFields.pay_status = fields.pay_status;
    if (fields.bonus !== undefined) dbFields.bonus = fields.bonus;
    const ok = await SB.upsert('invoice_states', 'id', dbFields);
    if (!ok) throw new Error('Opslaan mislukt — check de console voor details');
    return ok;
  },

  async approveAgentInvoice(agentId) {
    await SB.patch('appointments', `?agent_id=eq.${agentId}&invoiced=eq.false`, { invoiced: true });
  },

  async markClientInvoiced(clientId, yearMonth) {
    const [yr, mo] = yearMonth.split('-').map(Number);
    const nextMo = mo === 12 ? `${yr + 1}-01` : `${yr}-${String(mo + 1).padStart(2, '0')}`;
    await SB.patch('appointments',
      `?client_id=eq.${clientId}&invoiced=eq.false&status=not.in.(cancel,no_show)&date_appt=gte.${yearMonth}-01&date_appt=lt.${nextMo}-01`,
      { invoiced: true }
    );
  },

  async patchAppointment(id, fields) {
    return SB.patch('appointments', `?id=eq.${id}`, fields);
  },

  async markInvoicePaid(clientId) {
    await SB.patch('clients', `?id=eq.${clientId}`, { bill_status: 'paid' });
    await SB.patch('appointments', `?client_id=eq.${clientId}&invoiced=eq.true`, { paid: true });
  },

  async setBillStatus(clientId, status) {
    await SB.patch('clients', `?id=eq.${clientId}`, { bill_status: status });
    if (status === 'pending') await SB.patch('appointments', `?client_id=eq.${clientId}`, { paid: false });
  },

  async setClientStatus(clientId, status) {
    return SB.patch('clients', `?id=eq.${clientId}`, { status });
  },

  async updateProspectStage(prospectId, stage) {
    return SB.patch('prospects', `?id=eq.${prospectId}`, { stage });
  },

  async addProspect(data) {
    return SB.post('prospects', { id: 'p' + Date.now(), ...data });
  },

  async advanceRecruit(id, stage) {
    return SB.patch('recruits', `?id=eq.${id}`, { stage });
  },

  async createClient(data) {
    return SB.post('clients', { id: 'c' + Date.now(), ...data });
  },

  async createAgent(data) {
    return SB.post('agents', { id: 'a' + Date.now(), ...data });
  },

  async deactivateClient(id) {
    return SB.patch('clients', `?id=eq.${id}`, { status: 'inactive' });
  },

  async toggleAgentActive(id, active) {
    return SB.patch('agents', `?id=eq.${id}`, { active });
  },

  async addContract(data) {
    const body = { id: 'ct' + Date.now(), ...data };
    const r = await fetch('/api/save-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('addContract failed:', err);
      throw new Error(err);
    }
    return true;
  },

  async upsertDials(agentId, date, count) {
    return SB.upsert('dials', 'agent_id,dial_date', { agent_id: agentId, dial_date: date, count });
  },

  async updateClient(id, data) {
    return SB.patch('clients', `?id=eq.${id}`, data);
  },

  async updateAgent(id, data) {
    return SB.patch('agents', `?id=eq.${id}`, data);
  },

  async setAgentClient(agentId, clientId, rate) {
    return SB.upsert('agent_clients', 'agent_id,client_id', { agent_id: agentId, client_id: clientId, rate: rate || 0 });
  },

  async removeAgentClient(agentId, clientId) {
    return SB.del('agent_clients', `?agent_id=eq.${agentId}&client_id=eq.${clientId}`);
  },

  async addEvent(data) {
    return SB.post('events', { id: 'ev' + Date.now(), ...data });
  },

  async deleteEvent(id) {
    return SB.del('events', `?id=eq.${id}`);
  },

  async updateProspect(id, data) {
    return SB.patch('prospects', `?id=eq.${id}`, data);
  },

  async updateContract(id, data) {
    const r = await fetch(window.SUPABASE_URL + '/rest/v1/contracts?id=eq.' + id, {
      method: 'PATCH',
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(data),
    });
    if (!r.ok) { const err = await r.text(); console.error('updateContract failed:', err); }
    return r.ok;
  },

  async addFeedback(agentId, feedback) {
    return SB.patch('agents', `?id=eq.${agentId}`, { feedback });
  },

  async changePassword(newPassword) {
    return SB.updateAuth({ password: newPassword });
  },

  async updateProfile(table, id, data) {
    return SB.patch(table, `?id=eq.${id}`, data);
  },

  async saveBillingHistory(clientId, history) {
    return SB.patch('clients', `?id=eq.${clientId}`, { billing_history: history });
  },

  async sendContractEmail({ to, party, contractType, contractValue, signingLink, notes }) {
    const html = `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Uw contract van Infinite Scale</title></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="padding:0 0 28px 0;" align="center">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:40px;height:40px;text-align:center;vertical-align:middle;">
            <img src="https://platform.infinite-scale.be/logo.svg" width="40" height="40" alt="IS" style="border-radius:50%;display:block;"/>
          </td>
          <td style="padding-left:10px;font-size:17px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">Infinite Scale</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#181c27;border-radius:18px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
        <tr><td style="height:4px;background:linear-gradient(90deg,#67dcdf,#2eb8c0);"></td></tr>
        <tr><td style="padding:40px 44px 36px;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67dcdf;font-weight:700;">Contract klaar om te ondertekenen</p>
          <h1 style="margin:0 0 20px;font-size:28px;font-weight:800;color:#ffffff;line-height:1.15;letter-spacing:-0.02em;">Uw ${contractType} van<br>Infinite Scale</h1>
          <p style="margin:0 0 32px;font-size:15px;line-height:1.65;color:#8b9bbf;">
            Beste${party ? ' ' + party : ''},<br><br>
            Uw contract is opgesteld en klaar voor uw handtekening. Gelieve de details hieronder te bekijken en op de knop te klikken om digitaal te ondertekenen.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;border-radius:12px;border:1px solid rgba(103,220,223,0.15);margin-bottom:32px;">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5a6a8a;">Contracttype</span><br>
                <span style="font-size:15px;font-weight:600;color:#ffffff;">${contractType}</span>
              </td>
              <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5a6a8a;">Vergoeding</span><br>
                <span style="font-size:15px;font-weight:600;color:#67dcdf;">${contractValue}</span>
              </td>
            </tr>
            ${notes ? `<tr><td colspan="2" style="padding:16px 20px;">
              <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5a6a8a;">Bijzondere voorwaarden</span><br>
              <span style="font-size:14px;color:#8b9bbf;line-height:1.5;">${notes}</span>
            </td></tr>` : ''}
          </table>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr><td style="background:#67dcdf;border-radius:12px;">
              <a href="${signingLink}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:800;color:#071a1a;text-decoration:none;letter-spacing:-0.01em;">Contract ondertekenen →</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#5a6a8a;line-height:1.5;">Of kopieer deze link in uw browser:</p>
          <p style="margin:0;font-size:12px;color:#67dcdf;word-break:break-all;font-family:'Courier New',monospace;">${signingLink}</p>
        </td></tr>
        <tr><td style="padding:20px 44px 28px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:12px;color:#3d4d6a;line-height:1.6;">
            Dit contract werd verzonden via het Infinite Scale platform. Heeft u vragen, antwoord dan op deze e-mail of neem contact op via <a href="mailto:info@infinite-scale.be" style="color:#67dcdf;text-decoration:none;">info@infinite-scale.be</a>.
          </p>
        </td></tr>
      </td></tr>
      <tr><td style="padding:24px 0 0;text-align:center;">
        <p style="margin:0;font-size:11px;color:#3d4d6a;">© ${new Date().getFullYear()} Curabond BV · Infinite Scale · platform.infinite-scale.be</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject: `Contract klaar ter ondertekening - Infinite Scale`, html }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'Email send failed');
    return j;
  },

  async sendOnboardingEmail({ to, name, partyType }) {
    const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="padding:0 0 28px 0;" align="center">
        <table cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://platform.infinite-scale.be/logo.svg" width="40" height="40" alt="IS" style="display:block;"/></td>
          <td style="padding-left:10px;font-size:17px;font-weight:700;color:#ffffff;">Infinite Scale</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#181c27;border-radius:18px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
        <tr><td style="height:4px;background:linear-gradient(90deg,#67dcdf,#2eb8c0);"></td></tr>
        <tr><td style="padding:40px 44px 36px;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67dcdf;font-weight:700;">Welkom bij Infinite Scale</p>
          <h1 style="margin:0 0 20px;font-size:26px;font-weight:800;color:#ffffff;line-height:1.15;">Uw contract is ondertekend —<br>stel uw account in</h1>
          <p style="margin:0 0 28px;font-size:15px;line-height:1.65;color:#8b9bbf;">
            Beste ${name || ''},<br><br>
            Uw contract met Infinite Scale is ondertekend. U kunt nu uw wachtwoord instellen en uw ${partyType === 'agent' ? 'agentdashboard' : 'klantportaal'} raadplegen voor afspraken, facturen en meer.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#67dcdf;border-radius:12px;">
              <a href="https://platform.infinite-scale.be/set-password?email=${encodeURIComponent(to)}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:800;color:#071a1a;text-decoration:none;">Wachtwoord instellen →</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#5a6a8a;">Vragen? Bereik ons via <a href="mailto:info@infinite-scale.be" style="color:#67dcdf;text-decoration:none;">info@infinite-scale.be</a></p>
        </td></tr>
        <tr><td style="padding:20px 44px 28px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:12px;color:#3d4d6a;">© ${new Date().getFullYear()} Curabond BV · Infinite Scale · platform.infinite-scale.be</p>
        </td></tr>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject: 'Welkom bij Infinite Scale — stel uw account in', html }),
    });
    const j = await res.json();
    return j.ok;
  },
};
