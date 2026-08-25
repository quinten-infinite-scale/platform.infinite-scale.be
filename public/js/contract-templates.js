window.ContractTemplates = {

  generate(ctype, isAgent, vars) {
    const slug = this._slug(ctype, isAgent);
    const override = window.__ctplOverrides && window.__ctplOverrides[slug];
    if (override) {
      try {
        const computedVars = this._computeVars(ctype, isAgent, vars);
        const body = this._renderTpl(override, computedVars);
        return this._wrap(body, vars);
      } catch(e) { console.error('Template render error', e); }
    }
    if (ctype === 'Addendum') return this._wrap(this._addendum(vars), vars);
    if (!isAgent && ctype === 'Pilot — Leadopvolging') return this._wrap(this._pilotLeadopvolgingTemplate(vars || {}), vars);
    if (!isAgent && ctype === 'Pilot — Cold Calling') return this._wrap(this._coldCallingPilotTemplate(vars || {}), vars);
    if (!isAgent && (ctype === 'Pilot' || ctype === 'client-pilot')) return this._wrap(this._pilotTemplate(vars || {}), vars);
    if (isAgent && ctype === 'Standaardcontract') return this._wrap(this._agentStandard(vars), vars);
    if (isAgent && ctype === 'Addendum — Per afspraak') return this._wrap(this._agentAddendumPerAfspraak(vars), vars);
    if (isAgent && ctype === 'Addendum — Commissie') return this._wrap(this._agentAddendumCommissie(vars), vars);
    if (isAgent && ctype === 'Addendum — Uurtarief') return this._wrap(this._agentAddendumUurtarief(vars), vars);
    const body = isAgent ? this._agent(ctype, vars) : this._client(ctype, vars);
    return this._wrap(body, vars);
  },

  _slug(ctype, isAgent) {
    if (!isAgent) {
      if (ctype === 'Cold calling' || ctype === 'Cold Calling') return 'client-cold-calling';
      if (ctype === 'Pay per appointment' || ctype === 'Pay per Appointment') return 'client-pay-per-appointment';
      if (ctype === 'Commissie' || ctype === 'Commission') return 'client-commissie';
      if (ctype === 'Pilot — Leadopvolging') return 'client-pilot-leadopvolging';
    if (ctype === 'Pilot — Cold Calling') return 'client-pilot-cold-calling';
    if (ctype === 'Pilot') return 'client-pilot';
      if (ctype === 'Maandelijks abonnement' || ctype === 'Maandelijks') return 'client-maandelijks';
      return 'client'; // fallback for older/unknown client ctypes
    }
    if (ctype === 'Standaardcontract') return 'agent-standard';
    if (ctype === 'Addendum — Per afspraak') return 'addendum-per-afspraak';
    if (ctype === 'Addendum — Commissie') return 'addendum-commissie';
    if (ctype === 'Addendum — Uurtarief') return 'addendum-uurtarief';
    if (ctype === 'Addendum') return 'addendum';
    return 'agent';
  },

  _renderTpl(body, vars) {
    return body
      .replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, k, c) => vars[k] ? c : '')
      .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] != null ? String(vars[k]) : '');
  },

  _computeVars(ctype, isAgent, raw) {
    const rate = raw.rate;
    const rateStr = rate ? `€ ${rate},00 excl. btw per effectief doorgegane afspraak` : '(zie overeenkomst)';
    const termDays = raw.paymentTerm || 14;
    return { ...raw, rateStr, termDays };
  },

  _wrap(body, { date } = {}) {
    const d = date || new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
    return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.65; color: #1a1a1a; background: #fff; padding: 40px 56px; max-width: 800px; margin: 0 auto; }

  /* Header */
  .doc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding-bottom: 18px; border-bottom: 2px solid #1a1a1a; }
  .doc-header-logo { display: flex; align-items: center; gap: 10px; }
  .doc-header-logo img { width: 36px; height: 36px; }
  .doc-header-logo span { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
  .doc-header-meta { font-size: 9pt; color: #555; text-align: right; line-height: 1.5; }

  /* Title */
  .doc-title { font-size: 15pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; text-align: center; margin-bottom: 4px; }
  .doc-subtitle { font-size: 11pt; color: #444; text-align: center; margin-bottom: 28px; }

  /* Parties */
  .parties-box { border: 1px solid #ccc; border-radius: 4px; margin-bottom: 28px; overflow: hidden; }
  .parties-box-title { background: #1a1a1a; color: #fff; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; padding: 8px 16px; }
  .party-row { display: flex; gap: 0; border-top: 1px solid #e0e0e0; }
  .party-row:first-of-type { border-top: none; }
  .party-num { width: 26px; background: #f5f5f5; display: flex; align-items: flex-start; justify-content: center; padding: 12px 4px; font-weight: 700; font-size: 10pt; color: #333; border-right: 1px solid #e0e0e0; flex-shrink: 0; }
  .party-info { padding: 12px 16px; font-size: 10pt; line-height: 1.55; flex: 1; }
  .party-info strong { font-weight: 700; }
  .party-label { display: inline-block; background: #1a1a1a; color: #fff; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; padding: 2px 7px; border-radius: 2px; margin-top: 4px; }

  /* Articles */
  .article { margin-bottom: 20px; }
  .article-title { font-size: 10.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; padding-bottom: 5px; border-bottom: 1.5px solid #1a1a1a; margin-bottom: 10px; }
  .article-title .art-num { margin-right: 8px; }
  p { margin-bottom: 8px; }
  ul { margin: 6px 0 8px 20px; }
  ul li { margin-bottom: 4px; }

  /* Highlight */
  .highlight { background: #f7f7f0; border-left: 3px solid #b8a000; padding: 10px 14px; margin: 10px 0; font-size: 10.5pt; }

  /* Signature */
  .sig-section { margin-top: 40px; }
  .sig-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 16px; color: #555; }
  .sig-block { display: inline-block; min-width: 260px; }
  .sig-label { font-size: 10pt; font-weight: 700; margin-bottom: 6px; }
  .sig-sublabel { font-size: 9.5pt; color: #555; margin-bottom: 50px; }
  .sig-line { border-top: 1px solid #333; padding-top: 6px; font-size: 9.5pt; color: #444; }

  .dated { font-size: 9.5pt; color: #555; margin-top: 20px; }
  .notes-block { background: #f0f7ff; border-left: 3px solid #3a7bd5; padding: 10px 14px; margin: 10px 0; font-size: 10.5pt; white-space: pre-wrap; }

  @media print { body { padding: 20px 32px; } }
</style></head><body>${body}<p class="dated">Opgemaakt op ${d}</p></body></html>`;
  },

  _client(ctype, { party, contact, email, vat, address, rate, duration, paymentTerm, notes, setupFee, aiScopeAddition, aiSpecialConditions, aiDurationNote }) {
    const rateStr = rate ? `€ ${rate},00 excl. btw per effectief doorgegane afspraak` : '(zie overeenkomst)';
    const termDays = paymentTerm || 14;
    const isPilot = ctype === 'Pilot';
    const duurText = duration
      ? duration
      : isPilot
        ? 'Pilootperiode van twee (2) maanden te rekenen vanaf de effectieve startdatum. Daarna stilzwijgend verlengd per 6 maanden, opzegbaar met 30 dagen schriftelijke opzegging.'
        : 'Onbepaalde duur, opzegbaar met 30 dagen schriftelijke opzegging.';

    const ctypeLabel = {
      'Pilot': 'Leadopvolging & Appointment Setting — Pilot',
      'Pay per appointment': 'Leadopvolging & Appointment Setting',
      'Contract': 'Dienstverleningsovereenkomst',
      'Lead follow-up': 'Leadopvolging',
      'Cold calling': 'Cold Calling Diensten',
      'Commission': 'Commissieovereenkomst',
      'Hybrid (fee + commission)': 'Hybride Dienstverleningsovereenkomst',
    }[ctype] || 'Dienstverleningsovereenkomst';

    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Dienstverleningsovereenkomst</p>
<p class="doc-subtitle">${ctypeLabel}</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${party || '—'}</strong>${vat ? `, BTW nr. ${vat}` : ''}${address ? `, gevestigd te ${address}` : ''}${contact ? `, rechtsgeldig vertegenwoordigd door ${contact}` : ''}, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen". Deze overeenkomst vervangt alle voorgaande afspraken over hetzelfde voorwerp.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Dienstverlener verzorgt telefonische leadopvolging, kwalificatie van inkomende en/of outbound leads en het inplannen van afspraken in de agenda van de Opdrachtgever (hierna: "de Diensten"). De Dienstverlener treedt op als zelfstandige en schept geen arbeidsrechtelijke verhouding.</p>
  ${isPilot ? '<p>Deze overeenkomst heeft betrekking op een pilootperiode om de samenwerking en kwaliteit van de Diensten te evalueren alvorens een langduriger engagement aan te gaan.</p>' : ''}
  ${aiScopeAddition ? `<p>${aiScopeAddition}</p>` : ''}
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Duur</div>
  <p>${duurText}</p>
  <p>Operationele start 3 tot 5 werkdagen na kick-off. ${isPilot ? 'Vroegtijdige beëindiging tijdens de pilot mits 14 dagen schriftelijke kennisgeving.' : ''}${aiDurationNote ? ' ' + aiDurationNote : ''}</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  <div class="highlight"><strong>${rateStr}</strong></div>
  ${setupFee ? `<div class="highlight">Eenmalige opstartvergoeding: <strong>€ ${setupFee},00 excl. btw</strong> — verschuldigd bij aanvang van de samenwerking.</div>` : ''}
  <p>Een afspraak is factureerbaar wanneer de lead aanwezig was op het afgesproken tijdstip (show-up).${setupFee ? '' : ' Geen opstartkosten of vaste maandkost.'}</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>No-shows en Annulaties</div>
  <ul>
    <li><strong>Lead annuleert / no-show:</strong> Opdrachtgever meldt dit binnen 24 uur schriftelijk. Dienstverlener herneemt contact en tracht opnieuw in te plannen. Lukt dit niet — niet gefactureerd. Geen melding binnen 24 uur = automatisch gefactureerd.</li>
    <li><strong>Opdrachtgever annuleert afspraak:</strong> Altijd gefactureerd, ongeacht tijdstip van melding.</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>Facturatie</div>
  <p>Maandelijks, einde kalendermaand. Vijf (5) dagen vóór factuurdatum ontvangt de Opdrachtgever een overzicht ter review. Geen reactie binnen 5 dagen = goedgekeurd.</p>
  <p><strong>Betaaltermijn: ${termDays} kalenderdagen.</strong> Bij laattijdige betaling is verwijlintrest verschuldigd conform de Wet van 2 augustus 2002 betreffende de bestrijding van betalingsachterstand, verhoogd met een forfaitaire vergoeding van € 40,00 per factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Verplichtingen</div>
  <p><strong>Dienstverlener:</strong> voert diensten uit als goed vakman, organiseert een kick-off, traint ingezette medewerkers, rapporteert maandelijks en verwerkt persoonsgegevens conform AVG/GDPR.</p>
  <p><strong>Opdrachtgever:</strong> verstrekt tijdig alle nodige informatie, toegangen en scripts; zorgt voor rechtmatige leads conform AVG/GDPR; meldt no-shows tijdig; betaalt facturen tijdig.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Gegevensbescherming & Vertrouwelijkheid</div>
  <p>Dienstverlener treedt op als verwerker (AVG/GDPR) en geeft persoonsgegevens terug of vernietigt ze na beëindiging. Opdrachtgever is verwerkingsverantwoordelijke en vrijwaart Dienstverlener voor aanspraken wegens onrechtmatige verwerking door de Opdrachtgever.</p>
  <p>Beide Partijen behandelen alle vertrouwelijke informatie strikt vertrouwelijk gedurende de looptijd en twee (2) jaar erna.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Niet-benadering</div>
  <p>Gedurende de looptijd en 12 maanden erna mag de Opdrachtgever door de Dienstverlener ingezette medewerkers niet rechtstreeks benaderen, rekruteren of in dienst nemen, noch rechtstreeks of onrechtstreeks diensten afnemen die gelijkaardig zijn aan de Diensten. Bij overtreding is een forfaitaire schadevergoeding verschuldigd van <strong>€ 10.000,00 per inbreuk</strong>, onverminderd het recht op hogere schadeloosstelling.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">9.</span>Aansprakelijkheid & Beëindiging</div>
  <p>De aansprakelijkheid van de Dienstverlener is beperkt tot het bedrag dat de Opdrachtgever in de drie (3) maanden vóór het schadegeval heeft betaald. Geen aansprakelijkheid voor indirecte schade of gederfde winst.</p>
  <p>Beëindiging met onmiddellijke ingang mogelijk bij ernstige tekortkoming die niet hersteld is binnen 15 dagen na schriftelijke ingebrekestelling. Bij twee (2) onbetaalde facturen kan de Dienstverlener zijn diensten opschorten of de overeenkomst beëindigen. Bij beëindiging zijn alle openstaande facturen onmiddellijk opeisbaar.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">10.</span>Toepasselijk Recht & Overige</div>
  <p>Belgisch recht is van toepassing. Partijen streven een minnelijke schikking na binnen 30 dagen. Bij mislukking: Rechtbank van Onderneming van het arrondissement van de Dienstverlener.</p>
  <p>Wijzigingen zijn enkel geldig indien schriftelijk overeengekomen en ondertekend door beide Partijen. Nietigheid van een bepaling tast de overige bepalingen niet aan.</p>
</div>

${notes || aiSpecialConditions ? `<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">${[notes, aiSpecialConditions].filter(Boolean).join('\n\n')}</div></div>` : ''}

<div class="sig-section">
  <p class="sig-title">Handtekening</p>
  <p style="font-size:10.5pt;margin-bottom:24px;">Beide Partijen verklaren de inhoud van deze overeenkomst te hebben gelezen, begrepen en ermee akkoord te gaan.</p>
  <div class="sig-block">
    <p class="sig-label">${party || 'Opdrachtgever'}</p>
    <p class="sig-sublabel">${contact || ''}</p>
    <div class="sig-line">Handtekening &amp; datum</div>
  </div>
</div>`;
  },

  _agent(ctype, { agentName, email, vat, rate, duration, paymentTerm, notes }) {
    const rateStr = rate ? `€ ${rate},00 excl. btw per effectief doorgegane afspraak` : '(zie overeenkomst)';
    const termDays = paymentTerm || 14;
    const ctypeLabel = {
      'Service agreement': 'Zelfstandige Samenwerkingsovereenkomst',
      'Commission': 'Commissieovereenkomst',
      'Hourly rate': 'Uurtariefovereenkomst',
    }[ctype] || 'Zelfstandige Samenwerkingsovereenkomst';

    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Zelfstandige Samenwerkingsovereenkomst</p>
<p class="doc-subtitle">${ctypeLabel} — Leadopvolging & Appointment Setting</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${agentName || '—'}</strong>${vat ? `, BTW nr. ${vat}` : ''}, hierna te noemen:<br>
      <span class="party-label">Opdrachtnemer</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen". Deze overeenkomst vervangt alle voorgaande afspraken over hetzelfde voorwerp.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Opdrachtnemer treedt op als zelfstandige en verleent in opdracht van Infinite Scale diensten op het vlak van telefonische leadopvolging, prospectie en het inplannen van verkoopafspraken voor klanten van Infinite Scale. Er bestaat geen arbeidsrechtelijke verhouding tussen de Partijen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Taken</div>
  <ul>
    <li>Outbound cold calling en e-mailprospectie conform de campagnebriefing</li>
    <li>Kwalificatie van prospects op basis van het afgesproken Ideal Customer Profile (ICP)</li>
    <li>Inplannen van bevestigde afspraken voor klanten van Infinite Scale</li>
    <li>Dagelijkse activiteitsrapportage via het platform</li>
    <li>Deelname aan teamoverleg en check-ins</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  <div class="highlight"><strong>${rateStr}</strong></div>
  <p>Een afspraak is bevestigd wanneer een gekwalificeerde prospect de uitnodiging heeft aanvaard en de afspraak daadwerkelijk heeft plaatsgevonden. No-shows door de prospect binnen 24 uur voor de afspraak worden niet vergoed. Betaling geschiedt binnen <strong>${termDays} kalenderdagen</strong> na ontvangst van de factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>Duur</div>
  <p>${duration || 'Onbepaalde duur, opzegbaar met 7 dagen schriftelijke opzegging.'}.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>Statuut Zelfstandige</div>
  <p>De Opdrachtnemer is als zelfstandige verantwoordelijk voor zijn/haar eigen sociale bijdragen, belastingen en verzekeringen. De Opdrachtnemer dient te beschikken over een geldig ondernemingsnummer en BTW-nummer indien van toepassing.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Exclusiviteit & Niet-concurrentie</div>
  <p>Tijdens de looptijd mag de Opdrachtnemer geen gelijkaardige diensten verlenen aan directe concurrenten van actieve klanten van Infinite Scale zonder voorafgaande schriftelijke toestemming. Gedurende de looptijd en 12 maanden erna mag de Opdrachtnemer klanten van Infinite Scale niet rechtstreeks benaderen of diensten aanbieden. Bij overtreding is een forfaitaire schadevergoeding verschuldigd van <strong>€ 10.000,00 per inbreuk</strong>.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Gegevensbescherming & Vertrouwelijkheid</div>
  <p>De Opdrachtnemer verbindt zich ertoe alle vertrouwelijke informatie — inclusief klantgegevens, scripts, werkwijzen en bedrijfsinformatie — strikt vertrouwelijk te behandelen gedurende de looptijd en twee (2) jaar erna. Persoonsgegevens worden uitsluitend verwerkt conform de AVG/GDPR en de instructies van Infinite Scale.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Kwaliteitsnormen</div>
  <p>De Opdrachtnemer verbindt zich tot het naleven van de door Infinite Scale vastgestelde kwaliteitsnormen, inclusief minimum dagelijkse activiteitsdoelstellingen, scriptconformiteit en professionele communicatie. Herhaald niet-naleven kan aanleiding geven tot onmiddellijke beëindiging.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">9.</span>Beëindiging & Aansprakelijkheid</div>
  <p>Beide Partijen kunnen de overeenkomst beëindigen met 7 dagen schriftelijke opzegging. Infinite Scale kan de overeenkomst met onmiddellijke ingang beëindigen bij wangedrag of ernstige tekortkoming. Openstaande verdiende vergoedingen worden uitbetaald bij beëindiging.</p>
  <p>De aansprakelijkheid van de Opdrachtnemer is beperkt tot het bedrag dat in de drie (3) maanden vóór het schadegeval werd uitbetaald. Geen aansprakelijkheid voor indirecte schade.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">10.</span>Toepasselijk Recht & Overige</div>
  <p>Belgisch recht is van toepassing. Geschillen worden in eerste instantie minnelijk geregeld. Bij mislukking: Rechtbank van Onderneming van het arrondissement van Infinite Scale.</p>
  <p>Wijzigingen zijn enkel geldig indien schriftelijk overeengekomen. Nietigheid van een bepaling tast de overige niet aan.</p>
</div>

${notes ? `<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">${notes}</div></div>` : ''}

<div class="sig-section">
  <p class="sig-title">Handtekening</p>
  <p style="font-size:10.5pt;margin-bottom:24px;">Beide Partijen verklaren de inhoud van deze overeenkomst te hebben gelezen, begrepen en ermee akkoord te gaan.</p>
  <div class="sig-block">
    <p class="sig-label">${agentName || 'Opdrachtnemer'}</p>
    <p class="sig-sublabel">&nbsp;</p>
    <div class="sig-line">Handtekening &amp; datum</div>
  </div>
</div>`;
  },

  _agentStandard({ agentName, agentAddress, agentVat }) {
    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Overeenkomst Zelfstandige Dienstverlening</p>
<p class="doc-subtitle">Raamovereenkomst — vergoedingen per Addendum</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${agentName || '—'}</strong>${agentVat ? ', ondernemingsnr. ' + agentVat : ''}${agentAddress ? ', gevestigd te ' + agentAddress : ''}, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen".</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Dienstverlener verbindt zich ertoe om, als zelfstandige en in volledige onafhankelijkheid, diensten te verlenen op het vlak van telefonische prospectie, leadopvolging en/of appointment setting voor klanten van de Opdrachtgever, conform de specifieke projectopdrachten zoals omschreven in afzonderlijke Addenda bij deze overeenkomst.</p>
  <p>De Dienstverlener treedt op als zelfstandige ondernemer. Er bestaat geen arbeidsrechtelijke verhouding, gezagsrelatie of enige andere band van ondergeschiktheid tussen de Partijen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Verplichtingen Dienstverlener</div>
  <ul>
    <li>De Dienstverlener verleent de overeengekomen diensten met de nodige professionele zorg en vakkennis.</li>
    <li>De Dienstverlener is als zelfstandige verantwoordelijk voor eigen sociale bijdragen, belastingen en verzekeringsverplichtingen.</li>
    <li>De Dienstverlener beschikt over een geldig ondernemingsnummer en is, indien van toepassing, BTW-plichtig.</li>
    <li>De Dienstverlener zorgt zelf voor de nodige materialen en middelen (computer, telefoon, internetverbinding) tenzij anders overeengekomen.</li>
    <li>De Dienstverlener meldt tijdig aan de Opdrachtgever wanneer de uitvoering van opdrachten vertraging oploopt of onmogelijk wordt.</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  <p>De vergoeding voor de verleende diensten wordt per project afzonderlijk vastgesteld in een Addendum bij deze overeenkomst. Elk Addendum bevat de specifieke tarieven, prestatievereisten en facturatievoorwaarden voor het betrokken project.</p>
  <p>Facturen worden uitbetaald binnen de termijn zoals vermeld in het toepasselijke Addendum, na ontvangst van een correcte factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>Duur en Beëindiging</div>
  <p>Deze overeenkomst wordt gesloten voor onbepaalde duur en treedt in werking op de datum van ondertekening. Elk afzonderlijk project heeft zijn eigen looptijd zoals bepaald in het bijhorende Addendum.</p>
  <p>Elk der Partijen kan deze overeenkomst beëindigen met een uitlooptermijn van <strong>14 kalenderdagen</strong>, schriftelijk meegedeeld per e-mail of aangetekende brief. Beëindiging van de raamovereenkomst impliceert tevens de beëindiging van alle lopende Addenda, tenzij anders overeengekomen. De uitlooptermijn houdt in de nodige dagelijkse input, per project bepaald aan de hand van het toepasselijke Addendum.<br>Opzegging zonder termijn door Dienstverlener: forfaitaire schadevergoeding van <strong>EUR 1.000</strong>.</p>
  <p>De Opdrachtgever kan de overeenkomst met onmiddellijke ingang beëindigen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>Exclusiviteit en Niet-concurrentie</div>
  <p>Tijdens de duur van deze overeenkomst en gedurende <strong>12 maanden</strong> na beëindiging ervan, is de Dienstverlener verboden om, rechtstreeks of onrechtstreeks, klanten van de Opdrachtgever te benaderen of hen gelijkaardige diensten aan te bieden buiten het kader van deze overeenkomst.</p>
  <p>Bij overtreding van dit beding is de Dienstverlener van rechtswege een forfaitaire schadevergoeding verschuldigd van <strong>&euro; 20.000,00 per vastgestelde inbreuk</strong>, onverminderd het recht van de Opdrachtgever om een hogere schade te bewijzen en te vorderen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Vertrouwelijkheid en Gegevensbescherming</div>
  <p>De Dienstverlener verbindt zich ertoe, tijdens en tot <strong>5 jaar</strong> na beëindiging van deze overeenkomst, alle bedrijfsinformatie van Opdrachtgever en diens klanten strikt vertrouwelijk te houden.</p>
  <p>De Dienstverlener verbindt zich ertoe, tijdens en tot <strong>2 jaar</strong> na beëindiging:</p>
  <ul>
    <li>Persoonsgegevens uitsluitend te verwerken volgens instructies en GDPR, en Opdrachtgever onmiddellijk te informeren bij datalekken;</li>
    <li>Geen callcenter-, appointment setting- of gelijkaardige diensten aan te bieden aan klanten van Opdrachtgever;</li>
    <li>Geen medewerkers of andere dienstverleners van Opdrachtgever te benaderen of af te werven.</li>
  </ul>
  <p>De Dienstverlener verbindt zich ertoe, tijdens en tot <strong>1 jaar</strong> na beëindiging van de samenwerking met een specifieke klant, niet rechtstreeks of onrechtstreeks voor die klant te werken buiten deze overeenkomst om.</p>
  <p>Bij schending van enige bepaling van dit artikel: forfaitaire schadevergoeding van <strong>EUR 50.000,00</strong>, onverminderd het recht op vergoeding van hogere werkelijk geleden schade. De Dienstverlener vrijwaart Opdrachtgever tegen alle vorderingen en boetes van derden.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Aansprakelijkheid</div>
  <p>De Dienstverlener is aansprakelijk voor schade voortvloeiend uit niet-nakoming van deze overeenkomst.</p>
  <p>De Dienstverlener vrijwaart Opdrachtgever tegen claims van eindklanten voortvloeiend uit fouten of nalatigheden van de Dienstverlener.</p>
  <p>Indien Opdrachtgever financieel nadeel ondervindt door handelingen of nalatigheden van Dienstverlener bij een specifiek project (gederfde inkomsten, schadeclaims, terugbetalingen aan eindklanten), kan Opdrachtgever dit verhalen op Dienstverlener naar evenredigheid van diens betrokkenheid.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Toepasselijk Recht en Geschillenbeslechting</div>
  <p>Deze overeenkomst wordt beheerst door het Belgisch recht. Alle geschillen worden in eerste instantie opgelost via minnelijk overleg. Indien geen minnelijke oplossing wordt bereikt, zijn de rechtbanken van het arrondissement van de maatschappelijke zetel van de Opdrachtgever bevoegd.</p>
  <p>Wijzigingen aan deze overeenkomst zijn slechts geldig indien schriftelijk vastgelegd en ondertekend door beide Partijen. De nietigheid van een bepaling tast de geldigheid van de overige bepalingen niet aan.</p>
</div>

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <p style="font-size:10.5pt;margin-bottom:24px;">Beide Partijen verklaren kennis te hebben genomen van de inhoud van deze overeenkomst en gaan hiermee uitdrukkelijk akkoord.</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">${agentName || 'Dienstverlener'}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`;
  },

  _agentAddendumPerAfspraak({ agentName, agentAddress, agentVat, rate, duration, paymentTerm, notes }) {
    const rateStr = rate ? `&euro; ${rate},00 excl. btw per geldige afspraak` : '(zie overeenkomst)';
    const termDays = paymentTerm || 14;
    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Addendum — Per Afspraak</p>
<p class="doc-subtitle">Aanvulling op de Overeenkomst Zelfstandige Dienstverlening</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${agentName || '—'}</strong>${agentVat ? ', ondernemingsnr. ' + agentVat : ''}${agentAddress ? ', gevestigd te ' + agentAddress : ''}, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Dit Addendum maakt integraal deel uit van de Overeenkomst Zelfstandige Dienstverlening en is onderworpen aan alle bepalingen daarvan, tenzij hieronder uitdrukkelijk anders bepaald.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Vergoeding</div>
  <div class="highlight"><strong>${rateStr}</strong></div>
  <p>Een afspraak is geldig wanneer de prospect aanwezig was op het afgesproken tijdstip en de afspraak daadwerkelijk heeft plaatsgevonden (show-up). No-shows worden niet vergoed. Betaling geschiedt binnen <strong>${termDays} kalenderdagen</strong> na ontvangst van een correcte factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Duur</div>
  <p>${duration || 'Dit Addendum loopt voor onbepaalde duur, opzegbaar met 7 kalenderdagen schriftelijke opzegging.'}</p>
</div>

${notes ? `<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">${notes}</div></div>` : ''}

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV — Infinite Scale</p>
      <p class="sig-sublabel">Opdrachtgever</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">${agentName || 'Dienstverlener'}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`;
  },

  _agentAddendumCommissie({ agentName, agentAddress, agentVat, rate, duration, paymentTerm, notes }) {
    const commStr = rate ? `${rate}% commissie op gefactureerde omzet` : '(zie overeenkomst)';
    const termDays = paymentTerm || 14;
    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Addendum — Commissieovereenkomst</p>
<p class="doc-subtitle">Aanvulling op de Overeenkomst Zelfstandige Dienstverlening</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${agentName || '—'}</strong>${agentVat ? ', ondernemingsnr. ' + agentVat : ''}${agentAddress ? ', gevestigd te ' + agentAddress : ''}, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Dit Addendum maakt integraal deel uit van de Overeenkomst Zelfstandige Dienstverlening en is onderworpen aan alle bepalingen daarvan, tenzij hieronder uitdrukkelijk anders bepaald.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Commissievergoeding</div>
  <div class="highlight"><strong>${commStr}</strong></div>
  <p>De commissie wordt berekend op de netto gefactureerde omzet, exclusief btw, die de Opdrachtgever realiseert via door de Dienstverlener gegenereerde en bevestigde afspraken. Betaling geschiedt binnen <strong>${termDays} kalenderdagen</strong> na ontvangst van een correcte factuur, maandelijks.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Rapportage</div>
  <p>De Opdrachtgever verstrekt maandelijks een overzicht van de omzet die gekoppeld is aan door de Dienstverlener gegenereerde afspraken, ter controle en facturatie.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Duur</div>
  <p>${duration || 'Dit Addendum loopt voor onbepaalde duur, opzegbaar met 7 kalenderdagen schriftelijke opzegging.'}</p>
</div>

${notes ? `<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">${notes}</div></div>` : ''}

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV — Infinite Scale</p>
      <p class="sig-sublabel">Opdrachtgever</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">${agentName || 'Dienstverlener'}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`;
  },

  _agentAddendumUurtarief({ agentName, agentAddress, agentVat, rate, duration, paymentTerm, notes }) {
    const rateStr = rate ? `&euro; ${rate},00 excl. btw per uur` : '(zie overeenkomst)';
    const termDays = paymentTerm || 14;
    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Addendum — Uurtariefovereenkomst</p>
<p class="doc-subtitle">Aanvulling op de Overeenkomst Zelfstandige Dienstverlening</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${agentName || '—'}</strong>${agentVat ? ', ondernemingsnr. ' + agentVat : ''}${agentAddress ? ', gevestigd te ' + agentAddress : ''}, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Dit Addendum maakt integraal deel uit van de Overeenkomst Zelfstandige Dienstverlening en is onderworpen aan alle bepalingen daarvan, tenzij hieronder uitdrukkelijk anders bepaald.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Uurtarief</div>
  <div class="highlight"><strong>${rateStr}</strong></div>
  <p>Gewerkte uren worden bijgehouden via het platform van de Opdrachtgever. Betaling geschiedt binnen <strong>${termDays} kalenderdagen</strong> na ontvangst van een correcte factuur, maandelijks op basis van goedgekeurde uren.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Rapportage</div>
  <p>De Dienstverlener registreert dagelijks de gewerkte uren. De Opdrachtgever keurt de uren goed vóór facturatie. Geen reactie binnen 5 werkdagen na ontvangst van het urenoverzicht = automatisch goedgekeurd.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Duur</div>
  <p>${duration || 'Dit Addendum loopt voor onbepaalde duur, opzegbaar met 7 kalenderdagen schriftelijke opzegging.'}</p>
</div>

${notes ? `<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">${notes}</div></div>` : ''}

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV — Infinite Scale</p>
      <p class="sig-sublabel">Opdrachtgever</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">${agentName || 'Dienstverlener'}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`;
  },

  _defaults: {
    'client-cold-calling': null, // assigned below
    'client-pay-per-appointment': null,
    'client-commissie': null,
    'client-pilot': null,
    'client-maandelijks': null,
    'client': `<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Dienstverleningsovereenkomst</p>
<p class="doc-subtitle">{{ctypeLabel}}</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>{{party}}</strong>{{#if vat}}, BTW nr. {{vat}}{{/if}}{{#if address}}, gevestigd te {{address}}{{/if}}{{#if contact}}, rechtsgeldig vertegenwoordigd door {{contact}}{{/if}}, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen". Deze overeenkomst vervangt alle voorgaande afspraken over hetzelfde voorwerp.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Dienstverlener verzorgt telefonische leadopvolging, kwalificatie van inkomende en/of outbound leads en het inplannen van afspraken in de agenda van de Opdrachtgever (hierna: "de Diensten"). De Dienstverlener treedt op als zelfstandige en schept geen arbeidsrechtelijke verhouding.</p>
  {{#if aiScopeAddition}}<p>{{aiScopeAddition}}</p>{{/if}}
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Duur</div>
  <p>{{duurText}}</p>
  <p>Operationele start 3 tot 5 werkdagen na kick-off. {{#if aiDurationNote}}{{aiDurationNote}}{{/if}}</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  <div class="highlight"><strong>{{rateStr}}</strong></div>
  {{#if setupFee}}<div class="highlight">Eenmalige opstartvergoeding: <strong>&euro; {{setupFee}},00 excl. btw</strong> — verschuldigd bij aanvang van de samenwerking.</div>{{/if}}
  <p>Een afspraak is factureerbaar wanneer de lead aanwezig was op het afgesproken tijdstip (show-up).</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>No-shows en Annulaties</div>
  <ul>
    <li><strong>Lead annuleert / no-show:</strong> Opdrachtgever meldt dit binnen 24 uur schriftelijk. Dienstverlener herneemt contact en tracht opnieuw in te plannen. Lukt dit niet — niet gefactureerd. Geen melding binnen 24 uur = automatisch gefactureerd.</li>
    <li><strong>Opdrachtgever annuleert afspraak:</strong> Altijd gefactureerd, ongeacht tijdstip van melding.</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>Facturatie</div>
  <p>Maandelijks, einde kalendermaand. Vijf (5) dagen vóór factuurdatum ontvangt de Opdrachtgever een overzicht ter review. Geen reactie binnen 5 dagen = goedgekeurd.</p>
  <p><strong>Betaaltermijn: {{termDays}} kalenderdagen.</strong> Bij laattijdige betaling is verwijlintrest verschuldigd conform de Wet van 2 augustus 2002 betreffende de bestrijding van betalingsachterstand, verhoogd met een forfaitaire vergoeding van € 40,00 per factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Verplichtingen</div>
  <p><strong>Dienstverlener:</strong> voert diensten uit als goed vakman, organiseert een kick-off, traint ingezette medewerkers, rapporteert maandelijks en verwerkt persoonsgegevens conform AVG/GDPR.</p>
  <p><strong>Opdrachtgever:</strong> verstrekt tijdig alle nodige informatie, toegangen en scripts; zorgt voor rechtmatige leads conform AVG/GDPR; meldt no-shows tijdig; betaalt facturen tijdig.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Gegevensbescherming & Vertrouwelijkheid</div>
  <p>Dienstverlener treedt op als verwerker (AVG/GDPR) en geeft persoonsgegevens terug of vernietigt ze na beëindiging. Opdrachtgever is verwerkingsverantwoordelijke en vrijwaart Dienstverlener voor aanspraken wegens onrechtmatige verwerking door de Opdrachtgever.</p>
  <p>Beide Partijen behandelen alle vertrouwelijke informatie strikt vertrouwelijk gedurende de looptijd en twee (2) jaar erna.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Niet-benadering</div>
  <p>Gedurende de looptijd en 12 maanden erna mag de Opdrachtgever door de Dienstverlener ingezette medewerkers niet rechtstreeks benaderen, rekruteren of in dienst nemen, noch rechtstreeks of onrechtstreeks diensten afnemen die gelijkaardig zijn aan de Diensten. Bij overtreding is een forfaitaire schadevergoeding verschuldigd van <strong>€ 10.000,00 per inbreuk</strong>, onverminderd het recht op hogere schadeloosstelling.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">9.</span>Aansprakelijkheid & Beëindiging</div>
  <p>De aansprakelijkheid van de Dienstverlener is beperkt tot het bedrag dat de Opdrachtgever in de drie (3) maanden vóór het schadegeval heeft betaald. Geen aansprakelijkheid voor indirecte schade of gederfde winst.</p>
  <p>Beëindiging met onmiddellijke ingang mogelijk bij ernstige tekortkoming die niet hersteld is binnen 15 dagen na schriftelijke ingebrekestelling. Bij twee (2) onbetaalde facturen kan de Dienstverlener zijn diensten opschorten of de overeenkomst beëindigen. Bij beëindiging zijn alle openstaande facturen onmiddellijk opeisbaar.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">10.</span>Toepasselijk Recht & Overige</div>
  <p>Belgisch recht is van toepassing. Partijen streven een minnelijke schikking na binnen 30 dagen. Bij mislukking: Rechtbank van Onderneming van het arrondissement van de Dienstverlener.</p>
  <p>Wijzigingen zijn enkel geldig indien schriftelijk overeengekomen en ondertekend door beide Partijen. Nietigheid van een bepaling tast de overige bepalingen niet aan.</p>
</div>

{{#if notes}}<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">{{notes}}</div></div>{{/if}}

<div class="sig-section">
  <p class="sig-title">Handtekening</p>
  <p style="font-size:10.5pt;margin-bottom:24px;">Beide Partijen verklaren de inhoud van deze overeenkomst te hebben gelezen, begrepen en ermee akkoord te gaan.</p>
  <div class="sig-block">
    <p class="sig-label">{{party}}</p>
    <p class="sig-sublabel">{{contact}}</p>
    <div class="sig-line">Handtekening &amp; datum</div>
  </div>
</div>`,

    'agent': `<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Zelfstandige Samenwerkingsovereenkomst</p>
<p class="doc-subtitle">{{ctypeLabel}} — Leadopvolging & Appointment Setting</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>{{agentName}}</strong>{{#if vat}}, BTW nr. {{vat}}{{/if}}, hierna te noemen:<br>
      <span class="party-label">Opdrachtnemer</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen". Deze overeenkomst vervangt alle voorgaande afspraken over hetzelfde voorwerp.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Opdrachtnemer treedt op als zelfstandige en verleent in opdracht van Infinite Scale diensten op het vlak van telefonische leadopvolging, prospectie en het inplannen van verkoopafspraken voor klanten van Infinite Scale. Er bestaat geen arbeidsrechtelijke verhouding tussen de Partijen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Taken</div>
  <ul>
    <li>Outbound cold calling en e-mailprospectie conform de campagnebriefing</li>
    <li>Kwalificatie van prospects op basis van het afgesproken Ideal Customer Profile (ICP)</li>
    <li>Inplannen van bevestigde afspraken voor klanten van Infinite Scale</li>
    <li>Dagelijkse activiteitsrapportage via het platform</li>
    <li>Deelname aan teamoverleg en check-ins</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  <div class="highlight"><strong>{{rateStr}}</strong></div>
  <p>Een afspraak is bevestigd wanneer een gekwalificeerde prospect de uitnodiging heeft aanvaard en de afspraak daadwerkelijk heeft plaatsgevonden. No-shows door de prospect binnen 24 uur voor de afspraak worden niet vergoed. Betaling geschiedt binnen <strong>{{termDays}} kalenderdagen</strong> na ontvangst van de factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>Duur</div>
  <p>{{duration}}</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>Statuut Zelfstandige</div>
  <p>De Opdrachtnemer is als zelfstandige verantwoordelijk voor zijn/haar eigen sociale bijdragen, belastingen en verzekeringen. De Opdrachtnemer dient te beschikken over een geldig ondernemingsnummer en BTW-nummer indien van toepassing.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Exclusiviteit & Niet-concurrentie</div>
  <p>Tijdens de looptijd mag de Opdrachtnemer geen gelijkaardige diensten verlenen aan directe concurrenten van actieve klanten van Infinite Scale zonder voorafgaande schriftelijke toestemming. Gedurende de looptijd en 12 maanden erna mag de Opdrachtnemer klanten van Infinite Scale niet rechtstreeks benaderen of diensten aanbieden. Bij overtreding is een forfaitaire schadevergoeding verschuldigd van <strong>€ 10.000,00 per inbreuk</strong>.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Gegevensbescherming & Vertrouwelijkheid</div>
  <p>De Opdrachtnemer verbindt zich ertoe alle vertrouwelijke informatie — inclusief klantgegevens, scripts, werkwijzen en bedrijfsinformatie — strikt vertrouwelijk te behandelen gedurende de looptijd en twee (2) jaar erna. Persoonsgegevens worden uitsluitend verwerkt conform de AVG/GDPR en de instructies van Infinite Scale.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Kwaliteitsnormen</div>
  <p>De Opdrachtnemer verbindt zich tot het naleven van de door Infinite Scale vastgestelde kwaliteitsnormen, inclusief minimum dagelijkse activiteitsdoelstellingen, scriptconformiteit en professionele communicatie. Herhaald niet-naleven kan aanleiding geven tot onmiddellijke beëindiging.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">9.</span>Beëindiging & Aansprakelijkheid</div>
  <p>Beide Partijen kunnen de overeenkomst beëindigen met 7 dagen schriftelijke opzegging. Infinite Scale kan de overeenkomst met onmiddellijke ingang beëindigen bij wangedrag of ernstige tekortkoming. Openstaande verdiende vergoedingen worden uitbetaald bij beëindiging.</p>
  <p>De aansprakelijkheid van de Opdrachtnemer is beperkt tot het bedrag dat in de drie (3) maanden vóór het schadegeval werd uitbetaald. Geen aansprakelijkheid voor indirecte schade.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">10.</span>Toepasselijk Recht & Overige</div>
  <p>Belgisch recht is van toepassing. Geschillen worden in eerste instantie minnelijk geregeld. Bij mislukking: Rechtbank van Onderneming van het arrondissement van Infinite Scale.</p>
  <p>Wijzigingen zijn enkel geldig indien schriftelijk overeengekomen. Nietigheid van een bepaling tast de overige niet aan.</p>
</div>

{{#if notes}}<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">{{notes}}</div></div>{{/if}}

<div class="sig-section">
  <p class="sig-title">Handtekening</p>
  <p style="font-size:10.5pt;margin-bottom:24px;">Beide Partijen verklaren de inhoud van deze overeenkomst te hebben gelezen, begrepen en ermee akkoord te gaan.</p>
  <div class="sig-block">
    <p class="sig-label">{{agentName}}</p>
    <p class="sig-sublabel">&nbsp;</p>
    <div class="sig-line">Handtekening &amp; datum</div>
  </div>
</div>`,

    'agent-standard': `<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Overeenkomst Zelfstandige Dienstverlening</p>
<p class="doc-subtitle">Raamovereenkomst — vergoedingen per Addendum</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>{{agentName}}</strong>{{#if agentVat}}, ondernemingsnr. {{agentVat}}{{/if}}{{#if agentAddress}}, gevestigd te {{agentAddress}}{{/if}}, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen".</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Dienstverlener verbindt zich ertoe om, als zelfstandige en in volledige onafhankelijkheid, diensten te verlenen op het vlak van telefonische prospectie, leadopvolging en/of appointment setting voor klanten van de Opdrachtgever, conform de specifieke projectopdrachten zoals omschreven in afzonderlijke Addenda bij deze overeenkomst.</p>
  <p>De Dienstverlener treedt op als zelfstandige ondernemer. Er bestaat geen arbeidsrechtelijke verhouding, gezagsrelatie of enige andere band van ondergeschiktheid tussen de Partijen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Verplichtingen Dienstverlener</div>
  <ul>
    <li>De Dienstverlener verleent de overeengekomen diensten met de nodige professionele zorg en vakkennis.</li>
    <li>De Dienstverlener is als zelfstandige verantwoordelijk voor eigen sociale bijdragen, belastingen en verzekeringsverplichtingen.</li>
    <li>De Dienstverlener beschikt over een geldig ondernemingsnummer en is, indien van toepassing, BTW-plichtig.</li>
    <li>De Dienstverlener zorgt zelf voor de nodige materialen en middelen (computer, telefoon, internetverbinding) tenzij anders overeengekomen.</li>
    <li>De Dienstverlener meldt tijdig aan de Opdrachtgever wanneer de uitvoering van opdrachten vertraging oploopt of onmogelijk wordt.</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  <p>De vergoeding voor de verleende diensten wordt per project afzonderlijk vastgesteld in een Addendum bij deze overeenkomst. Elk Addendum bevat de specifieke tarieven, prestatievereisten en facturatievoorwaarden voor het betrokken project.</p>
  <p>Facturen worden uitbetaald binnen de termijn zoals vermeld in het toepasselijke Addendum, na ontvangst van een correcte factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>Duur en Beëindiging</div>
  <p>Deze overeenkomst wordt gesloten voor onbepaalde duur en treedt in werking op de datum van ondertekening. Elk afzonderlijk project heeft zijn eigen looptijd zoals bepaald in het bijhorende Addendum.</p>
  <p>Elk der Partijen kan deze overeenkomst beëindigen met een uitlooptermijn van <strong>14 kalenderdagen</strong>, schriftelijk meegedeeld per e-mail of aangetekende brief. Beëindiging van de raamovereenkomst impliceert tevens de beëindiging van alle lopende Addenda, tenzij anders overeengekomen.<br>Opzegging zonder termijn door Dienstverlener: forfaitaire schadevergoeding van <strong>EUR 1.000</strong>.</p>
  <p>De Opdrachtgever kan de overeenkomst met onmiddellijke ingang beëindigen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>Exclusiviteit en Niet-concurrentie</div>
  <p>Tijdens de duur van deze overeenkomst en gedurende <strong>12 maanden</strong> na beëindiging ervan, is de Dienstverlener verboden om, rechtstreeks of onrechtstreeks, klanten van de Opdrachtgever te benaderen of hen gelijkaardige diensten aan te bieden buiten het kader van deze overeenkomst.</p>
  <p>Bij overtreding van dit beding is de Dienstverlener van rechtswege een forfaitaire schadevergoeding verschuldigd van <strong>&euro; 20.000,00 per vastgestelde inbreuk</strong>, onverminderd het recht van de Opdrachtgever om een hogere schade te bewijzen en te vorderen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Vertrouwelijkheid en Gegevensbescherming</div>
  <p>De Dienstverlener verbindt zich ertoe, tijdens en tot <strong>5 jaar</strong> na beëindiging van deze overeenkomst, alle bedrijfsinformatie van Opdrachtgever en diens klanten strikt vertrouwelijk te houden.</p>
  <p>Bij schending: forfaitaire schadevergoeding van <strong>EUR 50.000,00</strong>.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Aansprakelijkheid</div>
  <p>De Dienstverlener is aansprakelijk voor schade voortvloeiend uit niet-nakoming van deze overeenkomst.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Toepasselijk Recht en Geschillenbeslechting</div>
  <p>Deze overeenkomst wordt beheerst door het Belgisch recht. Alle geschillen worden in eerste instantie opgelost via minnelijk overleg. Indien geen minnelijke oplossing wordt bereikt, zijn de rechtbanken van het arrondissement van de maatschappelijke zetel van de Opdrachtgever bevoegd.</p>
</div>

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <p style="font-size:10.5pt;margin-bottom:24px;">Beide Partijen verklaren kennis te hebben genomen van de inhoud van deze overeenkomst en gaan hiermee uitdrukkelijk akkoord.</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">{{agentName}}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`,

    'addendum-per-afspraak': `<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Addendum — Per Afspraak</p>
<p class="doc-subtitle">Aanvulling op de Overeenkomst Zelfstandige Dienstverlening</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>{{agentName}}</strong>{{#if agentVat}}, ondernemingsnr. {{agentVat}}{{/if}}{{#if agentAddress}}, gevestigd te {{agentAddress}}{{/if}}, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Dit Addendum maakt integraal deel uit van de Overeenkomst Zelfstandige Dienstverlening en is onderworpen aan alle bepalingen daarvan, tenzij hieronder uitdrukkelijk anders bepaald.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Vergoeding</div>
  <div class="highlight"><strong>{{rateStr}}</strong></div>
  <p>Een afspraak is geldig wanneer de prospect aanwezig was op het afgesproken tijdstip en de afspraak daadwerkelijk heeft plaatsgevonden (show-up). No-shows worden niet vergoed. Betaling geschiedt binnen <strong>{{termDays}} kalenderdagen</strong> na ontvangst van een correcte factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Duur</div>
  <p>{{duration}}</p>
</div>

{{#if notes}}<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">{{notes}}</div></div>{{/if}}

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV — Infinite Scale</p>
      <p class="sig-sublabel">Opdrachtgever</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">{{agentName}}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`,

    'addendum-commissie': `<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Addendum — Commissieovereenkomst</p>
<p class="doc-subtitle">Aanvulling op de Overeenkomst Zelfstandige Dienstverlening</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>{{agentName}}</strong>{{#if agentVat}}, ondernemingsnr. {{agentVat}}{{/if}}{{#if agentAddress}}, gevestigd te {{agentAddress}}{{/if}}, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Dit Addendum maakt integraal deel uit van de Overeenkomst Zelfstandige Dienstverlening en is onderworpen aan alle bepalingen daarvan, tenzij hieronder uitdrukkelijk anders bepaald.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Commissievergoeding</div>
  <div class="highlight"><strong>{{commStr}}</strong></div>
  <p>De commissie wordt berekend op de netto gefactureerde omzet, exclusief btw. Betaling geschiedt binnen <strong>{{termDays}} kalenderdagen</strong> na ontvangst van een correcte factuur, maandelijks.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Rapportage</div>
  <p>De Opdrachtgever verstrekt maandelijks een overzicht van de omzet die gekoppeld is aan door de Dienstverlener gegenereerde afspraken, ter controle en facturatie.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Duur</div>
  <p>{{duration}}</p>
</div>

{{#if notes}}<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">{{notes}}</div></div>{{/if}}

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV — Infinite Scale</p>
      <p class="sig-sublabel">Opdrachtgever</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">{{agentName}}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`,

    'addendum-uurtarief': `<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Addendum — Uurtariefovereenkomst</p>
<p class="doc-subtitle">Aanvulling op de Overeenkomst Zelfstandige Dienstverlening</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>{{agentName}}</strong>{{#if agentVat}}, ondernemingsnr. {{agentVat}}{{/if}}{{#if agentAddress}}, gevestigd te {{agentAddress}}{{/if}}, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Dit Addendum maakt integraal deel uit van de Overeenkomst Zelfstandige Dienstverlening en is onderworpen aan alle bepalingen daarvan, tenzij hieronder uitdrukkelijk anders bepaald.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Uurtarief</div>
  <div class="highlight"><strong>{{rateStr}}</strong></div>
  <p>Gewerkte uren worden bijgehouden via het platform van de Opdrachtgever. Betaling geschiedt binnen <strong>{{termDays}} kalenderdagen</strong> na ontvangst van een correcte factuur, maandelijks op basis van goedgekeurde uren.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Rapportage</div>
  <p>De Dienstverlener registreert dagelijks de gewerkte uren. De Opdrachtgever keurt de uren goed vóór facturatie. Geen reactie binnen 5 werkdagen na ontvangst van het urenoverzicht = automatisch goedgekeurd.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Duur</div>
  <p>{{duration}}</p>
</div>

{{#if notes}}<div class="article"><div class="article-title">Bijzondere voorwaarden</div><div class="notes-block">{{notes}}</div></div>{{/if}}

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV — Infinite Scale</p>
      <p class="sig-sublabel">Opdrachtgever</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">{{agentName}}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`,

    'addendum': `<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Addendum</p>
<p class="doc-subtitle">Project {{endClient}}{{#if mainContractDate}} &mdash; bij overeenkomst d.d. {{mainContractDate}}{{/if}}</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>{{agentName}}</strong>, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Dit Addendum maakt integraal deel uit van de Overeenkomst Zelfstandige Dienstverlening{{#if mainContractDate}} gesloten op {{mainContractDate}}{{/if}} tussen de Partijen en is onderworpen aan alle bepalingen daarvan, tenzij hieronder uitdrukkelijk anders bepaald.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Project en Ingangsdatum</div>
  <p><strong>Eindklant / Project:</strong> {{endClient}}</p>
  <p><strong>Ingangsdatum:</strong> {{startDate}}</p>
  <p><strong>Omschrijving diensten:</strong> {{services}}</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Beschikbaarheid en Minimale Vereisten</div>
  <p><strong>Minimum aantal belacties per dag:</strong> {{minDials}}</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  <p>Zie de Addendumspecificaties. Alle bedragen zijn exclusief btw. Facturen dienen maandelijks ingediend te worden.</p>
</div>

<div class="article">
  <div class="article-title">Duur</div>
  <p>Dit Addendum loopt zolang de samenwerking tussen de Opdrachtgever en <strong>{{endClient}}</strong> voortduurt, tenzij eerder schriftelijk beëindigd door een der Partijen met een opzegtermijn van 7 kalenderdagen.</p>
</div>

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV — Infinite Scale</p>
      <p class="sig-sublabel">Opdrachtgever</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">{{agentName}}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`,
  },

  _pilotTemplate({ party, contact, vat, address, pilotMonths, doelsector, doelgroep, herkomstLeads, minLeadsPerWeek, ratePerAppt, setupFee, capacityFee, qual1Sector, qual1Bron, qual2Range, qual3Function, qual4Extra, hasBellijst, bellijstPrice, bellijstBron, paymentTerm, date }) {
    const d = date || new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
    const months = pilotMonths || '2';
    const term = paymentTerm || '14';
    const rateStr = ratePerAppt ? `€ ${ratePerAppt},00 excl. btw` : '(nader te bepalen)';
    const setupStr = setupFee && String(setupFee) !== '0' ? `€ ${setupFee},00 excl. btw` : 'geen';
    const capStr = capacityFee && String(capacityFee) !== '0' ? `€ ${capacityFee},00 excl. btw per maand` : 'geen';
    const checkBox = (checked) => checked ? '☑' : '☐';
    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Dienstverleningsovereenkomst</p>
<p class="doc-subtitle">Leadopvolging &amp; Appointment Setting — Piloot</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, vertegenwoordigd door Quinten Eeckhoudt, zaakvoerder, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${party || '—'}</strong>${vat ? `, BTW nr. ${vat}` : ''}${address ? `, gevestigd te ${address}` : ''}${contact ? `, vertegenwoordigd door ${contact}` : ''}, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen". Deze overeenkomst vervangt alle voorgaande afspraken over hetzelfde voorwerp.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Dienstverlener verzorgt telefonische leadopvolging, kwalificatie van inkomende en/of outbound leads, en het inplannen van afspraken in de agenda van de Opdrachtgever ("de Diensten"), binnen de doelsector en doelgroep hieronder omschreven.</p>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;margin:10px 0 12px;">
    <tr><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;width:40%;font-size:10pt;">Doelsector / product</td><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;">${doelsector || '—'}</td></tr>
    <tr><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;font-size:10pt;">Doelgroep</td><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;">${doelgroep || '—'}</td></tr>
    <tr><td style="padding:7px 12px;font-weight:700;font-size:10pt;">Herkomst leads</td><td style="padding:7px 12px;">${herkomstLeads || '—'}</td></tr>
  </table>
  <p>De Dienstverlener treedt op als zelfstandige onderneming; er bestaat geen arbeidsrechtelijke verhouding tussen Partijen. Deze overeenkomst betreft een pilootperiode om de samenwerking en de kwaliteit van de Diensten te evalueren alvorens Partijen een langduriger engagement aangaan. De Dienstverlener levert een inspanningsverbintenis, geen resultaatsverbintenis.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Duur en Opstart</div>
  <p>Pilootperiode van <strong>${months} maanden</strong> te rekenen vanaf de Aanvangsdatum. Daarna stilzwijgend verlengd per 3 maanden, opzegbaar met 30 dagen schriftelijke opzegging. Vroegtijdige beëindiging tijdens de pilot is mogelijk mits 14 dagen schriftelijke kennisgeving.</p>
  <p>Operationele start 10–14 werkdagen na kick-off. De Opdrachtgever engageert zich om de nodige input (productinformatie, scripts/argumentatie, toegang tot agenda/CRM) zo snel mogelijk na ondertekening aan te leveren.</p>
  ${minLeadsPerWeek ? `<p>Om de pilot representatief te evalueren levert de Opdrachtgever minstens <strong>${minLeadsPerWeek} bruikbare leads/contacten per week</strong> aan.</p>` : ''}
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding en Kwalificatiecriteria</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;margin:6px 0 12px;">
    <tr><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;width:55%;font-size:10pt;">Vergoeding per gehouden afspraak</td><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;">${rateStr}</td></tr>
    <tr><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;font-size:10pt;">Opstartkost</td><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;">${setupStr}</td></tr>
    <tr><td style="padding:7px 12px;font-weight:700;font-size:10pt;">Vaste maandelijkse capaciteitsfee</td><td style="padding:7px 12px;">${capStr}</td></tr>
  </table>
  <p>Een Afspraak is factureerbaar wanneer (a) de lead aanwezig was op het afgesproken tijdstip ("show-up"), én (b) de contactpersoon aantoonbaar voldeed aan onderstaande kwalificatiecriteria. Dit laatste wordt beoordeeld op basis van de leadgegevens, niet op de uitkomst van het gesprek.</p>
  <p>${checkBox(!!qual1Sector)} Bedrijf/persoon actief binnen <strong>${qual1Sector || '[doelsector]'}</strong>${qual1Bron ? ` — geverifieerd via ${qual1Bron}` : ''}</p>
  <p>${checkBox(!!qual2Range)} Profiel/bedrijfsgrootte binnen <strong>${qual2Range || '[range]'}</strong></p>
  <p>${checkBox(!!qual3Function)} Contactpersoon heeft functietitel of rol binnen <strong>${qual3Function || '[functiecategorie]'}</strong></p>
  ${qual4Extra ? `<p>☑ ${qual4Extra}</p>` : '<p>☐ [Aanvullend, optioneel]</p>'}
  ${hasBellijst ? `<div class="highlight"><strong>Optionele dienst — opmaak bellijst:</strong> De Dienstverlener staat ook in voor de opmaak en het beheer van de bellijst/leadlijst.<br>Vergoeding: <strong>${bellijstPrice || '—'}</strong> excl. btw &nbsp;|&nbsp; Bron contactgegevens: ${bellijstBron || '—'}</div>` : ''}
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>No-shows en Annulaties</div>
  <ul>
    <li><strong>Lead annuleert / no-show:</strong> Opdrachtgever meldt dit binnen 24 uur schriftelijk. Dienstverlener herneemt contact en tracht opnieuw in te plannen. Lukt dit niet — niet gefactureerd. Geen melding binnen 24 uur = automatisch gefactureerd.</li>
    <li><strong>Opdrachtgever annuleert afspraak:</strong> Altijd gefactureerd, ongeacht tijdstip van melding.</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>Facturatie</div>
  <p>Maandelijks, einde kalendermaand. Vijf (5) dagen vóór factuurdatum ontvangt de Opdrachtgever een overzicht ter review. Geen reactie binnen 5 dagen = goedgekeurd.</p>
  <p><strong>Betaaltermijn: ${term} kalenderdagen.</strong> Bij laattijdige betaling is van rechtswege verwijlintrest verschuldigd conform de Wet van 2 augustus 2002, verhoogd met een forfaitaire vergoeding van € 40,00 per factuur voor invorderingskosten.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Verplichtingen</div>
  <p><strong>Dienstverlener:</strong> voert de Diensten uit als goed vakman, organiseert een kick-off, traint de ingezette medewerkers, rapporteert maandelijks, en verwerkt persoonsgegevens conform de AVG/GDPR.</p>
  <p><strong>Opdrachtgever:</strong> verstrekt tijdig alle nodige informatie, toegangen en scripts; zorgt voor rechtmatig verkregen leads conform de AVG/GDPR; meldt no-shows tijdig; respecteert de minimuminbreng; betaalt facturen tijdig.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Gegevensbescherming &amp; Vertrouwelijkheid</div>
  <p>Dienstverlener treedt op als verwerker (AVG/GDPR) en geeft persoonsgegevens terug of vernietigt ze na beëindiging. Opdrachtgever is verwerkingsverantwoordelijke en vrijwaart Dienstverlener voor aanspraken wegens onrechtmatige verwerking die aan de Opdrachtgever te wijten is.</p>
  <p>Beide Partijen behandelen alle vertrouwelijke informatie strikt vertrouwelijk gedurende de looptijd en twee (2) jaar erna (klantenlijsten, leadgegevens, tarieven, scripts, interne processen en rapportagegegevens).</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Niet-benadering</div>
  <p>Gedurende de looptijd en 12 maanden erna mag de Opdrachtgever door de Dienstverlener ingezette medewerkers niet rechtstreeks benaderen, rekruteren of in dienst nemen, noch gelijkaardige diensten afnemen buiten deze overeenkomst om. Bij overtreding is een forfaitaire schadevergoeding verschuldigd van <strong>€ 10.000,00 per inbreuk</strong>, onverminderd het recht op hogere schadeloosstelling.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">9.</span>Intellectuele Eigendom</div>
  <p>Belscripts, callflows, kwalificatiecriteria, methodologieën, sjablonen, rapportagemodellen en tools die de Dienstverlener ontwikkelt of gebruikt, blijven diens exclusieve eigendom. De Opdrachtgever verkrijgt uitsluitend een niet-exclusief, niet-overdraagbaar gebruiksrecht voor de duur van deze overeenkomst.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">10.</span>Aansprakelijkheid &amp; Beëindiging</div>
  <p>De aansprakelijkheid van de Dienstverlener is, behoudens opzet of zware fout, beperkt tot het bedrag dat de Opdrachtgever in de 3 maanden vóór het schadegeval heeft betaald. Geen aansprakelijkheid voor indirecte schade of gederfde winst.</p>
  <p>Beëindiging met onmiddellijke ingang is mogelijk bij een ernstige tekortkoming die niet hersteld is binnen 15 dagen na schriftelijke ingebrekestelling. Bij 2 onbetaalde facturen kan de Dienstverlener de diensten opschorten of de overeenkomst beëindigen. Bij beëindiging zijn alle openstaande facturen onmiddellijk opeisbaar.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">11.</span>Toepasselijk Recht &amp; Overige</div>
  <p>Belgisch recht is van toepassing. Partijen streven een minnelijke schikking na binnen 30 dagen. Bij mislukking is uitsluitend de Ondernemingsrechtbank van het arrondissement van de Dienstverlener bevoegd.</p>
  <p>Wijzigingen zijn enkel geldig indien schriftelijk overeengekomen en ondertekend door beide Partijen. Nietigheid van een bepaling tast de overige bepalingen niet aan.</p>
</div>

<div class="sig-section">
  <p class="sig-title">Aanvaarding</p>
  <p style="font-size:10pt;margin-bottom:20px;">De Dienstverlener, Curabond BV (Infinite Scale), vertegenwoordigd door Quinten Eeckhoudt, zaakvoerder, heeft de inhoud van deze overeenkomst reeds nagelezen en goedgekeurd. Deze overeenkomst komt bindend tot stand op het moment waarop de Opdrachtgever hieronder ondertekent.</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV (Infinite Scale) — Quinten Eeckhoudt</p>
      <p class="sig-sublabel">Dienstverlener — reeds aanvaard bij verzending</p>
      <div class="sig-line">Datum verzending: ${d}</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">${contact || party || '—'}</p>
      <p class="sig-sublabel">Opdrachtgever — te ondertekenen</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`;
  },

  _pilotPayTable(pilotPaySel, pilotPayVals, hasBellijst, bellijstPrice, bellijstBron) {
    const pSel = pilotPaySel || {};
    const pVals = pilotPayVals || {};
    const rows = [];
    if (pSel.perAfspraak) rows.push({ l: 'Vergoeding per gehouden afspraak', v: `€ ${pVals.perAfspraak || '—'},00 excl. btw` });
    if (pSel.perUur) rows.push({ l: 'Vergoeding per uur', v: `€ ${pVals.perUur || '—'},00 excl. btw per uur` });
    if (pSel.commissie) rows.push({ l: 'Commissie op gefactureerde omzet', v: `${pVals.commissie || '—'}%` });
    if (pSel.opstartkost) rows.push({ l: 'Opstartkost (eenmalig)', v: `€ ${pVals.opstartkost || '—'},00 excl. btw` });
    if (pSel.capacityFee) rows.push({ l: 'Vaste maandelijkse capaciteitsfee', v: `€ ${pVals.capacityFee || '—'},00 excl. btw per maand` });
    if (!rows.length) return '<div class="highlight">Vergoeding nader te bepalen tussen Partijen.</div>';
    return `<table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;margin:6px 0 12px;">
${rows.map(r => `  <tr><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;width:55%;font-size:10pt;">${r.l}</td><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;">${r.v}</td></tr>`).join('\n')}
</table>`;
  },

  _pilotLeadopvolgingTemplate({ party, contact, vat, address, pilotMonths, pilotPaySel, pilotPayVals, hasBellijst, bellijstPrice, bellijstBron, validApptDef, paymentTerm, date }) {
    const d = date || new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
    const months = pilotMonths || '2';
    const term = paymentTerm || '14';
    const payTable = this._pilotPayTable(pilotPaySel, pilotPayVals, hasBellijst, bellijstPrice, bellijstBron);
    const qualText = validApptDef || 'Een afspraak is factureerbaar wanneer de lead aanwezig was op het afgesproken tijdstip (show-up) en aantoonbaar voldeed aan de vooraf afgesproken kwalificatiecriteria.';
    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Dienstverleningsovereenkomst</p>
<p class="doc-subtitle">Leadopvolging &amp; Appointment Setting — Piloot</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, vertegenwoordigd door Quinten Eeckhoudt, zaakvoerder, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${party || '—'}</strong>${vat ? `, BTW nr. ${vat}` : ''}${address ? `, gevestigd te ${address}` : ''}${contact ? `, vertegenwoordigd door ${contact}` : ''}, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen". Deze overeenkomst vervangt alle voorgaande afspraken over hetzelfde voorwerp.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Dienstverlener verzorgt telefonische leadopvolging, kwalificatie van inkomende en/of outbound leads, en het inplannen van afspraken in de agenda van de Opdrachtgever ("de Diensten"). De Dienstverlener treedt op als zelfstandige onderneming; er bestaat geen arbeidsrechtelijke verhouding tussen Partijen. De Dienstverlener levert een inspanningsverbintenis, geen resultaatsverbintenis.</p>
  <p>Deze overeenkomst betreft een pilootperiode om de samenwerking en de kwaliteit van de Diensten te evalueren alvorens Partijen een langduriger engagement aangaan.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Duur en Opstart</div>
  <p>Pilootperiode van <strong>${months} maanden</strong> te rekenen vanaf de Aanvangsdatum. Daarna stilzwijgend verlengd per 3 maanden, opzegbaar met 30 dagen schriftelijke opzegging. Vroegtijdige beëindiging tijdens de pilot is mogelijk mits 14 dagen schriftelijke kennisgeving.</p>
  <p>Operationele start 10–14 werkdagen na kick-off. De Opdrachtgever engageert zich om de nodige input (productinformatie, scripts/argumentatie, toegang tot agenda/CRM) zo snel mogelijk na ondertekening aan te leveren.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  ${payTable}
  <p>Een Afspraak is factureerbaar wanneer (a) de lead aanwezig was op het afgesproken tijdstip ("show-up"), én (b) de contactpersoon aantoonbaar voldeed aan onderstaande kwalificatiecriteria.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>Kwalificatiecriteria</div>
  <div class="highlight">${qualText}</div>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>No-shows en Annulaties</div>
  <ul>
    <li><strong>Lead annuleert / no-show:</strong> Opdrachtgever meldt dit binnen 24 uur schriftelijk. Dienstverlener herneemt contact en tracht opnieuw in te plannen. Lukt dit niet — niet gefactureerd. Geen melding binnen 24 uur = automatisch gefactureerd.</li>
    <li><strong>Opdrachtgever annuleert afspraak:</strong> Altijd gefactureerd, ongeacht tijdstip van melding.</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Facturatie</div>
  <p>Maandelijks, einde kalendermaand. Vijf (5) dagen vóór factuurdatum ontvangt de Opdrachtgever een overzicht ter review. Geen reactie binnen 5 dagen = goedgekeurd.</p>
  <p><strong>Betaaltermijn: ${term} kalenderdagen.</strong> Bij laattijdige betaling is van rechtswege verwijlintrest verschuldigd conform de Wet van 2 augustus 2002, verhoogd met een forfaitaire vergoeding van € 40,00 per factuur.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Verplichtingen</div>
  <p><strong>Dienstverlener:</strong> voert de Diensten uit als goed vakman, organiseert een kick-off, traint de ingezette medewerkers, rapporteert maandelijks, en verwerkt persoonsgegevens conform de AVG/GDPR.</p>
  <p><strong>Opdrachtgever:</strong> verstrekt tijdig alle nodige informatie, toegangen en scripts; zorgt voor rechtmatig verkregen leads conform de AVG/GDPR; meldt no-shows tijdig; betaalt facturen tijdig.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Gegevensbescherming &amp; Vertrouwelijkheid</div>
  <p>Dienstverlener treedt op als verwerker (AVG/GDPR) en geeft persoonsgegevens terug of vernietigt ze na beëindiging. Beide Partijen behandelen alle vertrouwelijke informatie strikt vertrouwelijk gedurende de looptijd en twee (2) jaar erna.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">9.</span>Niet-benadering</div>
  <p>Gedurende de looptijd en 12 maanden erna mag de Opdrachtgever door de Dienstverlener ingezette medewerkers niet rechtstreeks benaderen, rekruteren of in dienst nemen. Bij overtreding is een forfaitaire schadevergoeding verschuldigd van <strong>€ 10.000,00 per inbreuk</strong>.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">10.</span>Aansprakelijkheid &amp; Beëindiging</div>
  <p>De aansprakelijkheid van de Dienstverlener is beperkt tot het bedrag dat de Opdrachtgever in de 3 maanden vóór het schadegeval heeft betaald. Geen aansprakelijkheid voor indirecte schade of gederfde winst. Bij 2 onbetaalde facturen kan de Dienstverlener de diensten opschorten of de overeenkomst beëindigen.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">11.</span>Toepasselijk Recht &amp; Overige</div>
  <p>Belgisch recht. Minnelijke schikking binnen 30 dagen; bij mislukking: Ondernemingsrechtbank van het arrondissement van de Dienstverlener. Wijzigingen enkel geldig indien schriftelijk overeengekomen en ondertekend door beide Partijen.</p>
</div>

<div class="sig-section">
  <p class="sig-title">Aanvaarding</p>
  <p style="font-size:10pt;margin-bottom:20px;">De Dienstverlener heeft de inhoud van deze overeenkomst reeds nagelezen en goedgekeurd. Deze overeenkomst komt bindend tot stand op het moment waarop de Opdrachtgever hieronder ondertekent.</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV (Infinite Scale) — Quinten Eeckhoudt</p>
      <p class="sig-sublabel">Dienstverlener — reeds aanvaard bij verzending</p>
      <div class="sig-line">Datum verzending: ${d}</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">${contact || party || '—'}</p>
      <p class="sig-sublabel">Opdrachtgever — te ondertekenen</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`;
  },

  _coldCallingPilotTemplate({ party, contact, vat, address, pilotMonths, doelsector, doelgroep, herkomstLeads, qualCriteria, pilotPaySel, pilotPayVals, hasBellijst, bellijstPrice, bellijstBron, paymentTerm, date }) {
    const d = date || new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
    const months = pilotMonths || '2';
    const term = paymentTerm || '14';
    const payTable = this._pilotPayTable(pilotPaySel, pilotPayVals, hasBellijst, bellijstPrice, bellijstBron);
    const criteria = Array.isArray(qualCriteria) ? qualCriteria.filter(c => c && c.text && c.text.trim()) : [];
    const criteriaHtml = criteria.length > 0
      ? criteria.map((c, i) => `<p>&#9744; <strong>Criterium ${i + 1}:</strong> ${c.text}</p>`).join('\n  ')
      : '<p>&#9744; [Criteria nader te bepalen tussen Partijen]</p>';
    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Dienstverleningsovereenkomst</p>
<p class="doc-subtitle">Koude Prospectie (Cold Calling) — Piloot</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, vertegenwoordigd door Quinten Eeckhoudt, zaakvoerder, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${party || '—'}</strong>${vat ? `, BTW nr. ${vat}` : ''}${address ? `, gevestigd te ${address}` : ''}${contact ? `, vertegenwoordigd door ${contact}` : ''}, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Hierna gezamenlijk aangeduid als "de Partijen". Deze overeenkomst vervangt alle voorgaande afspraken over hetzelfde voorwerp.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Voorwerp</div>
  <p>De Dienstverlener verzorgt telefonische leadopvolging, kwalificatie van inkomende en/of outbound leads, en het inplannen van afspraken in de agenda van de Opdrachtgever ("de Diensten"), binnen de doelsector en doelgroep hieronder omschreven.</p>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;margin:10px 0 12px;">
    <tr><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;width:40%;font-size:10pt;">Doelsector / product</td><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;">${doelsector || '—'}</td></tr>
    <tr><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;font-weight:700;font-size:10pt;">Doelgroep</td><td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;">${doelgroep || '—'}</td></tr>
    <tr><td style="padding:7px 12px;font-weight:700;font-size:10pt;">Herkomst leads</td><td style="padding:7px 12px;">${herkomstLeads || '—'}</td></tr>
  </table>
  <p>De Dienstverlener treedt op als zelfstandige onderneming; er bestaat geen arbeidsrechtelijke verhouding tussen Partijen. De Dienstverlener levert een inspanningsverbintenis, geen resultaatsverbintenis.</p>
  <p>Deze overeenkomst betreft een pilootperiode om de samenwerking en de kwaliteit van de Diensten te evalueren alvorens Partijen een langduriger engagement aangaan.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Duur en Opstart</div>
  <p>Pilootperiode van <strong>${months} maanden</strong> te rekenen vanaf de Aanvangsdatum. Heeft geen van de Partijen de overeenkomst vóór het einde van deze termijn schriftelijk beëindigd, dan wordt de samenwerking nadien voortgezet voor opeenvolgende periodes van 3 maanden, opzegbaar met 30 dagen schriftelijke opzegging vóór het einde van de lopende periode.</p>
  <p>Vroegtijdige beëindiging tijdens de initiële pilootperiode is mogelijk mits 14 dagen schriftelijke kennisgeving.</p>
  <p>Operationele start 10–14 werkdagen na kick-off.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding en Kwalificatiecriteria</div>
  ${payTable}
  <p>Een Afspraak is factureerbaar wanneer (a) de lead aanwezig was op het afgesproken tijdstip ("show-up"), én (b) de contactpersoon op het moment van contactname aantoonbaar voldeed aan onderstaande kwalificatiecriteria. Dit laatste wordt beoordeeld op basis van de leadgegevens, niet op de uitkomst van het gesprek.</p>
  <p><strong>Kwalificatiecriteria:</strong></p>
  ${criteriaHtml}
  ${hasBellijst ? `<div class="highlight"><strong>Optionele dienst — opmaak bellijst:</strong> De Dienstverlener staat ook in voor de opmaak en het beheer van de bellijst/leadlijst${bellijstBron ? ` (bron: ${bellijstBron})` : ''}.<br>Vergoeding: <strong>${bellijstPrice || '—'}</strong> excl. btw</div>` : ''}
</div>

<div class="article">
  <div class="article-title"><span class="art-num">4.</span>No-shows en Annulaties</div>
  <ul>
    <li><strong>Lead annuleert / no-show:</strong> Opdrachtgever meldt dit binnen 24 uur schriftelijk. Dienstverlener herneemt contact en tracht opnieuw in te plannen. Lukt dit niet — niet gefactureerd. Geen melding binnen 24 uur = automatisch gefactureerd.</li>
    <li><strong>Opdrachtgever annuleert afspraak:</strong> Altijd gefactureerd, ongeacht tijdstip van melding.</li>
  </ul>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">5.</span>Facturatie</div>
  <p>Maandelijks, einde kalendermaand. Vijf (5) dagen vóór factuurdatum ontvangt de Opdrachtgever een overzicht ter review. Geen reactie binnen 5 dagen = goedgekeurd.</p>
  <p><strong>Betaaltermijn: ${term} kalenderdagen.</strong> Bij laattijdige betaling is van rechtswege verwijlintrest verschuldigd conform de Wet van 2 augustus 2002 betreffende de bestrijding van betalingsachterstand bij handelstransacties, verhoogd met een forfaitaire vergoeding van € 40,00 per factuur voor invorderingskosten.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">6.</span>Verplichtingen</div>
  <p><strong>Dienstverlener:</strong> voert de Diensten uit als goed vakman, organiseert een kick-off, traint de ingezette medewerkers, rapporteert maandelijks, en verwerkt persoonsgegevens conform de AVG/GDPR.</p>
  <p><strong>Opdrachtgever:</strong> verstrekt tijdig alle nodige informatie, toegangen en scripts; zorgt voor rechtmatig verkregen leads conform de AVG/GDPR; meldt no-shows tijdig conform artikel 4; betaalt facturen tijdig.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">7.</span>Gegevensbescherming &amp; Vertrouwelijkheid</div>
  <p>Dienstverlener treedt op als verwerker (AVG/GDPR) en geeft persoonsgegevens terug of vernietigt ze na beëindiging. Opdrachtgever is verwerkingsverantwoordelijke en vrijwaart Dienstverlener voor aanspraken wegens onrechtmatige verwerking die aan de Opdrachtgever te wijten is.</p>
  <p>Beide Partijen behandelen alle vertrouwelijke informatie strikt vertrouwelijk gedurende de looptijd en twee (2) jaar erna (klantenlijsten, leadgegevens, tarieven, scripts, interne processen en rapportagegegevens).</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">8.</span>Niet-benadering</div>
  <p>Gedurende de looptijd en 12 maanden erna mag de Opdrachtgever door de Dienstverlener ingezette medewerkers niet rechtstreeks benaderen, rekruteren of in dienst nemen, noch gelijkaardige diensten afnemen buiten deze overeenkomst om. Bij overtreding is een forfaitaire schadevergoeding verschuldigd van <strong>€ 10.000,00 per inbreuk</strong>, onverminderd het recht op hogere schadeloosstelling.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">9.</span>Intellectuele Eigendom</div>
  <p>Belscripts, callflows, kwalificatiecriteria, methodologieën, sjablonen, rapportagemodellen en tools die de Dienstverlener ontwikkelt of gebruikt, blijven diens exclusieve eigendom. De Opdrachtgever verkrijgt uitsluitend een niet-exclusief, niet-overdraagbaar gebruiksrecht voor de duur van deze overeenkomst.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">10.</span>Aansprakelijkheid &amp; Beëindiging</div>
  <p>De aansprakelijkheid van de Dienstverlener is, behoudens opzet of zware fout, beperkt tot het bedrag dat de Opdrachtgever in de 3 maanden vóór het schadegeval heeft betaald. Geen aansprakelijkheid voor indirecte schade of gederfde winst.</p>
  <p>Beëindiging met onmiddellijke ingang is mogelijk bij een ernstige tekortkoming die niet hersteld is binnen 15 dagen na schriftelijke ingebrekestelling. Bij 2 onbetaalde facturen kan de Dienstverlener de diensten opschorten of de overeenkomst beëindigen. Bij beëindiging zijn alle openstaande facturen onmiddellijk opeisbaar.</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">11.</span>Toepasselijk Recht &amp; Overige</div>
  <p>Belgisch recht is van toepassing. Partijen streven een minnelijke schikking na binnen 30 dagen. Bij mislukking is uitsluitend de Ondernemingsrechtbank van het arrondissement van de Dienstverlener bevoegd.</p>
  <p>Wijzigingen zijn enkel geldig indien schriftelijk overeengekomen en ondertekend door beide Partijen. Nietigheid van een bepaling tast de overige bepalingen niet aan.</p>
</div>

<div class="sig-section">
  <p class="sig-title">Aanvaarding</p>
  <p style="font-size:10pt;margin-bottom:20px;">De Dienstverlener, Curabond BV (Infinite Scale), vertegenwoordigd door Quinten Eeckhoudt, zaakvoerder, verklaart bij deze uitdrukkelijk dat hij de inhoud van deze overeenkomst reeds heeft nagelezen en goedgekeurd. Deze overeenkomst komt bindend tot stand op het moment waarop de Opdrachtgever hieronder ondertekent.</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV (Infinite Scale) — Quinten Eeckhoudt</p>
      <p class="sig-sublabel">Dienstverlener — reeds aanvaard bij verzending</p>
      <div class="sig-line">Datum verzending: ${d}</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">${contact || party || '—'}</p>
      <p class="sig-sublabel">Opdrachtgever — te ondertekenen</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`;
  },

  _initDefaults() {
    const base = this._defaults['client'];
    ['client-cold-calling','client-pay-per-appointment','client-commissie','client-maandelijks'].forEach(slug => {
      if (!this._defaults[slug]) this._defaults[slug] = base;
    });
  },

  _addendum({ agentName, project, mainContractDate, startDate, services, payComponents, minDials, availabilityDays, availabilityHours, validApptDef, validLeadDef, hasNda, endClientName }) {
    const comps = Array.isArray(payComponents) ? payComponents : [];
    const hasPerAppt = comps.some(c => c.type === 'Per geldige afspraak');
    const hasPerLead = comps.some(c => c.type === 'Per geverifieerde lead');
    const payRows = comps.map(c => `
  <tr>
    <td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;">${c.type}</td>
    <td style="padding:7px 12px;border-bottom:1px solid #e8e8e8;text-align:right;font-weight:700;">&euro; ${c.amount || '&mdash;'},00 excl. btw</td>
  </tr>`).join('');

    const endClient = endClientName || project || '&mdash;';
    const artOffset = hasPerAppt && hasPerLead ? 2 : hasPerAppt || hasPerLead ? 1 : 0;

    return `
<div class="doc-header">
  <div class="doc-header-logo">
    <img src="https://platform.infinite-scale.be/logo.svg" alt="Infinite Scale" />
    <span>Infinite Scale</span>
  </div>
  <div class="doc-header-meta">
    Curabond BV &bull; BTW BE1016721633<br>
    Schoolstraat 43, 9200 Appels
  </div>
</div>

<p class="doc-title">Addendum</p>
<p class="doc-subtitle">Project ${endClient}${mainContractDate ? ' &mdash; bij overeenkomst d.d. ' + mainContractDate : ''}</p>

<div class="parties-box">
  <div class="parties-box-title">De ondergetekenden</div>
  <div class="party-row">
    <div class="party-num">1.</div>
    <div class="party-info">
      <strong>Curabond BV</strong>, handelend onder de commerciële naam <strong>Infinite Scale</strong>, gevestigd te Schoolstraat 43, 9200 Appels, BTW nr. BE1016721633, hierna te noemen:<br>
      <span class="party-label">Opdrachtgever</span>
    </div>
  </div>
  <div class="party-row">
    <div class="party-num">2.</div>
    <div class="party-info">
      <strong>${agentName || '&mdash;'}</strong>, hierna te noemen:<br>
      <span class="party-label">Dienstverlener</span>
    </div>
  </div>
</div>

<p style="margin-bottom:24px;font-size:10.5pt;">Dit Addendum maakt integraal deel uit van de Overeenkomst Zelfstandige Dienstverlening${mainContractDate ? ' gesloten op ' + mainContractDate : ''} tussen de Partijen en is onderworpen aan alle bepalingen daarvan, tenzij hieronder uitdrukkelijk anders bepaald.</p>

<div class="article">
  <div class="article-title"><span class="art-num">1.</span>Project en Ingangsdatum</div>
  <p><strong>Eindklant / Project:</strong> ${endClient}</p>
  <p><strong>Ingangsdatum:</strong> ${startDate || '&mdash;'}</p>
  <p><strong>Omschrijving diensten:</strong> ${services || 'Telefonisch contacteren van leads met als doel het inplannen van afspraken voor de eindklant.'}</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">2.</span>Beschikbaarheid en Minimale Vereisten</div>
  ${availabilityDays || availabilityHours ? '<p><strong>Beschikbaarheid:</strong> ' + (availabilityDays || '&mdash;') + ', ' + (availabilityHours || '&mdash;') + ' per dag</p>' : ''}
  <p><strong>Minimum aantal belacties per dag:</strong> ${minDials || '/'}</p>
</div>

<div class="article">
  <div class="article-title"><span class="art-num">3.</span>Vergoeding</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;margin-bottom:10px;">
    <thead>
      <tr style="background:#1a1a1a;color:#fff;">
        <th style="padding:8px 12px;text-align:left;font-size:9pt;text-transform:uppercase;letter-spacing:.06em;">Type vergoeding</th>
        <th style="padding:8px 12px;text-align:right;font-size:9pt;text-transform:uppercase;letter-spacing:.06em;">Bedrag</th>
      </tr>
    </thead>
    <tbody>${payRows || '<tr><td colspan="2" style="padding:10px 12px;color:#888;">Geen vergoedingen ingesteld.</td></tr>'}</tbody>
  </table>
  <p style="font-size:9.5pt;color:#555;">Alle bedragen zijn exclusief btw. Facturen dienen maandelijks ingediend te worden.</p>
</div>

${(hasPerAppt || validApptDef) ? '<div class="article"><div class="article-title"><span class="art-num">4.</span>Definitie Geldige Afspraak</div><p>' + (validApptDef || 'Een afspraak is geldig wanneer de prospect aanwezig was op het afgesproken tijdstip en de afspraak daadwerkelijk heeft plaatsgevonden (show-up). No-shows worden niet vergoed.') + '</p></div>' : ''}

${hasPerLead ? '<div class="article"><div class="article-title"><span class="art-num">' + (hasPerAppt ? '5' : '4') + '.</span>Definitie Geverifieerde Lead</div><p>' + (validLeadDef || 'Een geverifieerde lead is een lead die voldoet aan het overeengekomen ICP en waarvoor contactgegevens correct zijn bevestigd.') + '</p></div>' : ''}

${hasNda ? '<div class="article"><div class="article-title">NDA — Vertrouwelijkheidsclausule</div><p>De Opdrachtgever heeft een geheimhoudingsovereenkomst (NDA) gesloten met de eindklant <strong>' + endClient + '</strong>. De Dienstverlener verbindt zich ertoe alle informatie over de eindklant, zijn producten, diensten en bedrijfsprocessen strikt vertrouwelijk te behandelen en niet te delen met derden, zowel tijdens als na de looptijd van dit Addendum.</p></div>' : ''}

<div class="article">
  <div class="article-title">Duur</div>
  <p>Dit Addendum loopt zolang de samenwerking tussen de Opdrachtgever en <strong>${endClient}</strong> voortduurt, tenzij eerder schriftelijk beëindigd door een der Partijen met een opzegtermijn van 7 kalenderdagen.</p>
</div>

<div class="sig-section">
  <p class="sig-title">Handtekening voor akkoord</p>
  <div style="display:flex;gap:60px;flex-wrap:wrap;">
    <div class="sig-block">
      <p class="sig-label">Curabond BV — Infinite Scale</p>
      <p class="sig-sublabel">Opdrachtgever</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
    <div class="sig-block">
      <p class="sig-label">${agentName || 'Dienstverlener'}</p>
      <p class="sig-sublabel">Opdrachtnemer</p>
      <div class="sig-line">Handtekening &amp; datum</div>
    </div>
  </div>
</div>`;
  },
};
ContractTemplates._initDefaults();
