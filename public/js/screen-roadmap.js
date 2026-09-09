/* ─────────────────────────────────────────────────────────────────────────
   €100K ROADMAP — Infinite Scale Launch 2.0
   Admin-only execution system. All data derived from canonical app state.
   ───────────────────────────────────────────────────────────────────────── */

const ScreenRoadmap = {

  /* ══════════════════════════════════════════════════════════════════════
     METRICS ENGINE — single source of truth for every KPI
     ══════════════════════════════════════════════════════════════════════ */
  _M: {
    /* appointment classification */
    isBooked:   a => a.status !== 'cancel',
    isHeld:     a => a.status === 'show',
    isBillable: a => a.status !== 'cancel' && a.status !== 'no_show',
    isNoShow:   a => a.status === 'no_show',
    isCancelled:a => a.status === 'cancel',
    isOpen:     a => a.status === 'open',   /* scheduled, not yet held */

    /* revenue per appointment — mirrors existing cRate logic */
    clientRate(a, clients) {
      try { const fb = a.clientFeedback ? JSON.parse(a.clientFeedback) : null; if (fb && fb._rn && fb.revenue != null) return fb.revenue; } catch(_) {}
      const cl = clients.find(c => c.id === a.client);
      if (a.sub && cl) { const sc = (cl.subclients||[]).find(s => s.id === a.sub || s.name === a.sub); if (sc && sc.rate != null) return sc.rate; }
      return (cl && cl.rate) || 0;
    },

    /* agent cost per appointment — mirrors existing aRate logic */
    agentCost(a, agents) {
      const ag = agents.find(g => g.id === a.agent);
      return (ag && ((ag.rates||{})[a.sub] || (ag.rates||{})[a.client])) || 0;
    },

    /* date helpers */
    ym: d => d ? d.slice(0,7) : '',
    today() { const n=new Date(); return n.toISOString().slice(0,10); },
    daysInMonth(ym) {
      const [y,m]=ym.split('-').map(Number);
      return new Date(y, m, 0).getDate();
    },
    dayOfMonth() { return new Date().getDate(); },
    workingDaysInMonth(ym) {
      const [y,m]=ym.split('-').map(Number);
      const days=new Date(y,m,0).getDate(); let wd=0;
      for(let d=1;d<=days;d++){const dow=new Date(y,m-1,d).getDay();if(dow>0&&dow<6)wd++;}
      return wd;
    },
    workingDaysElapsed(ym) {
      const [y,m]=ym.split('-').map(Number);
      const today=new Date().getDate();
      const cap=Math.min(today,new Date(y,m,0).getDate());
      let wd=0;
      for(let d=1;d<=cap;d++){const dow=new Date(y,m-1,d).getDay();if(dow>0&&dow<6)wd++;}
      return wd;
    },

    /* dial totals from the dials map { agentId: { date: count } } */
    totalDials(dialsMap, dateFilter) {
      let total=0;
      for(const agentId of Object.keys(dialsMap||{})) {
        for(const [date,cnt] of Object.entries(dialsMap[agentId]||{})) {
          if(!dateFilter || dateFilter(date)) total+=cnt;
        }
      }
      return total;
    },

    /* days to a target date */
    daysTo(targetDateStr) {
      const t=new Date(targetDateStr); const n=new Date();
      n.setHours(0,0,0,0); t.setHours(0,0,0,0);
      return Math.max(0, Math.round((t-n)/(86400000)));
    },

    /* show rate: held / (held + no_show) */
    showRate(appts) {
      const decided=appts.filter(a=>a.status==='show'||a.status==='no_show');
      return decided.length ? appts.filter(a=>a.status==='show').length/decided.length : null;
    },

    /* EOM forecast based on MTD pace */
    forecastEOM(mtdValue, wdElapsed, wdTotal) {
      return wdElapsed > 0 ? mtdValue * wdTotal / wdElapsed : 0;
    },

    /* contribution profit */
    contribution(billableRev, agentCostTotal) { return billableRev - agentCostTotal; },
    marginPct(rev, cost) { return rev > 0 ? (rev-cost)/rev*100 : null; },
  },

  /* default strategic targets — overridden by platform_settings */
  _defaultTargets() {
    return {
      monthlyRevTarget:      100000,
      targetDate:            '2026-12-01',
      avgPricePerAppt:       125,
      salesMeetingsWeek:     40,
      minCloseRate:          15,
      minMarginPct:          50,
      capacityWarnPct:       85,
      capacityCritPct:       95,
      revenuePerAgentTarget: 12500, /* target monthly revenue per call agent */
    };
  },

  _getTargets(d) {
    const raw = (d.platformSettings||d.platform_settings||[]);
    const row = Array.isArray(raw) ? raw.find(r=>r.key==='roadmap_targets') : null;
    if (row) { try { return { ...this._defaultTargets(), ...JSON.parse(row.value) }; } catch(_) {} }
    return this._defaultTargets();
  },

  /* ══════════════════════════════════════════════════════════════════════
     MAIN RENDER
     ══════════════════════════════════════════════════════════════════════ */
  render(d, s) {
    const e = React.createElement;
    const tab = s._rmTab || 'command';
    const TABS = [
      { id:'command',     label:'Command Center' },
      { id:'acquisition', label:'Acquisition' },
      { id:'sales',       label:'Sales' },
      { id:'fulfillment', label:'Fulfillment' },
      { id:'clients',     label:'Clients' },
      { id:'agents',      label:'Agents & Capacity' },
      { id:'finance',     label:'Finance' },
      { id:'roadmap',     label:'Roadmap' },
      { id:'health',      label:'Data Health' },
    ];

    const T = this._getTargets(d);
    const M = this._M;

    /* precompute once */
    const now = new Date();
    const ym  = now.toISOString().slice(0,7);
    const today = M.today();
    const { appointments: appts, agents, clients, dials: dialsMap, prospects } = d;

    const cRate = a => M.clientRate(a, clients);
    const aRate = a => M.agentCost(a, agents);

    const apptsMTD      = (appts||[]).filter(a => M.ym(a.dateLog)===ym);
    const billableMTD   = apptsMTD.filter(M.isBillable);
    const heldMTD       = apptsMTD.filter(M.isHeld);
    const noShowMTD     = apptsMTD.filter(M.isNoShow);
    const cancelMTD     = apptsMTD.filter(M.isCancelled);

    const billableRevMTD  = billableMTD.reduce((s,a)=>s+cRate(a),0);
    const agentCostMTD    = heldMTD.reduce((s,a)=>s+aRate(a),0);
    const contribMTD      = billableRevMTD - agentCostMTD;
    const marginPctMTD    = M.marginPct(billableRevMTD, agentCostMTD);

    const wdElapsed = M.workingDaysElapsed(ym);
    const wdTotal   = M.workingDaysInMonth(ym);
    const forecastEOM = M.forecastEOM(billableRevMTD, wdElapsed, wdTotal);

    const daysRemaining = M.daysTo(T.targetDate);
    const dailyPaceCurrent = wdElapsed > 0 ? billableRevMTD / wdElapsed : 0;
    const dailyPaceRequired = wdTotal > 0 ? T.monthlyRevTarget / wdTotal : 0;

    const apptsTodayBillable = (appts||[]).filter(a=>a.dateLog===today&&M.isBillable(a));
    const dialsToday = M.totalDials(dialsMap, d=>d===today);

    const euro = v => '€' + Math.round(v||0).toLocaleString('nl-BE');
    const pct  = (v,dec=1) => v!=null ? v.toFixed(dec)+'%' : '—';
    const num  = v => (v||0).toLocaleString('nl-BE');

    /* nav bar */
    const tabNav = e('div', { style:{display:'flex',gap:0,borderBottom:'2px solid var(--border)',marginBottom:20,overflowX:'auto',flexShrink:0} },
      TABS.map(t => e('button', {
        key: t.id,
        onClick: () => this.setState({ _rmTab: t.id }),
        style: {
          background:'none', border:'none', cursor:'pointer', padding:'8px 16px', fontSize:12.5, fontWeight:tab===t.id?700:400,
          color: tab===t.id ? 'var(--text)' : 'var(--text-mute)',
          borderBottom: tab===t.id ? '2px solid var(--accent)' : '2px solid transparent',
          marginBottom:-2, whiteSpace:'nowrap',
        }
      }, t.label))
    );

    let content;
    if (tab==='command')     content = this._tabCommand.call(this,    d,s,{appts,billableMTD,heldMTD,noShowMTD,cancelMTD,billableRevMTD,agentCostMTD,contribMTD,marginPctMTD,forecastEOM,wdElapsed,wdTotal,dailyPaceCurrent,dailyPaceRequired,daysRemaining,apptsTodayBillable,dialsToday,T,euro,pct,num,cRate,aRate,ym,today,clients,agents,dialsMap,prospects});
    else if (tab==='acquisition') content = this._tabAcquisition.call(this, d,s,{prospects,euro,pct,num,T,today,ym});
    else if (tab==='sales')   content = this._tabSales.call(this,     d,s,{prospects,appts,clients,euro,pct,num,T,ym,today,cRate});
    else if (tab==='fulfillment') content = this._tabFulfillment.call(this,d,s,{appts,clients,agents,dialsMap,euro,pct,num,cRate,aRate,ym,today,T});
    else if (tab==='clients') content = this._tabClients.call(this,   d,s,{appts,clients,agents,euro,pct,num,cRate,aRate,ym,today,T});
    else if (tab==='agents')  content = this._tabAgents.call(this,    d,s,{appts,agents,clients,dialsMap,euro,pct,num,cRate,aRate,ym,today,T});
    else if (tab==='finance') content = this._tabFinance.call(this,   d,s,{appts,clients,agents,euro,pct,num,cRate,aRate,ym,today,billableRevMTD,agentCostMTD,contribMTD,marginPctMTD});
    else if (tab==='roadmap') content = this._tabRoadmap.call(this,   d,s,{T,euro,daysRemaining,billableRevMTD,forecastEOM});
    else if (tab==='health')  content = this._tabHealth.call(this,    d,s,{appts,clients,agents,dialsMap,euro,pct,num,cRate,aRate,ym,today,billableRevMTD,agentCostMTD,contribMTD});
    else content = e('div', null, '');

    return e('div', { style:{display:'flex',flexDirection:'column',minHeight:'60vh'} },
      /* page header */
      e('div', { style:{marginBottom:16} },
        e('div', { style:{display:'flex',alignItems:'baseline',gap:12} },
          e('h1', { style:{fontSize:20,fontWeight:800,color:'var(--text)',margin:0,letterSpacing:'-.02em'} }, '€100K Roadmap'),
          e('span', { style:{fontSize:12,color:'var(--text-mute)',fontWeight:500} }, 'Infinite Scale Launch 2.0')
        ),
        e('p', { style:{fontSize:12,color:'var(--text-mute)',margin:'4px 0 0'} }, '€' + T.monthlyRevTarget.toLocaleString('nl-BE') + ' MRR by ' + T.targetDate + ' · target avg €' + T.avgPricePerAppt + '/appt · €' + T.revenuePerAgentTarget.toLocaleString('nl-BE') + '/agent/mo')
      ),
      tabNav,
      content
    );
  },

  /* ── shared UI helpers ── */
  _card(title, value, sub, color, extra) {
    const e = React.createElement;
    return e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:'14px 16px',minWidth:140,flex:'1 1 160px'} },
      e('div', { style:{fontSize:10.5,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6} }, title),
      e('div', { style:{fontSize:22,fontWeight:800,color:color||'var(--text)',lineHeight:1} }, value),
      sub ? e('div', { style:{fontSize:11,color:'var(--text-mute)',marginTop:4} }, sub) : null,
      extra || null
    );
  },

  _tip(text) {
    const e = React.createElement;
    return e('span', {
      title: text,
      style:{display:'inline-block',width:14,height:14,borderRadius:'50%',background:'var(--border)',color:'var(--text-mute)',fontSize:9,fontWeight:700,textAlign:'center',lineHeight:'14px',cursor:'help',marginLeft:4,flexShrink:0},
    }, '?');
  },

  _statusDot(color) {
    const e = React.createElement;
    return e('span', { style:{width:8,height:8,borderRadius:'50%',background:color,display:'inline-block',marginRight:6,flexShrink:0} });
  },

  _section(title, children) {
    const e = React.createElement;
    return e('div', { style:{marginBottom:24} },
      e('div', { style:{fontSize:11,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10,display:'flex',alignItems:'center',gap:8} },
        e('span', { style:{flex:1} }, title),
        e('div', { style:{height:1,flex:1,background:'var(--border)'} })
      ),
      ...children
    );
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: COMMAND CENTER
     ══════════════════════════════════════════════════════════════════════ */
  _tabCommand(d, s, ctx) {
    const e = React.createElement;
    const {appts,billableMTD,heldMTD,noShowMTD,cancelMTD,billableRevMTD,agentCostMTD,contribMTD,marginPctMTD,forecastEOM,wdElapsed,wdTotal,dailyPaceCurrent,dailyPaceRequired,daysRemaining,apptsTodayBillable,dialsToday,T,euro,pct,num,cRate,aRate,ym,today,clients,agents,dialsMap,prospects} = ctx;
    const M = this._M;

    const pctOfTarget = billableRevMTD / T.monthlyRevTarget * 100;
    const revGap = Math.max(0, T.monthlyRevTarget - forecastEOM);
    const forecastDecRev = forecastEOM; /* rough: if current monthly run-rate continues */
    const required30DayPace = T.monthlyRevTarget / 22; /* per working day */

    /* pace status */
    const paceRatio = dailyPaceCurrent / Math.max(1, dailyPaceRequired);
    const paceStatus = paceRatio >= 1.1 ? { label:'Ahead', color:'var(--up)' }
                     : paceRatio >= 0.9 ? { label:'On Track', color:'var(--info)' }
                     : paceRatio >= 0.7 ? { label:'Behind', color:'var(--warn)' }
                                        : { label:'Critical', color:'var(--down)' };

    /* active counts */
    const activeClients = (clients||[]).filter(c=>c.status==='active').length;
    const activeAgents  = (agents||[]).filter(a=>a.working).length;
    const totalAgents   = (agents||[]).filter(a=>!a.offboarded).length;

    /* avg price per billable appt */
    const avgPrice = billableMTD.length > 0 ? billableRevMTD/billableMTD.length : 0;

    /* EOM required billable appts for €100K */
    const reqApptsMo = avgPrice > 0 ? Math.ceil(T.monthlyRevTarget / avgPrice) : null;
    const reqApptsDay = reqApptsMo && wdTotal > 0 ? reqApptsMo/wdTotal : null;

    /* dials MTD */
    const dialsMTD = M.totalDials(dialsMap, dt=>dt && dt.startsWith(ym));
    const dialsTodayAll = M.totalDials(dialsMap, dt=>dt===today);

    /* progress bar */
    const progressBar = e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:'20px 24px',marginBottom:20} },
      e('div', { style:{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:10} },
        e('div', null,
          e('div', { style:{fontSize:11,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:4} }, 'MRR Pace — EOM Forecast (if current pace continues)'),
          e('div', { style:{display:'flex',alignItems:'baseline',gap:8} },
            e('span', { style:{fontSize:36,fontWeight:900,color:'var(--text)',letterSpacing:'-.03em'} }, euro(forecastEOM)),
            e('span', { style:{fontSize:18,color:'var(--text-mute)'} }, '/ ' + euro(T.monthlyRevTarget)),
          ),
          e('div', { style:{fontSize:12,color:'var(--text-mute)',marginTop:2} }, euro(billableRevMTD) + ' billable MTD · ' + pct(pctOfTarget) + ' of target')
        ),
        e('div', { style:{textAlign:'right'} },
          e('div', { style:{fontSize:11,fontWeight:700,color:'var(--text-mute)',letterSpacing:'.05em',marginBottom:4} }, 'STATUS'),
          e('div', { style:{fontSize:18,fontWeight:800,color:paceStatus.color} }, paceStatus.label),
          e('div', { style:{fontSize:11,color:'var(--text-mute)'} }, daysRemaining + ' days to ' + T.targetDate)
        )
      ),
      /* bar */
      e('div', { style:{height:12,borderRadius:6,background:'var(--bg-2)',overflow:'hidden',marginBottom:8} },
        e('div', { style:{height:'100%',borderRadius:6,width:Math.min(100,pctOfTarget)+'%',background:'linear-gradient(90deg, var(--accent), var(--info))',transition:'width .4s'} })
      ),
      e('div', { style:{display:'flex',justifyContent:'space-between',fontSize:10.5,color:'var(--text-mute)'} },
        e('span', null, 'MTD: ' + pct(billableRevMTD/T.monthlyRevTarget*100,1) + ' of target'),
        e('span', null, 'Day ' + new Date().getDate() + ' of ' + M.daysInMonth(ym)),
        e('span', null, 'EOM forecast: ' + euro(forecastEOM))
      )
    );

    /* pace cards row */
    const paceRow = e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:20} },
      this._card('Daily Pace (current)', euro(dailyPaceCurrent), 'per working day', dailyPaceCurrent >= dailyPaceRequired ? 'var(--up)' : 'var(--down)'),
      this._card('Daily Pace (required)', euro(dailyPaceRequired), 'for €' + (T.monthlyRevTarget/1000).toFixed(0) + 'K/month', 'var(--text-mute)'),
      this._card('EOM Forecast', euro(forecastEOM), forecastEOM >= T.monthlyRevTarget ? '✓ on target' : '↓ ' + euro(T.monthlyRevTarget-forecastEOM) + ' short', forecastEOM >= T.monthlyRevTarget ? 'var(--up)' : 'var(--warn)'),
      this._card('Revenue Gap', euro(Math.max(0, T.monthlyRevTarget - forecastEOM)), 'to hit target this month', revGap===0 ? 'var(--up)' : 'var(--down)'),
      this._card('Days to Target Date', String(daysRemaining), T.targetDate, 'var(--text)'),
    );

    /* KPI grid */
    const kpiGrid = e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:20} },
      /* revenue */
      this._card('Billable Rev MTD',    euro(billableRevMTD),      wdElapsed + ' working days elapsed', 'var(--info)'),
      this._card('Avg Rev/Appt',        euro(avgPrice),            'billable appointments', avgPrice>=100?'var(--up)':'var(--warn)'),
      this._card('Invoiced (all time)', '—', 'see Finance tab', 'var(--text-mute)'),
      /* production */
      this._card('Billable Appts MTD',  String(billableMTD.length), 'not cancel/no-show', 'var(--text)'),
      this._card('Held Appts MTD',      String(heldMTD.length),    'status = show', 'var(--text)'),
      this._card('Billable Today',      String(apptsTodayBillable.length), 'logged today', 'var(--text)'),
      reqApptsDay ? this._card('Req. Appts/Day', pct(reqApptsDay,1).replace('%',''), 'for €'+T.monthlyRevTarget.toLocaleString()+' at '+euro(avgPrice)+'/appt', 'var(--text-mute)') : null,
      /* economics */
      this._card('Contribution MTD',    euro(contribMTD),          '(billable rev − agent cost)', contribMTD>=0?'var(--up)':'var(--down)'),
      this._card('Margin (before lead costs)', marginPctMTD!=null?pct(marginPctMTD):'—', 'no lead data yet', marginPctMTD!=null&&marginPctMTD>=T.minMarginPct?'var(--up)':'var(--warn)'),
      this._card('Agent Cost MTD',      euro(agentCostMTD),        'held appts only', 'var(--text-mute)'),
      /* dials */
      this._card('Dials Today',         String(dialsTodayAll),     'all agents', 'var(--text)'),
      this._card('Dials MTD',           String(dialsMTD),          'all agents', 'var(--text-mute)'),
      /* capacity */
      this._card('Active Clients',      String(activeClients),     'status = active', 'var(--text)'),
      this._card('Agents Online',       String(activeAgents) + '/' + String(totalAgents), 'currently working', 'var(--text)'),
    ).props.children.filter(Boolean);

    /* TODAY section */
    const reqApptToday = reqApptsDay ? Math.ceil(reqApptsDay) : '—';
    const apptsTodayCount = apptsTodayBillable.length;
    const dialsTodayCount = dialsTodayAll;

    const todaySection = e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'18px 20px',marginBottom:20} },
      e('div', { style:{fontSize:13,fontWeight:800,color:'var(--text)',marginBottom:14,letterSpacing:'-.01em'} }, '⚡ Today We Need'),
      e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:12} },
        /* rev pace */
        e('div', { style:{background:'var(--bg-2)',borderRadius:9,padding:'12px 14px'} },
          e('div', { style:{fontSize:10,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6} }, 'Revenue Pace'),
          e('div', { style:{fontSize:18,fontWeight:800,color:'var(--info)'} }, euro(dailyPaceRequired)),
          e('div', { style:{fontSize:11,color:'var(--text-mute)',marginTop:2} }, 'current: ' + euro(dailyPaceCurrent))
        ),
        /* billable appts */
        e('div', { style:{background:'var(--bg-2)',borderRadius:9,padding:'12px 14px'} },
          e('div', { style:{fontSize:10,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6} }, 'Billable Appts Target'),
          e('div', { style:{fontSize:18,fontWeight:800,color:'var(--text)'} }, typeof reqApptToday==='number' ? reqApptToday : '—'),
          e('div', { style:{fontSize:11,color:'var(--text-mute)',marginTop:2} }, 'current today: ' + apptsTodayCount)
        ),
        /* dials */
        e('div', { style:{background:'var(--bg-2)',borderRadius:9,padding:'12px 14px'} },
          e('div', { style:{fontSize:10,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6} }, 'Dials Today'),
          e('div', { style:{fontSize:18,fontWeight:800,color:'var(--text)'} }, String(dialsTodayCount||0)),
          e('div', { style:{fontSize:11,color:'var(--text-mute)',marginTop:2} }, 'MTD: ' + num(dialsMTD))
        ),
      )
    );

    /* bottleneck detection */
    const bottleneck = this._detectBottleneck({appts,billableMTD,heldMTD,noShowMTD,cancelMTD,dialsMap,prospects,clients,agents,ym,today,billableRevMTD,T,avgPrice,wdElapsed,dailyPaceCurrent,dailyPaceRequired});

    const bottleneckCard = e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderBLeft:'4px solid '+bottleneck.color,borderLeft:'4px solid '+bottleneck.color,borderRadius:10,padding:'14px 16px',marginBottom:20} },
      e('div', { style:{fontSize:10.5,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6} }, "Today's Bottleneck"),
      e('div', { style:{fontSize:15,fontWeight:700,color:bottleneck.color,marginBottom:4} }, bottleneck.title),
      e('div', { style:{fontSize:12,color:'var(--text-mute)'} }, bottleneck.detail)
    );

    return e('div', null,
      progressBar, paceRow,
      e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:20} }, ...kpiGrid),
      todaySection,
      bottleneckCard
    );
  },

  _detectBottleneck({appts,billableMTD,heldMTD,noShowMTD,dialsMap,prospects,clients,agents,ym,today,billableRevMTD,T,avgPrice,wdElapsed,dailyPaceCurrent,dailyPaceRequired}) {
    const M = this._M;
    const dialsMTD = M.totalDials(dialsMap, dt=>dt&&dt.startsWith(ym));
    const showRate = M.showRate((appts||[]).filter(a=>M.ym(a.dateLog)===ym));
    const cancelMTD = (appts||[]).filter(a=>M.ym(a.dateLog)===ym&&M.isCancelled(a));
    const noShowMTD_arr = (appts||[]).filter(a=>M.ym(a.dateLog)===ym&&M.isNoShow(a));
    const totalMTD = (appts||[]).filter(a=>M.ym(a.dateLog)===ym&&a.status!=='cancel');
    const noShowRate = totalMTD.length > 0 ? noShowMTD_arr.length/totalMTD.length : 0;
    const cancelRate = totalMTD.length > 0 ? cancelMTD.length/totalMTD.length : 0;

    if (dailyPaceCurrent < dailyPaceRequired * 0.5 && wdElapsed >= 3)
      return { title:'Revenue pace critically low', detail:'Current daily pace is less than 50% of required. Check appointment volume and pricing.', color:'var(--down)' };
    if (avgPrice < 60 && billableMTD.length > 10)
      return { title:'Low average revenue per appointment', detail:`€${Math.round(avgPrice)} avg — target is €${T.avgPricePerAppt}. Revenue mix is skewed toward low-priced projects.`, color:'var(--warn)' };
    if (noShowRate > 0.25 && totalMTD.length > 10)
      return { title:'High no-show rate', detail:`${Math.round(noShowRate*100)}% no-show rate this month. WhatsApp reminders and confirmation calls may help.`, color:'var(--down)' };
    if (cancelRate > 0.2 && totalMTD.length > 10)
      return { title:'High cancellation rate', detail:`${Math.round(cancelRate*100)}% cancellation rate. Review client qualification and prospect quality.`, color:'var(--warn)' };
    if (dialsMTD < wdElapsed * 400 && wdElapsed >= 3)
      return { title:'Insufficient dial volume', detail:`${dialsMTD} dials MTD — below estimated minimum. Check agent activity and lead supply.`, color:'var(--warn)' };
    if (dailyPaceCurrent >= dailyPaceRequired)
      return { title:'No critical bottleneck detected', detail:'Revenue pace is on target. Monitor show rate and client health.', color:'var(--up)' };
    return { title:'Revenue pace below target', detail:`Daily pace: €${Math.round(dailyPaceCurrent)} vs required €${Math.round(dailyPaceRequired)}. Scale dial volume or improve pricing mix.`, color:'var(--warn)' };
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: ACQUISITION (IS own sales pipeline)
     ══════════════════════════════════════════════════════════════════════ */
  _tabAcquisition(d, s, {prospects, euro, pct, num, T, today, ym}) {
    const e = React.createElement;
    const allProspects = (prospects||[]);

    /* stage funnel — using the platform's pipeline stages as a proxy */
    const stageOrder = ['nieuwe_leads','first_call','follow_up_call','herplan_call','meeting_geboekt','gewonnen','niet_gewonnen'];
    const stageLabels = {
      nieuwe_leads: 'New Lead', first_call: 'First Call', follow_up_call: 'Follow-up',
      herplan_call: 'Reschedule', meeting_geboekt: 'Meeting Booked', gewonnen: 'Closed Won', niet_gewonnen: 'Closed Lost',
    };

    /* counts per stage across all pipelines except meta_ads */
    const byStagePipeline = (pid) => {
      const pp = allProspects.filter(p => pid==='all' ? p.pipeline_id !== 'meta_ads' : p.pipeline_id === pid);
      const result = {};
      for (const st of stageOrder) result[st] = pp.filter(p=>p.stage===st).length;
      return result;
    };
    const stageCounts = byStagePipeline('all');

    /* totals */
    const total = allProspects.filter(p=>p.pipeline_id!=='meta_ads').length;
    const metaLeads = allProspects.filter(p=>p.pipeline_id==='meta_ads').length;
    const contacted = stageOrder.slice(1).reduce((s,st)=>s+(stageCounts[st]||0),0);
    const meetingBooked = stageCounts['meeting_geboekt']||0;
    const closedWon = stageCounts['gewonnen']||0;
    const closedLost = stageCounts['niet_gewonnen']||0;

    const prospectToMeeting = total > 0 ? meetingBooked/total*100 : null;
    const prospectToClose   = total > 0 ? closedWon/(closedWon+closedLost+0.001)*100 : null;

    /* funnel bars */
    const funnelStages = [
      { label:'Total Prospects', count:total, color:'var(--accent)' },
      { label:'Contacted',       count:contacted, color:'var(--info)' },
      { label:'Meeting Booked',  count:meetingBooked, color:'var(--warn)' },
      { label:'Closed Won',      count:closedWon, color:'var(--up)' },
    ];
    const maxCount = Math.max(1, ...funnelStages.map(f=>f.count));

    const funnel = e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'18px 20px',marginBottom:20} },
      e('div', { style:{fontSize:12,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:14} }, 'IS Sales Funnel (all pipelines excl. Meta)'),
      funnelStages.map((f,i) => e('div', { key:i, style:{marginBottom:10} },
        e('div', { style:{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4} },
          e('span', { style:{color:'var(--text)',fontWeight:600} }, f.label),
          e('span', { style:{color:'var(--text-mute)',fontFamily:"'JetBrains Mono'"} }, num(f.count))
        ),
        e('div', { style:{height:8,borderRadius:4,background:'var(--bg-2)'} },
          e('div', { style:{height:'100%',borderRadius:4,background:f.color,width:(f.count/maxCount*100)+'%',transition:'width .4s'} })
        ),
        i < funnelStages.length-1 ? e('div', { style:{fontSize:10.5,color:'var(--text-mute)',marginTop:2} }, '↓ ' + pct(funnelStages[i+1].count/Math.max(1,f.count)*100) + ' conversion') : null
      ))
    );

    /* stage breakdown table */
    const stageTable = e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'18px 20px',marginBottom:20} },
      e('div', { style:{fontSize:12,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:12} }, 'Prospects by Stage'),
      e('table', { style:{width:'100%',borderCollapse:'collapse',fontSize:12.5} },
        e('thead', null,
          e('tr', null,
            ['Stage','Count','% of Total'].map(h=>e('th',{key:h,style:{textAlign:'left',padding:'4px 8px',color:'var(--text-mute)',fontSize:10.5,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',borderBottom:'1px solid var(--border)'}},h))
          )
        ),
        e('tbody', null,
          stageOrder.filter(st=>st!=='niet_gewonnen').map(st=>
            e('tr', { key:st, style:{borderBottom:'1px solid var(--border-soft)'} },
              e('td',{style:{padding:'6px 8px',color:'var(--text)',fontWeight:st==='gewonnen'?700:400}}, stageLabels[st]||st),
              e('td',{style:{padding:'6px 8px',fontFamily:"'JetBrains Mono'",color:'var(--text)'}}, stageCounts[st]||0),
              e('td',{style:{padding:'6px 8px',color:'var(--text-mute)'}}, total>0?pct((stageCounts[st]||0)/total*100):'—')
            )
          )
        )
      ),
      metaLeads > 0 ? e('div', { style:{marginTop:10,fontSize:11,color:'var(--text-mute)'} }, '+ ' + num(metaLeads) + ' Meta Ads leads (separate pipeline)') : null
    );

    /* conversion metrics */
    const convCards = e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:20} },
      this._card('Total Prospects', num(total), 'excl. Meta Ads', 'var(--text)'),
      this._card('Meeting Booked', num(meetingBooked), 'stage = meeting_geboekt', 'var(--info)'),
      this._card('Closed Won', num(closedWon), 'became clients', 'var(--up)'),
      this._card('Prospect → Meeting', prospectToMeeting!=null?pct(prospectToMeeting):'—', 'conversion rate', 'var(--text-mute)'),
      this._card('Close Rate', prospectToClose!=null?pct(prospectToClose):'—', 'won/decided', 'var(--text-mute)'),
      this._card('Meta Leads', num(metaLeads), 'Meta Ads pipeline', 'var(--text-mute)'),
    );

    return e('div', null,
      e('div',{style:{fontSize:11.5,color:'var(--text-mute)',marginBottom:16}}, 'Data source: Prospect CRM. Manage prospects in the Prospect CRM tab. Stage names map to the "manuele" pipeline stages.'),
      convCards, funnel, stageTable
    );
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: SALES
     ══════════════════════════════════════════════════════════════════════ */
  _tabSales(d, s, {prospects, appts, clients, euro, pct, num, T, ym, today, cRate}) {
    const e = React.createElement;

    const meetingProspects = (prospects||[]).filter(p=>p.stage==='meeting_geboekt'||p.stage==='herplan_call');
    const wonProspects = (prospects||[]).filter(p=>p.stage==='gewonnen');
    const lostProspects = (prospects||[]).filter(p=>p.stage==='niet_gewonnen');
    const totalDecided = wonProspects.length + lostProspects.length;
    const closeRate = totalDecided > 0 ? wonProspects.length/totalDecided*100 : null;

    /* weekly target */
    const weekTarget = T.salesMeetingsWeek;
    const now = new Date();
    const dayOfWeek = now.getDay() || 7;
    const weekStart = new Date(now); weekStart.setDate(now.getDate()-dayOfWeek+1); weekStart.setHours(0,0,0,0);
    const weekStartStr = weekStart.toISOString().slice(0,10);
    const meetingsThisWeek = (prospects||[]).filter(p=>{
      const d2=p.created_at||''; return d2>=weekStartStr && (p.stage==='meeting_geboekt'||p.stage==='herplan_call');
    }).length;

    /* revenue from new clients this month */
    const newClientsThisMo = (clients||[]).filter(c=>{
      const k=c.kickoff||''; return k.startsWith(ym);
    });

    const paceCard = (target, current, label, unit='') => {
      const remaining = Math.max(0, target-current);
      const daysLeft = 7-Math.min(7, dayOfWeek-1);
      const perDay = daysLeft > 0 ? remaining/daysLeft : 0;
      return e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 18px'} },
        e('div', { style:{fontSize:11,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10} }, label),
        e('div', { style:{display:'flex',gap:20,alignItems:'flex-end',marginBottom:12} },
          e('div', null,
            e('div', { style:{fontSize:28,fontWeight:900,color:'var(--text)'} }, unit+current),
            e('div', { style:{fontSize:11,color:'var(--text-mute)'} }, 'this week')
          ),
          e('div', null,
            e('div', { style:{fontSize:14,fontWeight:700,color:'var(--text-mute)'} }, '/ '+unit+target),
            e('div', { style:{fontSize:11,color:'var(--text-mute)'} }, 'target')
          ),
          e('div', null,
            e('div', { style:{fontSize:14,fontWeight:700,color:remaining===0?'var(--up)':'var(--warn)'} }, unit+remaining),
            e('div', { style:{fontSize:11,color:'var(--text-mute)'} }, 'remaining')
          )
        ),
        e('div', { style:{height:8,borderRadius:4,background:'var(--bg-2)',marginBottom:6} },
          e('div', { style:{height:'100%',borderRadius:4,background:current>=target?'var(--up)':'var(--accent)',width:Math.min(100,current/target*100)+'%'} })
        ),
        e('div', { style:{fontSize:11,color:'var(--text-mute)'} }, remaining > 0 ? `${perDay.toFixed(1)} needed/day for ${daysLeft} remaining working days` : '✓ Target reached')
      );
    };

    return e('div', null,
      e('div',{style:{fontSize:11.5,color:'var(--text-mute)',marginBottom:16}}, 'Sales data sourced from Prospect CRM. "Meeting Booked" stage = qualified sales meeting. Refine stage names to improve accuracy.'),
      /* pace cards */
      e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:20} },
        paceCard(weekTarget, meetingsThisWeek, 'Sales Meetings This Week'),
      ),
      /* KPI row */
      e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:20} },
        this._card('Meetings in Pipeline', num(meetingProspects.length), 'booked + reschedule', 'var(--info)'),
        this._card('Closed Won', num(wonProspects.length), 'all time', 'var(--up)'),
        this._card('Closed Lost', num(lostProspects.length), 'all time', 'var(--down)'),
        this._card('Close Rate', closeRate!=null?pct(closeRate):'—', 'won / (won+lost)', closeRate!=null&&closeRate>=T.minCloseRate?'var(--up)':'var(--warn)'),
        this._card('New Clients This Mo.', num(newClientsThisMo.length), 'by kickoff date', 'var(--text)'),
        this._card('Week Target', num(weekTarget)+'/wk', 'sales meetings target', 'var(--text-mute)'),
      ),
      /* guidance */
      e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 18px'} },
        e('div', { style:{fontSize:12,fontWeight:700,marginBottom:8,color:'var(--text)'} }, '€100K Sales Math'),
        e('div', { style:{fontSize:12,color:'var(--text-mute)',lineHeight:1.7} },
          'At ' + pct(closeRate||T.minCloseRate) + ' close rate · ' + euro(T.avgPricePerAppt) + ' avg/appt:',
          e('br'),
          'Need ~' + Math.ceil(T.monthlyRevTarget / Math.max(1, T.avgPricePerAppt)) + ' billable appts/month',
          e('br'),
          'Meetings needed to close ' + Math.ceil(T.monthlyRevTarget / Math.max(1, T.avgPricePerAppt) * (100/Math.max(1,closeRate||T.minCloseRate)) / 12) + '/wk to add 1 client/month',
        )
      )
    );
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: FULFILLMENT
     ══════════════════════════════════════════════════════════════════════ */
  _tabFulfillment(d, s, {appts, clients, agents, dialsMap, euro, pct, num, cRate, aRate, ym, today, T}) {
    const e = React.createElement;
    const M = this._M;
    const filter = s._rmFulFilter || 'month';

    /* date filter */
    const now = new Date();
    const filterFn = {
      today:  a => a.dateLog === today,
      week:   a => { const d=new Date(a.dateLog); const ws=new Date(now); ws.setDate(now.getDate()-(now.getDay()||7)+1); ws.setHours(0,0,0,0); return d>=ws; },
      month:  a => (a.dateLog||'').startsWith(ym),
      all:    a => true,
    }[filter] || (a => (a.dateLog||'').startsWith(ym));

    const periodAppts = (appts||[]).filter(filterFn);
    const billable = periodAppts.filter(M.isBillable);
    const held     = periodAppts.filter(M.isHeld);
    const noShows  = periodAppts.filter(M.isNoShow);
    const cancels  = periodAppts.filter(M.isCancelled);
    const booked   = periodAppts.filter(M.isBooked);

    const weekStartStr = (() => { const ws=new Date(now); ws.setDate(now.getDate()-(now.getDay()||7)+1); ws.setHours(0,0,0,0); return ws.toISOString().slice(0,10); })();
    const dialsPeriod = M.totalDials(dialsMap,
      filter==='month' ? dt=>dt&&dt.startsWith(ym) :
      filter==='today' ? dt=>dt===today :
      filter==='week'  ? dt=>!!dt&&dt>=weekStartStr :
      dt=>true
    );

    const showRate    = held.length+noShows.length > 0 ? held.length/(held.length+noShows.length)*100 : null;
    const dialToBook  = dialsPeriod > 0 ? booked.length/dialsPeriod*100 : null;
    const bookToHeld  = booked.length > 0 ? held.length/booked.length*100 : null;
    const cancelRate  = booked.length > 0 ? cancels.length/booked.length*100 : null;
    const noShowRate  = booked.length > 0 ? noShows.length/booked.length*100 : null;
    const billableRev = billable.reduce((s,a)=>s+cRate(a),0);
    const agentCost   = held.reduce((s,a)=>s+aRate(a),0);
    const revPerDial  = dialsPeriod > 0 ? billableRev/dialsPeriod : null;
    const dialsPerBillable = billable.length > 0 ? Math.round(dialsPeriod/billable.length) : null;

    const tabs = ['today','week','month','all'].map(f => e('button', {
      key:f, onClick:()=>this.setState({_rmFulFilter:f}),
      style:{padding:'5px 12px',borderRadius:6,border:'1px solid var(--border)',background:filter===f?'var(--accent)':'var(--surface)',color:filter===f?'#fff':'var(--text)',fontSize:11.5,cursor:'pointer',fontWeight:filter===f?700:400}
    }, {today:'Today',week:'This Week',month:'This Month',all:'All Time'}[f]));

    return e('div', null,
      /* filter bar */
      e('div', { style:{display:'flex',gap:6,marginBottom:16} }, ...tabs),
      /* KPI grid */
      e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:20} },
        this._card('Dials', num(dialsPeriod), 'all agents', 'var(--text)'),
        this._card('Booked', num(booked.length), 'not cancelled', 'var(--text)'),
        this._card('Held', num(held.length), 'status = show', 'var(--info)'),
        this._card('Billable', num(billable.length), 'not cancel/no-show', 'var(--text)'),
        this._card('No-show', num(noShows.length), '', noShows.length>0?'var(--warn)':'var(--text-mute)'),
        this._card('Cancelled', num(cancels.length), '', cancels.length>0?'var(--down)':'var(--text-mute)'),
        this._card('Show Rate', showRate!=null?pct(showRate):'—', 'held / (held+noshow)', showRate!=null&&showRate>=70?'var(--up)':'var(--warn)'),
        this._card('Dial → Book %', dialToBook!=null?pct(dialToBook,2):'—', 'dial-to-appointment', 'var(--text-mute)'),
        this._card('Book → Held %', bookToHeld!=null?pct(bookToHeld):'—', 'held/booked', 'var(--text-mute)'),
        this._card('Cancel Rate', cancelRate!=null?pct(cancelRate):'—', '', cancelRate!=null&&cancelRate>20?'var(--down)':'var(--text-mute)'),
        this._card('No-show Rate', noShowRate!=null?pct(noShowRate):'—', '', noShowRate!=null&&noShowRate>20?'var(--down)':'var(--text-mute)'),
        this._card('Billable Revenue', euro(billableRev), 'period', 'var(--info)'),
        this._card('Agent Cost', euro(agentCost), 'held only', 'var(--text-mute)'),
        this._card('Revenue/Dial', revPerDial!=null?euro(revPerDial):'—', '', 'var(--text-mute)'),
        this._card('Dials/Billable Appt', dialsPerBillable!=null?num(dialsPerBillable):'—', 'efficiency', 'var(--text-mute)'),
      ),
      /* agent breakdown */
      this._agentBreakdownTable(appts.filter(filterFn), agents, dialsMap, filter, ym, today, cRate, aRate, euro, pct, num)
    );
  },

  _agentBreakdownTable(periodAppts, agents, dialsMap, filter, ym, today, cRate, aRate, euro, pct, num) {
    const e = React.createElement;
    const M = this._M;
    const dateFilterFn = filter==='today' ? dt=>dt===today : filter==='month' ? dt=>dt&&dt.startsWith(ym) : dt=>true;

    const rows = (agents||[]).map(ag => {
      const agAppts = periodAppts.filter(a=>a.agent===ag.id);
      const held    = agAppts.filter(M.isHeld);
      const billable= agAppts.filter(M.isBillable);
      const noShows = agAppts.filter(M.isNoShow);
      const dials   = M.totalDials({[ag.id]: (dialsMap||{})[ag.id]||{}}, dateFilterFn);
      const rev     = billable.reduce((s,a)=>s+cRate(a),0);
      const cost    = held.reduce((s,a)=>s+aRate(a),0);
      const sr      = held.length+noShows.length > 0 ? held.length/(held.length+noShows.length)*100 : null;
      return { ag, dials, billable:billable.length, held:held.length, noShows:noShows.length, rev, cost, sr };
    }).filter(r=>r.billable>0||r.dials>0).sort((a,b)=>b.rev-a.rev);

    if (!rows.length) return e('div', { style:{color:'var(--text-mute)',fontSize:12,padding:16} }, 'No agent activity in this period.');

    return e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'} },
      e('div', { style:{padding:'12px 16px',borderBottom:'1px solid var(--border)',fontSize:11,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em'} }, 'Agent Breakdown'),
      e('div', { style:{overflowX:'auto'} },
        e('table', { style:{width:'100%',borderCollapse:'collapse',fontSize:12.5} },
          e('thead', null, e('tr', null,
            ['Agent','Dials','Billable','Held','No-show','Show%','Revenue','Agent Cost','P&L'].map(h =>
              e('th',{key:h,style:{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.06em',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}},h)
            )
          )),
          e('tbody', null, rows.map(r => e('tr', { key:r.ag.id, style:{borderBottom:'1px solid var(--border-soft)'} },
            e('td',{style:{padding:'7px 12px',fontWeight:600,color:'var(--text)'}}, r.ag.name),
            e('td',{style:{padding:'7px 12px',fontFamily:"'JetBrains Mono'",color:'var(--text-mute)'}}, num(r.dials)),
            e('td',{style:{padding:'7px 12px',fontFamily:"'JetBrains Mono'"}}, r.billable),
            e('td',{style:{padding:'7px 12px',fontFamily:"'JetBrains Mono'"}}, r.held),
            e('td',{style:{padding:'7px 12px',fontFamily:"'JetBrains Mono'",color:r.noShows>0?'var(--warn)':'var(--text-mute)'}}, r.noShows),
            e('td',{style:{padding:'7px 12px',color:r.sr!=null&&r.sr>=70?'var(--up)':'var(--warn)'}}, r.sr!=null?pct(r.sr):'—'),
            e('td',{style:{padding:'7px 12px',fontWeight:700,color:'var(--info)',fontFamily:"'JetBrains Mono'"}}, euro(r.rev)),
            e('td',{style:{padding:'7px 12px',color:'var(--text-mute)',fontFamily:"'JetBrains Mono'"}}, euro(r.cost)),
            e('td',{style:{padding:'7px 12px',fontWeight:700,fontFamily:"'JetBrains Mono'",color:r.rev-r.cost>=0?'var(--up)':'var(--down)'}}, euro(r.rev-r.cost)),
          )))
        )
      )
    );
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: CLIENTS
     ══════════════════════════════════════════════════════════════════════ */
  _tabClients(d, s, {appts, clients, agents, euro, pct, num, cRate, aRate, ym, today, T}) {
    const e = React.createElement;
    const M = this._M;
    const now = new Date();

    const activeClients = (clients||[]).filter(c=>c.status==='active');
    const totalBillableRevMTD = (appts||[]).filter(a=>(a.dateLog||'').startsWith(ym)&&M.isBillable(a)).reduce((s,a)=>s+cRate(a),0);

    const rows = activeClients.map(cl => {
      const clAppts = (appts||[]).filter(a=>a.client===cl.id);
      const mtd = clAppts.filter(a=>(a.dateLog||'').startsWith(ym));
      const billableMTD = mtd.filter(M.isBillable);
      const heldMTD    = mtd.filter(M.isHeld);
      const noShowMTD  = mtd.filter(M.isNoShow);
      const cancelMTD  = mtd.filter(M.isCancelled);
      const rev        = billableMTD.reduce((s,a)=>s+cRate(a),0);
      const cost       = heldMTD.reduce((s,a)=>s+aRate(a),0);
      const contrib    = rev - cost;
      const margin     = M.marginPct(rev, cost);
      const showRate   = M.showRate(mtd);
      const cancelRate = mtd.filter(M.isBooked).length > 0 ? cancelMTD.length/mtd.filter(M.isBooked).length*100 : null;
      const noShowRate = mtd.filter(M.isBooked).length > 0 ? noShowMTD.length/mtd.filter(M.isBooked).length*100 : null;
      const lastApptDate = clAppts.filter(M.isBillable).map(a=>a.dateLog||'').sort().reverse()[0]||null;
      const daysSinceLast = lastApptDate ? Math.round((now-new Date(lastApptDate))/86400000) : null;
      const revShare = totalBillableRevMTD > 0 ? rev/totalBillableRevMTD*100 : 0;

      /* health scoring */
      let health = 'green';
      if (daysSinceLast!=null&&daysSinceLast>5) health='yellow';
      if (noShowRate!=null&&noShowRate>25) health='yellow';
      if (cancelRate!=null&&cancelRate>25) health='yellow';
      if (margin!=null&&margin<T.minMarginPct*0.7) health='yellow';
      if (billableMTD.length===0&&(now.getDate()>5)) health='red';
      if (daysSinceLast!=null&&daysSinceLast>10) health='red';
      const healthColor = {green:'var(--up)',yellow:'var(--warn)',red:'var(--down)'}[health];

      return { cl, rev, cost, contrib, margin, showRate, cancelRate, noShowRate, billableMTD:billableMTD.length, heldMTD:heldMTD.length, daysSinceLast, revShare, health, healthColor };
    }).sort((a,b)=>b.rev-a.rev);

    /* concentration risk */
    const top1 = rows[0] ? rows[0].revShare : 0;
    const top3 = rows.slice(0,3).reduce((s,r)=>s+r.revShare,0);

    return e('div', null,
      /* concentration warning */
      top1 > 40 ? e('div', { style:{background:'oklch(0.22 0.06 50 / .3)',border:'1px solid var(--warn)',borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:12,color:'var(--warn)'} },
        '⚠ Concentration risk: ' + (rows[0]?.cl?.name||'top client') + ' represents ' + pct(top1) + ' of MTD revenue. Top 3: ' + pct(top3) + '.'
      ) : null,
      /* client table */
      e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'} },
        e('div', { style:{overflowX:'auto'} },
          e('table', { style:{width:'100%',borderCollapse:'collapse',fontSize:12} },
            e('thead', null, e('tr', null,
              ['','Client','Billable MTD','Revenue MTD','Rev Share','Agent Cost','Margin','Show%','Cancel%','No-show%','Days since appt'].map(h=>
                e('th',{key:h,style:{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.06em',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}},h)
              )
            )),
            e('tbody', null, rows.map(r=>e('tr',{key:r.cl.id,style:{borderBottom:'1px solid var(--border-soft)'}},
              e('td',{style:{padding:'7px 12px'}}, e('span',{style:{width:8,height:8,borderRadius:'50%',background:r.healthColor,display:'inline-block'}})),
              e('td',{style:{padding:'7px 12px',fontWeight:700,color:'var(--text)'}}, r.cl.name),
              e('td',{style:{padding:'7px 12px',fontFamily:"'JetBrains Mono'"}}, r.billableMTD),
              e('td',{style:{padding:'7px 12px',fontWeight:700,color:'var(--info)',fontFamily:"'JetBrains Mono'"}}, euro(r.rev)),
              e('td',{style:{padding:'7px 12px',color:'var(--text-mute)'}}, pct(r.revShare)),
              e('td',{style:{padding:'7px 12px',color:'var(--text-mute)',fontFamily:"'JetBrains Mono'"}}, euro(r.cost)),
              e('td',{style:{padding:'7px 12px',color:r.margin!=null&&r.margin>=T.minMarginPct?'var(--up)':'var(--warn)'}}, r.margin!=null?pct(r.margin):'—'),
              e('td',{style:{padding:'7px 12px',color:r.showRate!=null&&r.showRate>=70?'var(--up)':'var(--warn)'}}, r.showRate!=null?pct(r.showRate):'—'),
              e('td',{style:{padding:'7px 12px',color:r.cancelRate!=null&&r.cancelRate>20?'var(--down)':'var(--text-mute)'}}, r.cancelRate!=null?pct(r.cancelRate):'—'),
              e('td',{style:{padding:'7px 12px',color:r.noShowRate!=null&&r.noShowRate>20?'var(--down)':'var(--text-mute)'}}, r.noShowRate!=null?pct(r.noShowRate):'—'),
              e('td',{style:{padding:'7px 12px',color:r.daysSinceLast!=null&&r.daysSinceLast>7?'var(--warn)':'var(--text-mute)'}}, r.daysSinceLast!=null?r.daysSinceLast+'d':'—'),
            )))
          )
        )
      )
    );
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: AGENTS & CAPACITY
     ══════════════════════════════════════════════════════════════════════ */
  _tabAgents(d, s, {appts, agents, clients, dialsMap, euro, pct, num, cRate, aRate, ym, today, T}) {
    const e = React.createElement;
    const M = this._M;

    const allAgents = (agents||[]).filter(a=>!a.offboarded);
    const activeAgents = allAgents.filter(a=>a.working);
    const dialsMTD = M.totalDials(dialsMap, dt=>dt&&dt.startsWith(ym));
    const daysElapsed = M.workingDaysElapsed(ym);
    const avgDialsPerAgentPerDay = allAgents.length > 0 && daysElapsed > 0 ? dialsMTD/allAgents.length/daysElapsed : 0;

    /* capacity estimate */
    const apptsMTD = (appts||[]).filter(a=>(a.dateLog||'').startsWith(ym)&&M.isBillable(a));
    const billableRevMTD = apptsMTD.reduce((s,a)=>s+cRate(a),0);
    const wdTotal = M.workingDaysInMonth(ym);
    const forecastMo = M.forecastEOM(billableRevMTD, daysElapsed, wdTotal);
    const revPerAgent = allAgents.length > 0 ? forecastMo / allAgents.length : 0;
    /* Agents needed = target revenue / target revenue-per-agent (not extrapolated from early-month data) */
    const agentsNeeded100k = Math.ceil(T.monthlyRevTarget / T.revenuePerAgentTarget);
    const capacityGap = Math.max(0, agentsNeeded100k - allAgents.length);

    return e('div', null,
      /* capacity summary */
      e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'18px 20px',marginBottom:20} },
        e('div', { style:{fontSize:12,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:12} }, 'Capacity Engine'),
        e('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))',gap:12} },
          this._card('Active Agents', num(allAgents.length), 'not offboarded', 'var(--text)'),
          this._card('Currently Online', num(activeAgents.length), 'working now', 'var(--up)'),
          this._card('Avg Dials/Agent/Day', avgDialsPerAgentPerDay>0?num(Math.round(avgDialsPerAgentPerDay)):'—', 'MTD avg', 'var(--text-mute)'),
          this._card('Rev/Agent (forecast)', euro(revPerAgent), 'this month extrapolated', 'var(--info)'),
          this._card('Agents for €100K', agentsNeeded100k!=null?num(agentsNeeded100k):'—', 'at current productivity', 'var(--text-mute)'),
          this._card('Capacity Gap', capacityGap!=null?(capacityGap>0?'+'+capacityGap+' needed':'✓ Sufficient'):'—', 'additional agents required', capacityGap!=null&&capacityGap>0?'var(--down)':'var(--up)'),
        )
      ),
      /* per-agent table */
      this._agentBreakdownTable((appts||[]).filter(a=>(a.dateLog||'').startsWith(ym)), agents, dialsMap, 'month', ym, today, cRate, aRate, euro, pct, num),
      /* hiring triggers */
      capacityGap > 0 ? e('div', { style:{marginTop:16,background:'oklch(0.22 0.06 0 / .25)',border:'1px solid var(--down)',borderRadius:10,padding:'12px 14px',fontSize:12,color:'var(--down)'} },
        '🚨 Capacity Alert: at current productivity, you need ' + agentsNeeded100k + ' agents to reach €100K/month. Current: ' + allAgents.length + '. Gap: +' + capacityGap + ' agents.'
      ) : e('div', { style:{marginTop:16,background:'oklch(0.22 0.06 140 / .25)',border:'1px solid var(--up)',borderRadius:10,padding:'12px 14px',fontSize:12,color:'var(--up)'} },
        '✓ Current agent capacity appears sufficient to reach €100K/month at current per-agent productivity.'
      )
    );
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: FINANCE
     ══════════════════════════════════════════════════════════════════════ */
  _tabFinance(d, s, {appts, clients, agents, euro, pct, num, cRate, aRate, ym, today, billableRevMTD, agentCostMTD, contribMTD, marginPctMTD}) {
    const e = React.createElement;
    const M = this._M;

    const prevYm = (() => { const [y,m]=ym.split('-').map(Number); return m===1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`; })();

    const calc = (ymFilter) => {
      const period = (appts||[]).filter(a=>(a.dateLog||'').startsWith(ymFilter));
      const billable = period.filter(M.isBillable);
      const held     = period.filter(M.isHeld);
      const invoiced = period.filter(a=>a.invoiced&&M.isBillable(a));
      const paid     = period.filter(a=>a.paid&&M.isBillable(a));
      const rev      = billable.reduce((s,a)=>s+cRate(a),0);
      const cost     = held.reduce((s,a)=>s+aRate(a),0);
      const invRev   = invoiced.reduce((s,a)=>s+cRate(a),0);
      const paidRev  = paid.reduce((s,a)=>s+cRate(a),0);
      return { rev, cost, contrib:rev-cost, margin:M.marginPct(rev,cost), invRev, paidRev, billableCount:billable.length };
    };

    const cur  = calc(ym);
    const prev = calc(prevYm);
    const revChg = prev.rev > 0 ? (cur.rev-prev.rev)/prev.rev*100 : null;
    const contribChg = prev.contrib > 0 ? (cur.contrib-prev.contrib)/prev.contrib*100 : null;

    const row = (label, cur, prev, format=euro, tooltip='') => e('tr', { style:{borderBottom:'1px solid var(--border-soft)'} },
      e('td',{style:{padding:'8px 12px',color:'var(--text)',fontWeight:500,fontSize:12.5}}, label, tooltip ? this._tip(tooltip) : null),
      e('td',{style:{padding:'8px 12px',fontWeight:700,color:'var(--info)',fontFamily:"'JetBrains Mono'",fontSize:13}}, format(cur)),
      e('td',{style:{padding:'8px 12px',color:'var(--text-mute)',fontFamily:"'JetBrains Mono'",fontSize:12.5}}, format(prev)),
      e('td',{style:{padding:'8px 12px',fontSize:12}}, prev && prev > 0 ? e('span',{style:{color:(cur-prev)>=0?'var(--up)':'var(--down)',fontWeight:600}}, ((cur-prev)>=0?'+':'')+pct((cur-prev)/prev*100)) : '—')
    );

    return e('div', null,
      e('div',{style:{fontSize:11.5,color:'var(--text-mute)',marginBottom:16}}, 'Revenue = billable appointments × client rate (from client config). Agent cost = held appointments × agent rate. Lead/data costs not yet in system — margin labeled accordingly.'),
      e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:20} },
        e('div', { style:{padding:'12px 16px',borderBottom:'1px solid var(--border)'} },
          e('table', { style:{width:'100%',borderCollapse:'collapse'} },
            e('thead', null, e('tr', null,
              ['Metric','This Month','Prev Month','Change'].map(h=>e('th',{key:h,style:{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.06em'}},h))
            )),
            e('tbody', null,
              row('Billable Revenue', cur.rev, prev.rev, euro, 'Revenue from billable appointments (not cancel/no-show) × client rate from config'),
              row('Held Appointments', cur.billableCount, prev.billableCount, v=>num(v)+' appts', 'Count of billable appointments'),
              row('Agent Cost', cur.cost, prev.cost, euro, 'Sum of agent rates for held appointments'),
              row('Contribution Profit', cur.contrib, prev.contrib, euro, 'Billable Revenue − Agent Cost. Does not include lead/data costs.'),
              row('Margin (excl. lead costs)', cur.margin!=null?cur.margin:0, prev.margin!=null?prev.margin:0, v=>pct(v), 'Contribution Profit / Billable Revenue × 100. Lead costs not included.'),
              row('Invoiced Revenue', cur.invRev, prev.invRev, euro, 'Revenue attached to appointments marked invoiced=true'),
              row('Collected Revenue', cur.paidRev, prev.paidRev, euro, 'Revenue attached to appointments marked paid=true'),
            )
          )
        )
      ),
      /* per-client breakdown */
      e('div', { style:{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'} },
        e('div',{style:{padding:'12px 16px',fontSize:11,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',borderBottom:'1px solid var(--border)'}}, 'Revenue by Client — This Month'),
        e('div', { style:{overflowX:'auto'} },
          e('table', { style:{width:'100%',borderCollapse:'collapse',fontSize:12} },
            e('thead', null, e('tr', null,
              ['Client','Billable Appts','Revenue','Agent Cost','Contribution','Margin'].map(h=>e('th',{key:h,style:{padding:'7px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.06em',borderBottom:'1px solid var(--border)'}},h))
            )),
            e('tbody', null,
              (clients||[]).filter(c=>c.status==='active').map(cl=>{
                const mtdAppts=(appts||[]).filter(a=>a.client===cl.id&&(a.dateLog||'').startsWith(ym));
                const bill=mtdAppts.filter(M.isBillable); const h=mtdAppts.filter(M.isHeld);
                const r=bill.reduce((s,a)=>s+cRate(a),0); const c2=h.reduce((s,a)=>s+aRate(a),0);
                if(bill.length===0&&r===0) return null;
                return e('tr',{key:cl.id,style:{borderBottom:'1px solid var(--border-soft)'}},
                  e('td',{style:{padding:'7px 12px',fontWeight:600,color:'var(--text)'}},cl.name),
                  e('td',{style:{padding:'7px 12px',fontFamily:"'JetBrains Mono'"}},bill.length),
                  e('td',{style:{padding:'7px 12px',fontWeight:700,color:'var(--info)',fontFamily:"'JetBrains Mono'"}},euro(r)),
                  e('td',{style:{padding:'7px 12px',color:'var(--text-mute)',fontFamily:"'JetBrains Mono'"}},euro(c2)),
                  e('td',{style:{padding:'7px 12px',fontWeight:700,fontFamily:"'JetBrains Mono'",color:r-c2>=0?'var(--up)':'var(--down)'}},euro(r-c2)),
                  e('td',{style:{padding:'7px 12px',color:M.marginPct(r,c2)!=null&&M.marginPct(r,c2)>=50?'var(--up)':'var(--warn)'}},M.marginPct(r,c2)!=null?pct(M.marginPct(r,c2)):'—'),
                );
              }).filter(Boolean)
            )
          )
        )
      )
    );
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: ROADMAP
     ══════════════════════════════════════════════════════════════════════ */
  _tabRoadmap(d, s, {T, euro, daysRemaining, billableRevMTD, forecastEOM}) {
    const e = React.createElement;
    const phases = [
      {
        id:'p1', label:'Phase 1 — Foundation / Launch 2.0', color:'var(--accent)',
        target:'Operational clarity, data accuracy, B2B offer ready',
        kpis:['Dashboard live','B2B pricing defined','Acquisition machine started','Data systems clean'],
        status:'in_progress',
        milestones:[
          { label:'€100K Roadmap dashboard', done:true },
          { label:'Prospect CRM operational', done:true },
          { label:'WhatsApp reminders active', done:true },
          { label:'B2B rate card defined (€100–€150/appt)', done:false },
          { label:'Acquisition source tracking', done:false },
          { label:'Agent scorecard baseline', done:false },
        ]
      },
      {
        id:'p2', label:'Phase 2 — Prove', color:'var(--info)',
        target:'Consistent B2B sales + valid unit economics',
        kpis:['≥10 B2B sales calls/week','Validate €100–€150 price point','Show rate ≥70%','Margin ≥50%'],
        status:'upcoming',
        milestones:[
          { label:'First €100+ B2B client live', done:false },
          { label:'5+ held B2B sales meetings', done:false },
          { label:'Dial→Book rate validated', done:false },
          { label:'Agent productivity benchmark', done:false },
        ]
      },
      {
        id:'p3', label:'Phase 3 — Scale', color:'var(--warn)',
        target:'Increase B2B revenue mix, more clients, more agents',
        kpis:['≥40 sales meetings/week','≥5 active B2B clients','€50K+ monthly billable'],
        status:'upcoming',
        milestones:[
          { label:'Outbound volume at 700+/day', done:false },
          { label:'Sales team scaling', done:false },
          { label:'Agent team scaling', done:false },
          { label:'€50K monthly billable milestone', done:false },
        ]
      },
      {
        id:'p4', label:'Phase 4 — €100K Run Rate', color:'var(--up)',
        target: T.monthlyRevTarget.toLocaleString() + ' monthly billable, sustained',
        kpis:['€100K+ billable/month','≥60% margin','Predictable pipeline','Capacity to maintain'],
        status: forecastEOM >= T.monthlyRevTarget ? 'complete' : 'upcoming',
        milestones:[
          { label:'First €100K month', done: billableRevMTD >= T.monthlyRevTarget },
          { label:'Second consecutive €100K month', done:false },
          { label:'Sustainable hiring process', done:false },
          { label:'Diversified client base (<25% concentration)', done:false },
        ]
      }
    ];

    const statusLabel = { in_progress:'🔵 In Progress', upcoming:'⬜ Upcoming', complete:'✅ Complete' };

    return e('div', null,
      /* target summary */
      e('div', { style:{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap'} },
        this._card('Target Revenue', euro(T.monthlyRevTarget)+'/mo', 'recurring monthly billable', 'var(--info)'),
        this._card('Target Date', T.targetDate, daysRemaining+' days remaining', 'var(--text)'),
        this._card('Current Forecast', euro(forecastEOM)+'/mo', 'based on MTD pace', forecastEOM>=T.monthlyRevTarget*0.7?'var(--up)':'var(--warn)'),
      ),
      /* phases */
      phases.map(ph => e('div', { key:ph.id, style:{background:'var(--surface)',border:'1px solid var(--border)',borderLeft:'4px solid '+ph.color,borderRadius:12,padding:'18px 20px',marginBottom:16} },
        e('div', { style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12} },
          e('div', null,
            e('div', { style:{fontSize:14,fontWeight:800,color:'var(--text)',marginBottom:3} }, ph.label),
            e('div', { style:{fontSize:12,color:'var(--text-mute)'} }, ph.target)
          ),
          e('div', { style:{fontSize:11,fontWeight:700,color:ph.color,padding:'3px 8px',borderRadius:6,border:'1px solid '+ph.color,flexShrink:0} }, statusLabel[ph.status])
        ),
        e('div', { style:{display:'flex',gap:20,flexWrap:'wrap'} },
          e('div', { style:{flex:'1 1 200px'} },
            e('div', { style:{fontSize:10.5,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6} }, 'KPI Requirements'),
            ph.kpis.map((k,i) => e('div', { key:i, style:{fontSize:12,color:'var(--text-dim)',marginBottom:3} }, '· ' + k))
          ),
          e('div', { style:{flex:'1 1 200px'} },
            e('div', { style:{fontSize:10.5,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6} }, 'Milestones'),
            ph.milestones.map((m,i) => e('div', { key:i, style:{display:'flex',alignItems:'center',gap:6,fontSize:12,marginBottom:3,color:m.done?'var(--text)':'var(--text-mute)'} },
              e('span', { style:{fontSize:10} }, m.done ? '✅' : '⬜'),
              m.label
            ))
          )
        )
      ))
    );
  },

  /* ══════════════════════════════════════════════════════════════════════
     TAB: DATA HEALTH
     ══════════════════════════════════════════════════════════════════════ */
  _tabHealth(d, s, {appts, clients, agents, dialsMap, euro, pct, num, cRate, aRate, ym, today, billableRevMTD, agentCostMTD, contribMTD}) {
    const e = React.createElement;
    const M = this._M;
    const checks = [];

    /* check 1: appointments with no rate */
    const noRate = (appts||[]).filter(a=>M.isBillable(a)&&cRate(a)===0);
    checks.push({
      label: 'Billable appointments with €0 rate',
      value: noRate.length,
      status: noRate.length === 0 ? 'green' : noRate.length < 5 ? 'yellow' : 'red',
      detail: noRate.length > 0 ? `${noRate.length} billable appointments have no rate configured. Check client config.` : 'All billable appointments have a rate. ✓',
    });

    /* check 2: agents with no rates */
    const agentsNoRate = (agents||[]).filter(a=>!a.offboarded&&Object.keys(a.rates||{}).length===0);
    checks.push({
      label: 'Active agents with no rate configured',
      value: agentsNoRate.length,
      status: agentsNoRate.length === 0 ? 'green' : 'yellow',
      detail: agentsNoRate.length > 0 ? `Agents: ${agentsNoRate.map(a=>a.name).join(', ')}` : 'All active agents have rates. ✓',
    });

    /* check 3: appointments with missing agent */
    const orphanAppts = (appts||[]).filter(a=>a.agent&&!(agents||[]).find(ag=>ag.id===a.agent));
    checks.push({
      label: 'Appointments referencing unknown agent',
      value: orphanAppts.length,
      status: orphanAppts.length === 0 ? 'green' : 'yellow',
      detail: orphanAppts.length > 0 ? orphanAppts.length+' appointments reference an agent not in the agents list.' : '✓',
    });

    /* check 4: appointments with missing client */
    const orphanClients = (appts||[]).filter(a=>!(clients||[]).find(c=>c.id===a.client));
    checks.push({
      label: 'Appointments referencing unknown client',
      value: orphanClients.length,
      status: orphanClients.length === 0 ? 'green' : 'yellow',
      detail: orphanClients.length > 0 ? orphanClients.length+' appointments reference a client not in the clients list.' : '✓',
    });

    /* check 5: P&L reconciliation */
    const impliedContrib = billableRevMTD - agentCostMTD;
    const drift = Math.abs(impliedContrib - contribMTD);
    checks.push({
      label: 'P&L reconciliation (billable rev − agent cost = contribution)',
      value: drift < 0.01 ? 'OK' : euro(drift),
      status: drift < 0.01 ? 'green' : 'red',
      detail: drift < 0.01 ? 'Billable Revenue − Agent Cost = Contribution Profit. Reconciled. ✓' : `Discrepancy of ${euro(drift)} detected. Check calculation logic.`,
    });

    /* check 6: dial data freshness */
    const lastDialDate = Object.values(dialsMap||{}).flatMap(m=>Object.keys(m)).sort().reverse()[0]||null;
    const dialAge = lastDialDate ? Math.round((new Date()-new Date(lastDialDate))/86400000) : 999;
    checks.push({
      label: 'Dial data freshness',
      value: lastDialDate || 'No data',
      status: dialAge <= 1 ? 'green' : dialAge <= 3 ? 'yellow' : 'red',
      detail: lastDialDate ? `Last dial record: ${lastDialDate} (${dialAge} day(s) ago)` : 'No dial data found. CloudTalk sync may be failing.',
    });

    /* check 7: lead/data costs missing */
    checks.push({
      label: 'Lead/data costs',
      value: 'Not in system',
      status: 'yellow',
      detail: 'Lead and data purchase costs are not tracked in the platform yet. Margin is labeled "before lead/data costs".',
    });

    /* check 8: no prospects on meta pipeline with no lead_id */
    const metaNoId = (d.prospects||[]).filter(p=>p.pipeline_id==='meta_ads'&&!p.lead_id);
    checks.push({
      label: 'Meta Ads leads missing lead_id',
      value: metaNoId.length,
      status: metaNoId.length === 0 ? 'green' : 'yellow',
      detail: metaNoId.length > 0 ? metaNoId.length+' Meta Ads prospects have no lead_id — may be manually added.' : '✓ All Meta leads have lead_id.',
    });

    const overall = checks.some(c=>c.status==='red') ? 'red' : checks.some(c=>c.status==='yellow') ? 'yellow' : 'green';
    const overallColor = { red:'var(--down)', yellow:'var(--warn)', green:'var(--up)' }[overall];
    const overallLabel = { red:'⚠ Data Issues Detected', yellow:'⚡ Some Data Gaps', green:'✓ Data Health Good' }[overall];

    return e('div', null,
      e('div', { style:{background:'var(--surface)',border:'2px solid '+overallColor,borderRadius:12,padding:'16px 18px',marginBottom:20,display:'flex',alignItems:'center',gap:12} },
        e('div', { style:{fontSize:16,fontWeight:800,color:overallColor} }, overallLabel),
        e('div', { style:{fontSize:12,color:'var(--text-mute)',flex:1} }, checks.filter(c=>c.status!=='green').length + ' checks need attention.')
      ),
      e('div', { style:{display:'flex',flexDirection:'column',gap:10} },
        checks.map((c,i) => {
          const color = { green:'var(--up)', yellow:'var(--warn)', red:'var(--down)' }[c.status];
          return e('div', { key:i, style:{background:'var(--surface)',border:'1px solid var(--border)',borderLeft:'4px solid '+color,borderRadius:10,padding:'12px 14px'} },
            e('div', { style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4} },
              e('div', { style:{fontSize:12.5,fontWeight:600,color:'var(--text)'} }, c.label),
              e('div', { style:{fontSize:12,fontWeight:700,color:color,fontFamily:"'JetBrains Mono'",flexShrink:0,marginLeft:12} }, c.value!=null?String(c.value):'—')
            ),
            e('div', { style:{fontSize:11.5,color:'var(--text-mute)'} }, c.detail)
          );
        })
      ),
      /* data requirements checklist */
      e('div', { style:{marginTop:24,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'18px 20px'} },
        e('div', { style:{fontSize:12,fontWeight:700,color:'var(--text-mute)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:12} }, 'What You Need to Connect for Perfect Data'),
        [
          { done:true,  label:'Appointments table with status (open/show/no_show/cancel)' },
          { done:true,  label:'Client config with rate per project/subclient' },
          { done:true,  label:'Agent config with rates per client' },
          { done:true,  label:'Dials table synced from CloudTalk' },
          { done:true,  label:'Prospect CRM for IS own sales pipeline' },
          { done:true,  label:'WhatsApp message log' },
          { done:false, label:'Lead/data purchase costs (add to platform_settings or a costs table)' },
          { done:false, label:'B2B appointments tagged distinctly from B2C (add type field to appointments)' },
          { done:false, label:'Acquisition source on prospects (currently manual entry in Bron field)' },
          { done:false, label:'Sales meeting outcome tracking (add outcome field to prospect stage changes)' },
          { done:false, label:'Invoice amounts stored (currently only invoiced=true/false, not invoice value)' },
          { done:false, label:'Agent scheduled hours (for utilization % calculation)' },
          { done:false, label:'Meta Ads webhook: subscribe Facebook Page to leadgen webhook (see whatsapp.js setup)' },
          { done:false, label:'Automatic dial sync from CloudTalk (verify cron job is running daily)' },
        ].map((item, i) => e('div', { key:i, style:{display:'flex',gap:8,alignItems:'flex-start',marginBottom:7,fontSize:12} },
          e('span', { style:{flexShrink:0, marginTop:1} }, item.done ? '✅' : '⬜'),
          e('span', { style:{color:item.done?'var(--text)':'var(--text-mute)'} }, item.label)
        ))
      )
    );
  },

};
