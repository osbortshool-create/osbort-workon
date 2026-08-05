const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { getClassLevel } = require('./classLevel');

// Fallback headers when school settings are missing
const CAMPUS_FALLBACK = {
  Ekiti: {
    name: 'Osbot International School, Ekiti State',
    address: 'Osbot Road, Aso Ayegunle, Ado-Ekiti, Ekiti State'
  },
  Lagos: {
    name: 'Osbot Group of Schools, Lagos State',
    address: '38 Unit Road, Isale Odo, Eleyin B/Stop, Ikole-Odunsi via Ipaja, Lagos State'
  }
};

// Canonical display name per campus (overrides whatever is in school.name for the PDF header)
const CAMPUS_DISPLAY_NAME = {
  Ekiti: 'Osbot International School, Ekiti State',
  Lagos: 'Osbot Group of Schools, Lagos State'
};

const PROMOTION_MAP = {
  'prep': 'KG 1', 'preparatory': 'KG 1', 'pre-nursery': 'KG 1', 'prenursery': 'KG 1',
  'kg 1': 'KG 2', 'kg1': 'KG 2', 'kindergarten 1': 'KG 2',
  'kg 2': 'Nursery 1', 'kg2': 'Nursery 1', 'kindergarten 2': 'Nursery 1',
  'nursery 1': 'Nursery 2', 'nursery1': 'Nursery 2',
  'nursery 2': 'Primary 1', 'nursery2': 'Primary 1',
  'primary 1': 'Primary 2', 'primary1': 'Primary 2', 'pry 1': 'Primary 2',
  'primary 2': 'Primary 3', 'primary2': 'Primary 3', 'pry 2': 'Primary 3',
  'primary 3': 'Primary 4', 'primary3': 'Primary 4', 'pry 3': 'Primary 4',
  'primary 4': 'Primary 5', 'primary4': 'Primary 5', 'pry 4': 'Primary 5',
  'primary 5': 'JSS 1',     'primary5': 'JSS 1',     'pry 5': 'JSS 1',
  'jss 1': 'JSS 2', 'jss1': 'JSS 2',
  'jss 2': 'JSS 3', 'jss2': 'JSS 3',
  'jss 3': 'SS 1',  'jss3': 'SS 1',
  'ss 1': 'SS 2', 'ss1': 'SS 2', 'sss 1': 'SS 2',
  'ss 2': 'SS 3', 'ss2': 'SS 3', 'sss 2': 'SS 3',
  'ss 3': 'Graduation', 'ss3': 'Graduation', 'sss 3': 'Graduation',
};

function getNextClass(currentClass) {
  if (!currentClass) return null;
  return PROMOTION_MAP[currentClass.trim().toLowerCase()] || null;
}

function resolveLogoPath(logoUrl) {
  if (!logoUrl) return null;
  try {
    const rel = logoUrl.startsWith('/') ? logoUrl.slice(1) : logoUrl;
    const abs = path.join(__dirname, '..', 'public', rel);
    if (fs.existsSync(abs)) return abs;
  } catch (e) { /* ignore */ }
  return null;
}

function fetchImageBuffer(url) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http')) return resolve(null);
    const client = url.startsWith('https') ? https : http;
    client.get(url, (resp) => {
      if (resp.statusCode !== 200) return resolve(null);
      const chunks = [];
      resp.on('data', (chunk) => chunks.push(chunk));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
      resp.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// Returns true for JSS/SS levels — these get "VP Academics" instead of "HM"
function isSecondaryLevel(currentClass) {
  if (!currentClass) return false;
  const key = currentClass.trim().toLowerCase();
  return key.startsWith('jss') || key.startsWith('ss') || key.startsWith('sss');
}

async function generateReportCard(res, params) {
  const { student, results, school, campus, term, session } = params;
  const fallback = CAMPUS_FALLBACK[campus] || CAMPUS_FALLBACK.Lagos;

  // School name: always use the canonical campus display name
  const schoolDisplayName = CAMPUS_DISPLAY_NAME[campus] || fallback.name;
  const schoolAddress = (school && school.address && school.address.trim())
    ? school.address.trim()
    : fallback.address;
  const schoolPhone = (school && school.phone && school.phone.trim())
    ? school.phone.trim()
    : '';

  const classLevel = getClassLevel(student.currentClass);
  const secondary = isSecondaryLevel(student.currentClass);

  // Fetch signature from URL
  const signatureUrl = school && school.signatureUrl ? school.signatureUrl.trim() : '';
  const signatureBuffer = signatureUrl ? await fetchImageBuffer(signatureUrl) : null;

  const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="result-${student.studentID}-${term}-${session}.pdf"`);
  doc.pipe(res);

  const PW = doc.page.width;   // 595
  const PH = doc.page.height;  // 842
  const ML = 40;
  const MR = 40;
  const CW = PW - ML - MR;    // content width = 515

  // ── WATERMARK ────────────────────────────────────────────────────────────────
  const logoUrl = school && school.logo ? school.logo : null;
  const logoPath = resolveLogoPath(logoUrl);
  if (logoPath) {
    try {
      const wSize = 460;
      doc.save();
      doc.opacity(0.13);
      doc.image(logoPath, (PW - wSize) / 2, (PH - wSize) / 2 - 30, { width: wSize, height: wSize });
      doc.restore();
    } catch (e) { /* skip watermark */ }
  }

  // ── TOP LOGO (rounded circle at top center) ───────────────────────────────────
  let cursorY = 30;
  const logoSize = 68;
  const logoCenterX = PW / 2;
  const logoCY = cursorY + logoSize / 2;

  if (logoPath) {
    try {
      // Clip to a circle then draw logo
      doc.save();
      doc.circle(logoCenterX, logoCY, logoSize / 2).clip();
      doc.image(logoPath, logoCenterX - logoSize / 2, cursorY, { width: logoSize, height: logoSize });
      doc.restore();
      // Draw a thin circle border around the logo
      doc.circle(logoCenterX, logoCY, logoSize / 2).lineWidth(0.8).stroke('#aaa');
    } catch (e) { /* skip top logo */ }
  }

  cursorY += logoSize + 8;

  // ── SCHOOL NAME (Times-BoldItalic — closest built-in decorative/script font) ──
  doc.fontSize(16).font('Times-BoldItalic').fillColor('#1a1a1a')
    .text(schoolDisplayName, ML, cursorY, { align: 'center', width: CW });
  cursorY += 22;

  // Address + phone on same line
  const phoneStr = schoolPhone ? `  |  Tel: ${schoolPhone}` : '';
  doc.fontSize(8.5).font('Helvetica').fillColor('#444')
    .text(`${schoolAddress}${phoneStr}`, ML, cursorY, { align: 'center', width: CW });
  cursorY += 16;

  doc.fontSize(12).font('Helvetica-BoldOblique').fillColor('#111')
    .text('Student Report Card', ML, cursorY, { align: 'center', width: CW });
  cursorY += 18;

  // Divider
  doc.moveTo(ML, cursorY).lineTo(PW - MR, cursorY).lineWidth(1).stroke('#999');
  cursorY += 10;

  // ── STUDENT INFO (2-column, NO Level row) ─────────────────────────────────────
  const col1X = ML;
  const col2X = ML + CW / 2 + 10;
  const rowH = 17;
  doc.fontSize(10).fillColor('black');

  // Extract year range only from session name
  const yearMatch = session ? session.match(/\d{4}[\/-]\d{4}/) : null;
  const sessionLabel = yearMatch ? `${yearMatch[0]} Academic Session` : 'Academic Session';

  const infoRow = (lbl1, val1, lbl2, val2) => {
    doc.font('Helvetica').fillColor('#555').text(`${lbl1}:`, col1X, cursorY, { continued: true })
      .font('Helvetica-Bold').fillColor('#111').text(` ${val1 || '-'}`, { lineBreak: false });
    if (lbl2) {
      doc.font('Helvetica').fillColor('#555').text(`${lbl2}:`, col2X, cursorY, { continued: true })
        .font('Helvetica-Bold').fillColor('#111').text(` ${val2 || '-'}`, { lineBreak: false });
    }
    cursorY += rowH;
  };

  infoRow('Name', student.fullName, 'Student ID', student.studentID);
  infoRow('Class', student.currentClass, 'Gender', student.gender || '-');
  // Session on its own full row to avoid clashing
  infoRow('Session', sessionLabel, null, null);
  infoRow('Term', term, null, null);

  doc.fillColor('black');
  cursorY += 6;

  // ── RESULTS TABLE ─────────────────────────────────────────────────────────────
  const cols = [
    { label: 'Subject',   width: 160 },
    { label: 'CA (40)',   width: 65  },
    { label: 'Exam (60)', width: 65  },
    { label: 'Total',     width: 55  },
    { label: 'Grade',     width: 55  },
    { label: 'Remark',    width: 115 },
  ];

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111');
  let cx = ML + 4;
  cols.forEach((col) => {
    doc.text(col.label, cx, cursorY + 3, { width: col.width - 4, lineBreak: false });
    cx += col.width;
  });
  cursorY += 16;
  doc.moveTo(ML, cursorY).lineTo(PW - MR, cursorY).lineWidth(0.5).stroke('#999');

  doc.font('Helvetica').fontSize(9).fillColor('#111');
  results.forEach((r) => {
    cx = ML + 4;
    [r.subject, r.ca1 || 0, r.exam || 0, r.total || 0, r.grade || '-', r.remark || '-'].forEach((val, i) => {
      doc.text(String(val), cx, cursorY + 3, { width: cols[i].width - 4, lineBreak: false });
      cx += cols[i].width;
    });
    cursorY += 15;
  });

  cursorY += 10;

  // ── SUMMARY ───────────────────────────────────────────────────────────────────
  const totalScore = results.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const average = results.length > 0 ? (totalScore / results.length).toFixed(1) : '0';

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111');
  doc.text(`Total Score: ${totalScore}     Average: ${average}%`, ML, cursorY);
  cursorY += 16;

  const nextClass = getNextClass(student.currentClass);
  const promoText = nextClass ? `Promoted to: ${nextClass}` : 'Will be promoted to the next class';
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a3c6e').text(promoText, ML, cursorY);
  doc.fillColor('black');
  cursorY += 18;

  // ── COMMENTS ─────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text("Class Teacher's Comment:", ML, cursorY);
  cursorY += 13;
  doc.font('Helvetica').fontSize(9).fillColor('#111')
    .text(student.teacherComment || 'Keep up the good work.', ML, cursorY, { width: CW });
  cursorY += 20;

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text("Director of Studies Comment:", ML, cursorY);
  cursorY += 13;
  doc.font('Helvetica').fontSize(9).fillColor('#111')
    .text(student.principalComment || 'Satisfactory progress.', ML, cursorY, { width: CW });
  cursorY += 30;

  // ── SIGNATURE ROW ─────────────────────────────────────────────────────────────
  // 3 columns: /Class Teacher/ | HM or VP Academics | Board of Directors (+ signature image)
  const sigColW = CW / 3;
  const leftX   = ML;
  const centerX = ML + sigColW;
  const rightX  = ML + sigColW * 2;

  const centerLabel = secondary ? 'VP Academics' : 'Headmistress';

  // Signature image goes above the RIGHT column line (Board of Directors)
  const lineTopY = cursorY + 36;
  const labelY   = lineTopY + 5;

  if (signatureBuffer) {
    try {
      const sigW = 100;
      const sigH = 32;
      const sigImgX = rightX + (sigColW - sigW) / 2;
      doc.image(signatureBuffer, sigImgX, cursorY, { width: sigW, height: sigH });
    } catch (e) { /* skip */ }
  }

  // Three signature lines
  const lineInset = 8;
  doc.lineWidth(0.8).strokeColor('#333');
  doc.moveTo(leftX + lineInset,   lineTopY).lineTo(leftX + sigColW - lineInset,   lineTopY).stroke();
  doc.moveTo(centerX + lineInset, lineTopY).lineTo(centerX + sigColW - lineInset, lineTopY).stroke();
  doc.moveTo(rightX + lineInset,  lineTopY).lineTo(rightX + sigColW - lineInset,  lineTopY).stroke();

  doc.font('Helvetica').fontSize(9).fillColor('#333');
  doc.text('/Class Teacher/', leftX,   labelY, { width: sigColW, align: 'center' });
  doc.text(centerLabel,       centerX, labelY, { width: sigColW, align: 'center' });
  doc.text('Board of Directors', rightX, labelY, { width: sigColW, align: 'center' });

  doc.end();
}

module.exports = { generateReportCard, CAMPUS_FALLBACK };
