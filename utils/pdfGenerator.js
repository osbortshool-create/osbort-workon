const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { getClassLevel } = require('./classLevel');

const CAMPUS_FALLBACK = {
  Ekiti: {
    name: 'Osbot International Schools, Ekiti State',
    address: 'Osbot Road, Aso Ayegunle, Ado-Ekiti, Ekiti State'
  },
  Lagos: {
    name: 'Osbot Group of Schools, Lagos State',
    address: '38 Unit Road, Isale Odo, Eleyin B/Stop, Ikole-Odunsi via Ipaja, Lagos State'
  }
};

const CAMPUS_DISPLAY_NAME = {
  Ekiti: 'Osbot International Schools, Ekiti State',
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

// Fetch a remote image as a Buffer, or read a local path as a Buffer
async function fetchImageBuffer(url) {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();

  // Local file path (e.g. /uploads/signature.png stored in public/)
  const localPath = resolveLogoPath(trimmed);
  if (localPath) {
    try { return fs.readFileSync(localPath); } catch (e) { /* fall through */ }
  }

  // Remote URL
  if (!trimmed.startsWith('http')) return null;
  return new Promise((resolve) => {
    const client = trimmed.startsWith('https') ? https : http;
    const request = client.get(trimmed, (resp) => {
      if (resp.statusCode !== 200) return resolve(null);
      const chunks = [];
      resp.on('data', (chunk) => chunks.push(chunk));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
      resp.on('error', () => resolve(null));
    });
    request.on('error', () => resolve(null));
    request.setTimeout(8000, () => { request.destroy(); resolve(null); });
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
  const ML = 38;
  const MR = 38;
  const CW = PW - ML - MR;    // ~519

  // ── WATERMARK ────────────────────────────────────────────────────────────────
  const logoUrl = school && school.logo ? school.logo : null;
  const logoPath = resolveLogoPath(logoUrl);
  if (logoPath) {
    try {
      const wSize = 380;
      doc.save();
      doc.opacity(0.11);
      doc.image(logoPath, (PW - wSize) / 2, (PH - wSize) / 2 - 20, { width: wSize, height: wSize });
      doc.restore();
    } catch (e) { /* skip */ }
  }

  // ── TOP LOGO ─────────────────────────────────────────────────────────────────
  let Y = 20;
  const logoSize = 62;
  const logoCX = PW / 2;
  const logoCY = Y + logoSize / 2;

  if (logoPath) {
    try {
      doc.save();
      doc.circle(logoCX, logoCY, logoSize / 2).clip();
      doc.image(logoPath, logoCX - logoSize / 2, Y, { width: logoSize, height: logoSize });
      doc.restore();
      doc.circle(logoCX, logoCY, logoSize / 2).lineWidth(0.7).strokeColor('#bbb').stroke();
    } catch (e) { /* skip */ }
  }

  Y += logoSize + 5;

  // ── SCHOOL NAME ───────────────────────────────────────────────────────────────
  doc.fontSize(14).font('Times-BoldItalic').fillColor('#111')
    .text(schoolDisplayName, ML, Y, { align: 'center', width: CW, lineBreak: false });
  Y += 17;

  // Address on its own line (wrapping allowed), phone on a second line if present
  doc.fontSize(7.5).font('Helvetica').fillColor('#555')
    .text(schoolAddress, ML, Y, { align: 'center', width: CW, lineBreak: false });
  Y += 12;
  if (schoolPhone) {
    doc.fontSize(7.5).font('Helvetica').fillColor('#555')
      .text(`Tel: ${schoolPhone}`, ML, Y, { align: 'center', width: CW, lineBreak: false });
    Y += 11;
  }

  doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#1a3c6e')
    .text('STUDENT REPORT CARD', ML, Y, { align: 'center', width: CW, lineBreak: false });
  Y += 13;

  doc.moveTo(ML, Y).lineTo(PW - MR, Y).lineWidth(1).strokeColor('#555').stroke();
  Y += 8;

  // ── STUDENT INFO ─────────────────────────────────────────────────────────────
  // Left column: Name, Class  |  Right column: Student ID, Gender, Term
  const yearMatch = session ? session.match(/\d{4}[\/-]\d{4}/) : null;
  const sessionLabel = yearMatch ? `${yearMatch[0]} Academic Session` : 'Academic Session';

  const infoLeftW  = CW * 0.46;   // name and class are longer
  const infoRightW = CW * 0.50;
  const c1 = ML;
  const c2 = ML + CW * 0.50;      // right column starts at 50% mark

  const infoH = 13.5;

  const infoField = (lbl, val, x, w) => {
    doc.font('Helvetica').fontSize(8.5).fillColor('#666')
      .text(`${lbl}:`, x, Y, { continued: true, lineBreak: false, width: w })
      .font('Helvetica-Bold').fillColor('#111')
      .text(` ${val || '-'}`, { lineBreak: false });
  };

  // Row 1
  infoField('Name',    student.fullName,      c1, infoLeftW);
  infoField('Student ID', student.studentID,  c2, infoRightW);
  Y += infoH;

  // Row 2
  infoField('Class',   student.currentClass,  c1, infoLeftW);
  infoField('Gender',  student.gender || '-', c2, infoRightW);
  Y += infoH;

  // Row 3 (session spans full width left; term on right)
  infoField('Session', sessionLabel,          c1, infoLeftW);
  infoField('Term',    term,                  c2, infoRightW);
  Y += infoH;

  doc.fillColor('black');
  Y += 10; // gap between info and table

  // ── RESULTS TABLE ─────────────────────────────────────────────────────────────
  const cols = [
    { label: 'Subject',    width: 156 },
    { label: 'CA (40)',    width: 57  },
    { label: 'Exam (60)', width: 57  },
    { label: 'Total',      width: 50  },
    { label: 'Grade',      width: 50  },
    { label: 'Remark',     width: 149 },
  ];

  // Header background
  doc.rect(ML, Y, CW, 16).fill('#e8edf4');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111');
  let cx = ML + 4;
  cols.forEach((col) => {
    doc.text(col.label, cx, Y + 3, { width: col.width - 4, lineBreak: false });
    cx += col.width;
  });
  Y += 16;
  doc.moveTo(ML, Y).lineTo(PW - MR, Y).lineWidth(0.5).strokeColor('#aaa').stroke();

  // Rows — alternating light shade
  results.forEach((r, idx) => {
    if (idx % 2 === 0) doc.rect(ML, Y, CW, 13).fill('#f8f9fb');
    doc.font('Helvetica').fontSize(8.5).fillColor('#111');
    cx = ML + 4;
    [r.subject, r.ca1 ?? 0, r.exam ?? 0, r.total ?? 0, r.grade || '-', r.remark || '-'].forEach((val, i) => {
      doc.text(String(val), cx, Y + 2, { width: cols[i].width - 4, lineBreak: false });
      cx += cols[i].width;
    });
    Y += 13;
  });

  doc.moveTo(ML, Y).lineTo(PW - MR, Y).lineWidth(0.5).strokeColor('#aaa').stroke();
  Y += 10;

  // ── SUMMARY ROW: Total Score | Average | Promoted To ─────────────────────────
  const totalScore = results.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const average    = results.length > 0 ? (totalScore / results.length).toFixed(1) : '0';
  const nextClass  = getNextClass(student.currentClass);
  const promoText  = nextClass ? `Promoted to: ${nextClass}` : 'Will be promoted to next class';

  const sumColW = CW / 3;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111');
  doc.text(`Total Score: ${totalScore}`, ML,            Y, { width: sumColW, align: 'left',   lineBreak: false });
  doc.text(`Average: ${average}%`,       ML + sumColW,  Y, { width: sumColW, align: 'center', lineBreak: false });
  doc.text(promoText,                    ML + sumColW*2, Y, { width: sumColW, align: 'right',  lineBreak: false });
  Y += 18;

  // ── COMMENTS (side by side, label: text inline) ───────────────────────────────
  const cmtColW = CW / 2 - 8;
  const cmtLeft = ML;
  const cmtRight = ML + CW / 2 + 8;

  const tcText = student.teacherComment || 'Keep up the good work.';
  const dsText = student.principalComment || 'Satisfactory progress.';

  // Teacher comment
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333')
    .text("Class Teacher's Comment: ", cmtLeft, Y, { continued: true, lineBreak: false, width: cmtColW })
    .font('Helvetica').fillColor('#111')
    .text(tcText, { lineBreak: false });

  // Director of Studies comment (same Y)
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333')
    .text("Director of Studies Comment: ", cmtRight, Y, { continued: true, lineBreak: false, width: cmtColW })
    .font('Helvetica').fillColor('#111')
    .text(dsText, { lineBreak: false });

  const tcH = doc.heightOfString(`Class Teacher's Comment: ${tcText}`, { width: cmtColW });
  const dsH = doc.heightOfString(`Director of Studies Comment: ${dsText}`, { width: cmtColW });
  Y += Math.max(tcH, dsH) + 20;

  // ── SIGNATURE ROW ─────────────────────────────────────────────────────────────
  const sigColW = CW / 3;
  const s1 = ML;
  const s2 = ML + sigColW;
  const s3 = ML + sigColW * 2;

  const centerLabel = secondary ? 'VP Academics' : 'Headmistress';

  // Signature image sits ABOVE the line for Board of Directors
  const sigImgH = 26;
  const lineY   = Y + sigImgH + 4;

  if (signatureBuffer) {
    try {
      const sigW = 80;
      const sigImgX = s3 + (sigColW - sigW) / 2;
      doc.image(signatureBuffer, sigImgX, Y, { width: sigW, height: sigImgH, fit: [sigW, sigImgH] });
    } catch (e) { /* skip signature image */ }
  }

  const pad = 10;
  doc.lineWidth(0.7).strokeColor('#444');
  doc.moveTo(s1 + pad, lineY).lineTo(s1 + sigColW - pad, lineY).stroke();
  doc.moveTo(s2 + pad, lineY).lineTo(s2 + sigColW - pad, lineY).stroke();
  doc.moveTo(s3 + pad, lineY).lineTo(s3 + sigColW - pad, lineY).stroke();

  const lblY = lineY + 4;
  doc.font('Helvetica').fontSize(8.5).fillColor('#333');
  doc.text('Class Teacher',       s1, lblY, { width: sigColW, align: 'center', lineBreak: false });
  doc.text(centerLabel,           s2, lblY, { width: sigColW, align: 'center', lineBreak: false });
  doc.text('Board of Directors',  s3, lblY, { width: sigColW, align: 'center', lineBreak: false });

  doc.end();
}

module.exports = { generateReportCard, CAMPUS_FALLBACK };
