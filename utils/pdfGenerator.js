const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { getClassLevel } = require('./classLevel');

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

function isSecondaryLevel(currentClass) {
  if (!currentClass) return false;
  const key = currentClass.trim().toLowerCase();
  return key.startsWith('jss') || key.startsWith('ss') || key.startsWith('sss');
}

async function generateReportCard(res, params) {
  const { student, results, school, campus, term, session } = params;
  const fallback = CAMPUS_FALLBACK[campus] || CAMPUS_FALLBACK.Lagos;

  const schoolDisplayName = CAMPUS_DISPLAY_NAME[campus] || fallback.name;
  const schoolAddress = (school && school.address && school.address.trim())
    ? school.address.trim() : fallback.address;
  const schoolPhone = (school && school.phone && school.phone.trim())
    ? school.phone.trim() : '';

  const secondary = isSecondaryLevel(student.currentClass);

  const signatureUrl = school && school.signatureUrl ? school.signatureUrl.trim() : '';
  const signatureBuffer = signatureUrl ? await fetchImageBuffer(signatureUrl) : null;

  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="result-${student.studentID}-${term}-${session}.pdf"`);
  doc.pipe(res);

  const PW = doc.page.width;   // 595.28
  const PH = doc.page.height;  // 841.89
  const ML = 36;
  const MR = 36;
  const CW = PW - ML - MR;    // ~523

  // ── WATERMARK ────────────────────────────────────────────────────────────────
  const logoUrl = school && school.logo ? school.logo : null;
  const logoPath = resolveLogoPath(logoUrl);
  if (logoPath) {
    try {
      const wSize = 400;
      doc.save();
      doc.opacity(0.12);
      doc.image(logoPath, (PW - wSize) / 2, (PH - wSize) / 2 - 20, { width: wSize, height: wSize });
      doc.restore();
    } catch (e) { /* skip */ }
  }

  // ── TOP LOGO ─────────────────────────────────────────────────────────────────
  let Y = 22;
  const logoSize = 60;
  const logoCX = PW / 2;
  const logoCY = Y + logoSize / 2;

  if (logoPath) {
    try {
      doc.save();
      doc.circle(logoCX, logoCY, logoSize / 2).clip();
      doc.image(logoPath, logoCX - logoSize / 2, Y, { width: logoSize, height: logoSize });
      doc.restore();
      doc.circle(logoCX, logoCY, logoSize / 2).lineWidth(0.7).stroke('#bbb');
    } catch (e) { /* skip */ }
  }

  Y += logoSize + 6;

  // ── SCHOOL NAME ───────────────────────────────────────────────────────────────
  doc.fontSize(15).font('Times-BoldItalic').fillColor('#111')
    .text(schoolDisplayName, ML, Y, { align: 'center', width: CW, lineBreak: false });
  Y += 18;

  const phoneStr = schoolPhone ? `  |  Tel: ${schoolPhone}` : '';
  doc.fontSize(8).font('Helvetica').fillColor('#555')
    .text(`${schoolAddress}${phoneStr}`, ML, Y, { align: 'center', width: CW, lineBreak: false });
  Y += 14;

  doc.fontSize(11).font('Helvetica-Bold').fillColor('#222')
    .text('STUDENT REPORT CARD', ML, Y, { align: 'center', width: CW, lineBreak: false });
  Y += 14;

  doc.moveTo(ML, Y).lineTo(PW - MR, Y).lineWidth(1).stroke('#888');
  Y += 7;

  // ── STUDENT INFO (2-column grid) ──────────────────────────────────────────────
  const yearMatch = session ? session.match(/\d{4}[\/-]\d{4}/) : null;
  const sessionLabel = yearMatch ? `${yearMatch[0]} Academic Session` : 'Academic Session';

  const halfW = CW / 2 - 4;
  const c1 = ML;
  const c2 = ML + CW / 2 + 4;
  const infoH = 14;

  const infoRow = (l1, v1, l2, v2) => {
    doc.font('Helvetica').fontSize(8.5).fillColor('#666')
      .text(`${l1}:`, c1, Y, { continued: true, lineBreak: false })
      .font('Helvetica-Bold').fillColor('#111')
      .text(` ${v1 || '-'}`, { lineBreak: false });
    if (l2) {
      doc.font('Helvetica').fontSize(8.5).fillColor('#666')
        .text(`${l2}:`, c2, Y, { continued: true, lineBreak: false })
        .font('Helvetica-Bold').fillColor('#111')
        .text(` ${v2 || '-'}`, { lineBreak: false });
    }
    Y += infoH;
  };

  infoRow('Name', student.fullName, 'Student ID', student.studentID);
  infoRow('Class', student.currentClass, 'Gender', student.gender || '-');
  infoRow('Session', sessionLabel, 'Term', term);

  doc.fillColor('black');
  Y += 5;

  // ── RESULTS TABLE ─────────────────────────────────────────────────────────────
  const cols = [
    { label: 'Subject',    width: 155 },
    { label: 'CA (40)',    width: 58  },
    { label: 'Exam (60)', width: 58  },
    { label: 'Total',      width: 52  },
    { label: 'Grade',      width: 52  },
    { label: 'Remark',     width: 148 },
  ];

  // Header
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111');
  let cx = ML + 3;
  cols.forEach((col) => {
    doc.text(col.label, cx, Y + 2, { width: col.width - 3, lineBreak: false });
    cx += col.width;
  });
  Y += 14;
  doc.moveTo(ML, Y).lineTo(PW - MR, Y).lineWidth(0.5).stroke('#aaa');

  // Rows
  doc.font('Helvetica').fontSize(8.5).fillColor('#111');
  results.forEach((r) => {
    cx = ML + 3;
    [r.subject, r.ca1 ?? 0, r.exam ?? 0, r.total ?? 0, r.grade || '-', r.remark || '-'].forEach((val, i) => {
      doc.text(String(val), cx, Y + 2, { width: cols[i].width - 3, lineBreak: false });
      cx += cols[i].width;
    });
    Y += 13;
  });
  Y += 6;

  // ── SUMMARY ───────────────────────────────────────────────────────────────────
  const totalScore = results.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const average = results.length > 0 ? (totalScore / results.length).toFixed(1) : '0';
  const nextClass = getNextClass(student.currentClass);
  const promoText = nextClass ? `Promoted to: ${nextClass}` : 'Will be promoted to the next class';

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111')
    .text(`Total Score: ${totalScore}     Average: ${average}%     ${promoText}`, ML, Y, { width: CW, lineBreak: false });
  Y += 14;

  // ── COMMENTS (side by side) ───────────────────────────────────────────────────
  const cmtW = CW / 2 - 6;
  const cmtR = ML + CW / 2 + 6;

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333')
    .text("Class Teacher's Comment:", ML, Y, { width: cmtW, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333')
    .text("Director of Studies Comment:", cmtR, Y, { width: cmtW, lineBreak: false });
  Y += 12;

  const tcText = student.teacherComment || 'Keep up the good work.';
  const dsText = student.principalComment || 'Satisfactory progress.';
  doc.font('Helvetica').fontSize(8.5).fillColor('#111')
    .text(tcText, ML, Y, { width: cmtW });
  doc.font('Helvetica').fontSize(8.5).fillColor('#111')
    .text(dsText, cmtR, Y, { width: cmtW });

  // Advance Y past whichever comment was taller
  const tcH = doc.heightOfString(tcText, { width: cmtW, fontSize: 8.5 });
  const dsH = doc.heightOfString(dsText, { width: cmtW, fontSize: 8.5 });
  Y += Math.max(tcH, dsH) + 16;

  // ── SIGNATURE ROW ─────────────────────────────────────────────────────────────
  const sigColW = CW / 3;
  const s1 = ML;
  const s2 = ML + sigColW;
  const s3 = ML + sigColW * 2;

  const centerLabel = secondary ? 'VP Academics' : 'Headmistress';

  // Signature image above Board of Directors line
  if (signatureBuffer) {
    try {
      const sigW = 90;
      const sigH = 28;
      doc.image(signatureBuffer, s3 + (sigColW - sigW) / 2, Y, { width: sigW, height: sigH });
    } catch (e) { /* skip */ }
  }

  const lineY = Y + 32;
  const pad = 8;
  doc.lineWidth(0.7).strokeColor('#444');
  doc.moveTo(s1 + pad, lineY).lineTo(s1 + sigColW - pad, lineY).stroke();
  doc.moveTo(s2 + pad, lineY).lineTo(s2 + sigColW - pad, lineY).stroke();
  doc.moveTo(s3 + pad, lineY).lineTo(s3 + sigColW - pad, lineY).stroke();

  const lblY = lineY + 4;
  doc.font('Helvetica').fontSize(8.5).fillColor('#333');
  doc.text('Class Teacher', s1, lblY, { width: sigColW, align: 'center', lineBreak: false });
  doc.text(centerLabel,     s2, lblY, { width: sigColW, align: 'center', lineBreak: false });
  doc.text('Board of Directors', s3, lblY, { width: sigColW, align: 'center', lineBreak: false });

  doc.end();
}

module.exports = { generateReportCard, CAMPUS_FALLBACK };
