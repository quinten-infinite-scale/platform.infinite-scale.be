// Toelating Tot Facturatie — client-side PDF generator
// Uses jsPDF loaded on-demand from CDN

const JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

function _loadJsPDF() {
  return new Promise((resolve, reject) => {
    if (window.jspdf && window.jspdf.jsPDF) { resolve(window.jspdf.jsPDF); return; }
    const s = document.createElement('script');
    s.src = JSPDF_CDN;
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const NL_MONTHS = ['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'];

function _ymToNL(ym) {
  const [y, m] = ym.split('-');
  return NL_MONTHS[parseInt(m, 10) - 1] + ' ' + y;
}

function _ymPeriod(ym) {
  const [y, m] = ym.split('-');
  const mi = parseInt(m, 10);
  const lastDay = new Date(parseInt(y, 10), mi, 0).getDate();
  return `1/${m}/${y} t.e.m. ${lastDay}/${m}/${y}`;
}

// jsPDF standard fonts don't support the € glyph reliably — use "EUR" prefix
function _eur(v) {
  const n = Math.abs(parseFloat(v));
  return 'EUR ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function _today() {
  const d = new Date();
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// Draw a labeled key-value pair (bold label + normal value on same line)
function _kv(doc, label, value, x, y, labelW) {
  doc.setFont('helvetica', 'bold');
  doc.text(label, x, y);
  doc.setFont('helvetica', 'normal');
  doc.text(value, x + labelW, y);
}

// Horizontal rule
function _hr(doc, x, y, w) {
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + w, y);
}

async function downloadTTF(agent, ym, rows, grandTotal, hasMgmt, mgmtFee, bonuses, dealCommissions) {
  // normalize: old single-object format or empty
  const bonusList = Array.isArray(bonuses) ? bonuses : (bonuses && bonuses.amt != null ? [bonuses] : []);
  const commList = Array.isArray(dealCommissions) ? dealCommissions : [];
  const jsPDF = await _loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });

  const L = 20;          // left margin
  const R = 190;         // right edge (210 - 20)
  const W = R - L;       // content width = 170mm
  const LBL = 50;        // label column width for kv pairs

  // ── PAGE 1 ─────────────────────────────────────────────────────────────────

  // Header — "Infinite Scale" title
  let y = 22;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text('Infinite Scale', L, y);

  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text('TOELATING TOT FACTURATIE', L, y);

  y += 8;
  _hr(doc, L, y, W);
  y += 10;

  // ── Opdrachtgever ──────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text('Gegevens opdrachtgever', L, y);
  y += 7;

  doc.setFontSize(9.5);
  _kv(doc, 'Naam / Bedrijf:', 'Infinite Scale - Curabond BV', L, y, LBL); y += 5.5;
  _kv(doc, 'Adres:', 'Schoolstraat 43', L, y, LBL); y += 5.5;
  _kv(doc, 'Postcode + Gemeente:', '9200 Dendermonde/Appels', L, y, LBL); y += 5.5;
  _kv(doc, 'BTW-nummer:', 'BE 1016 721 633', L, y, LBL); y += 8;

  _hr(doc, L, y, W);
  y += 10;

  // ── Opdrachtnemer ──────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Gegevens opdrachtnemer', L, y);
  y += 7;

  const agentCompany  = agent.company || agent.name;
  const agentAddress  = agent.address  || '—';
  const agentPostcode = agent.postcode || '—';
  const agentVat      = agent.vat      || '—';

  doc.setFontSize(9.5);
  _kv(doc, 'Naam / Bedrijf:', agentCompany, L, y, LBL); y += 5.5;
  _kv(doc, 'Adres:', agentAddress, L, y, LBL); y += 5.5;
  _kv(doc, 'Postcode + Gemeente:', agentPostcode, L, y, LBL); y += 5.5;
  _kv(doc, 'BTW-nummer:', agentVat, L, y, LBL); y += 8;

  _hr(doc, L, y, W);
  y += 10;

  // ── Betreft ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Betreft opdracht / prestaties', L, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Omschrijving van de werken of diensten: Dienstlevering ' + _ymToNL(ym), L, y); y += 5.5;
  doc.text('Periode van uitvoering: ' + _ymPeriod(ym) + '.', L, y); y += 10;

  // ── Appointments table ─────────────────────────────────────────────────────
  // Column definitions: [label, x-start, width, align]
  const COLS = [
    { label: 'Beschrijving', x: L,      w: 72, align: 'left'   },
    { label: 'Unit',         x: L + 72, w: 20, align: 'center' },
    { label: 'Prijs/unit',   x: L + 92, w: 30, align: 'right'  },
    { label: '# units',      x: L +122, w: 22, align: 'right'  },
    { label: 'Totaal',       x: L +144, w: 26, align: 'right'  },
  ];

  function colRight(c) { return c.x + c.w; }
  function colMid(c)   { return c.x + c.w / 2; }

  // Table header background
  doc.setFillColor(240, 240, 240);
  doc.rect(L, y - 4.5, W, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);

  for (const c of COLS) {
    const tx = c.align === 'right' ? colRight(c) : c.align === 'center' ? colMid(c) : c.x;
    doc.text(c.label, tx, y, { align: c.align });
  }
  y += 3;

  _hr(doc, L, y, W);
  doc.setTextColor(0, 0, 0);
  y += 5;

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  for (const row of rows) {
    const rateStr = row.rateLabel ? row.rateLabel.replace(/€/g, 'EUR ') : _eur(row.rate);

    doc.setFont('helvetica', 'normal');
    doc.text(row.name, COLS[0].x, y, { maxWidth: COLS[0].w - 2 });
    doc.text('PPA', colMid(COLS[1]), y, { align: 'center' });
    doc.text(rateStr, colRight(COLS[2]), y, { align: 'right' });
    doc.text(String(row.count), colRight(COLS[3]), y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(_eur(row.total), colRight(COLS[4]), y, { align: 'right' });

    y += 7;
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.15);
    doc.line(L, y - 1.5, R, y - 1.5);
    doc.setFont('helvetica', 'normal');
  }

  // Always render 2 empty filler rows so table looks complete
  for (let i = 0; i < 2; i++) {
    y += 7;
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.15);
    doc.line(L, y - 1.5, R, y - 1.5);
  }

  y += 3;

  // Subtotal rows
  const totalBonusAmt = bonusList.reduce((s, b) => s + (parseFloat(b.amt) || 0), 0);
  const totalCommAmt = commList.reduce((s, c) => s + (parseFloat(c.amt) || 0), 0);
  const hasSubtotals = hasMgmt || totalBonusAmt > 0 || totalCommAmt > 0;
  if (hasSubtotals) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const setterFee = grandTotal - (hasMgmt ? mgmtFee : 0) - totalBonusAmt - totalCommAmt;
    doc.text('Setter commission', L, y);
    doc.text(_eur(setterFee), R, y, { align: 'right' });
    y += 6;
    if (hasMgmt) {
      doc.text('Management commission (15% of profit)', L, y);
      doc.text(_eur(mgmtFee), R, y, { align: 'right' });
      y += 6;
    }
    for (const c of commList) {
      const cAmt = parseFloat(c.amt) || 0;
      if (cAmt > 0) {
        const label = ('Deal commission — ' + (c.lead || c.client || 'Deal')).slice(0, 55);
        doc.text(label, L, y);
        doc.text(_eur(cAmt), R, y, { align: 'right' });
        y += 6;
      }
    }
    for (const b of bonusList) {
      const bAmt = parseFloat(b.amt) || 0;
      if (bAmt > 0) {
        doc.text(b.desc || 'Bonus', L, y);
        doc.text(_eur(bAmt), R, y, { align: 'right' });
        y += 6;
      }
    }
    y -= 2;
    _hr(doc, L, y, W);
    y += 5;
    doc.setTextColor(0, 0, 0);
  }

  // Total row (shaded)
  doc.setFillColor(240, 240, 240);
  doc.rect(L, y - 4, W, 10, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Totaal te factureren', L + 4, y + 1.5);
  doc.text(_eur(grandTotal), R - 2, y + 1.5, { align: 'right' });
  y += 14;

  // Grand total label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Algemeen totaal excl btw:', L, y);
  y += 6;
  doc.setFontSize(12);
  doc.text(_eur(grandTotal), L, y);
  y += 5;
  _hr(doc, L, y, W);

  // ── PAGE 2 ─────────────────────────────────────────────────────────────────
  doc.addPage();
  y = 30;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Toelating', L, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const toelText = doc.splitTextToSize(
    'Hierbij geeft de opdrachtgever formeel toestemming aan de opdrachtnemer om de uitgevoerde prestaties te factureren volgens de overeengekomen voorwaarden.',
    W
  );
  doc.text(toelText, L, y);
  y += toelText.length * 5.5 + 8;

  doc.setFont('helvetica', 'bold');
  doc.text('Betalingstermijn', L, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.text('De standaard overeengekomen betalingstermijn bedraagt 14 kalenderdagen.', L, y);
  y += 12;

  doc.setFont('helvetica', 'bold');
  doc.text('Datum: ', L, y);
  doc.setFont('helvetica', 'normal');
  doc.text(_today() + '.', L + 16, y);

  // ── Save ───────────────────────────────────────────────────────────────────
  const monthLabel = _ymToNL(ym).replace(' ', '-');
  doc.save(`TTF ${agentCompany} - ${monthLabel}.pdf`);
}

window.downloadTTF = downloadTTF;
