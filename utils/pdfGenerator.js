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
  'ss 1': 'SS 2',  'ss1': 'SS 2',  'sss 1': 'SS 2',
  'ss 2': 'SS 3',  'ss2': 'SS 3',  'sss 2': 'SS 3',
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

async function fetchImageBuffer(url) {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();
  const localPath = resolveLogoPath(trimmed);
  if (localPath) {
    try { return fs.readFileSync(localPath); } catch (e) { /* fall through */ }
  }
  if (!trimmed.startsWith('http')) return null;
  return new Promise((resolve) => {
    const client = trimmed.startsWith('https') ? https : http;
    const request = client.get(trimmed, (resp) => {
      if (resp.statusCode !== 200) return resolve(null);
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
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

  // Equal margins on both sides so content is perfectly centered
  const ML = 48;
  const MR = 48;
  const CW = PW - ML - MR;    // 499.28

  // ── Column layout (must match exactly so right info aligns under Remarks) ──
  // Table columns total must equal CW
  const COL_SUBJECT = 148;
  const COL_CA      = 52;
  const COL_EXAM    = 56;
  const COL_TOTAL   = 48;
  const COL_GRADE   = 48;
  const COL_REMARKS = CW - COL_SUBJECT - COL_CA - COL_EXAM - COL_TOTAL - COL_GRADE; // ~147

  const tableColX = [
    ML,
    ML + COL_SUBJECT,
    ML + COL_SUBJECT + COL_CA,
    ML + COL_SUBJECT + COL_CA + COL_EXAM,
    ML + COL_SUBJECT + COL_CA + COL_EXAM + COL_TOTAL,
    ML + COL_SUBJECT + COL_CA + COL_EXAM + COL_TOTAL + COL_GRADE,
  ];
  const REMARKS_X = tableColX[5]; // x where Remarks column starts

  // Right info column aligns at the Remarks column start
  const INFO_LEFT_W  = REMARKS_X - ML - 4;  // left info column width
  const INFO_RIGHT_X = REMARKS_X;            // right info column starts exactly at Remarks
  const INFO_RIGHT_W = ML + CW - REMARKS_X; // remaining width

  // ── WATERMARK ────────────────────────────────────────────────────────────────
  const logoUrl = school && school.logo ? school.logo : null;
  const logoPath = resolveLogoPath(logoUrl);
  if (logoPath) {
    try {
      const wSize = 360;
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

  doc.moveTo(ML, Y).lineTo(ML + CW, Y).lineWidth(1).strokeColor('#555').stroke();
  Y += 8;

  // ── STUDENT INFO ─────────────────────────────────────────────────────────────
  const yearMatch = session ? session.match(/\d{4}[\/-]\d{4}/) : null;
  const sessionLabel = yearMatch ? `${yearMatch[0]} Academic Session` : 'Academic Session';

  const infoH = 14;

  const infoField = (lbl, val, x, w) => {
    doc.font('Helvetica').fontSize(8.5).fillColor('#555')
      .text(`${lbl}:`, x, Y, { continued: true, lineBreak: false, width: w })
      .font('Helvetica-Bold').fillColor('#111')
      .text(` ${val || '-'}`, { lineBreak: false });
  };

  infoField('Name',       student.fullName,      ML,           INFO_LEFT_W);
  infoField('Student ID', student.studentID,     INFO_RIGHT_X, INFO_RIGHT_W);
  Y += infoH;

  infoField('Class',   student.currentClass,    ML,           INFO_LEFT_W);
  infoField('Gender',  student.gender || '-',   INFO_RIGHT_X, INFO_RIGHT_W);
  Y += infoH;

  infoField('Session', sessionLabel,            ML,           INFO_LEFT_W);
  infoField('Term',    term,                    INFO_RIGHT_X, INFO_RIGHT_W);
  Y += infoH;

  doc.fillColor('black');
  Y += 12; // gap before table

  // ── RESULTS TABLE ─────────────────────────────────────────────────────────────
  const tableCols = [
    { label: 'Subjects',   width: COL_SUBJECT },
    { label: 'CA (40)',    width: COL_CA      },
    { label: 'Exam (60)', width: COL_EXAM    },
    { label: 'Total',      width: COL_TOTAL   },
    { label: 'Grade',      width: COL_GRADE   },
    { label: 'Remarks',    width: COL_REMARKS },
  ];

  // How tall should each data row be? Spread rows to fill page nicely.
  // Remaining page height after table header up to ~Y+730
  const tableHeaderH = 17;
  const bottomReserve = 115; // space for summary + comments + signatures
  const availableForRows = PH - Y - tableHeaderH - bottomReserve;
  const rowCount = results.length || 1;
  // Row height between 15 and 26 — stretch rows to fill available space
  const rowH = Math.min(26, Math.max(15, Math.floor(availableForRows / rowCount)));

  // Header
  doc.rect(ML, Y, CW, tableHeaderH).fill('#dde3ed');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111');
  tableCols.forEach((col, i) => {
    doc.text(col.label, tableColX[i] + 4, Y + 4, { width: col.width - 6, lineBreak: false });
  });
  Y += tableHeaderH;
  doc.moveTo(ML, Y).lineTo(ML + CW, Y).lineWidth(0.5).strokeColor('#aaa').stroke();

  // Data rows with calculated row height
  results.forEach((r, idx) => {
    if (idx % 2 === 0) doc.rect(ML, Y, CW, rowH).fill('#f7f9fb');
    doc.font('Helvetica').fontSize(8.5).fillColor('#111');
    const vals = [r.subject, r.ca1 ?? 0, r.exam ?? 0, r.total ?? 0, r.grade || '-', r.remark || '-'];
    vals.forEach((val, i) => {
      doc.text(String(val), tableColX[i] + 4, Y + (rowH - 9) / 2 + 1, {
        width: tableCols[i].width - 6,
        lineBreak: false
      });
    });
    Y += rowH;
  });

  doc.moveTo(ML, Y).lineTo(ML + CW, Y).lineWidth(0.5).strokeColor('#aaa').stroke();
  Y += 12;

  // ── SUMMARY: Total Score | Average (center) | Promoted To (right) ─────────────
  const totalScore = results.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const average    = results.length > 0 ? (totalScore / results.length).toFixed(1) : '0';
  const nextClass  = getNextClass(student.currentClass);
  const promoText  = nextClass ? `Promoted to: ${nextClass}` : 'Will be promoted to next class';

  const sumColW = CW / 3;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111');
  doc.text(`Total Score: ${totalScore}`, ML,              Y, { width: sumColW, align: 'left',   lineBreak: false });
  doc.text(`Average: ${average}%`,       ML + sumColW,    Y, { width: sumColW, align: 'center', lineBreak: false });
  doc.text(promoText,                    ML + sumColW * 2, Y, { width: sumColW, align: 'right',  lineBreak: false });
  Y += 18;

  // ── COMMENTS: side by side, label inline before text ─────────────────────────
  // Left comment aligns from ML; right comment aligns from INFO_RIGHT_X (= REMARKS_X)
  const cmtLeftW  = INFO_LEFT_W;
  const cmtRightW = INFO_RIGHT_W;

  const tcText = student.teacherComment   || 'Keep up the good work.';
  const dsText = student.principalComment || 'Satisfactory progress.';

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333')
    .text("Class Teacher's Comment: ", ML, Y, { continued: true, lineBreak: false, width: cmtLeftW })
    .font('Helvetica').fillColor('#111')
    .text(tcText, { lineBreak: false, width: cmtLeftW });

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333')
    .text("Director of Studies Comment: ", INFO_RIGHT_X, Y, { continued: true, lineBreak: false, width: cmtRightW })
    .font('Helvetica').fillColor('#111')
    .text(dsText, { lineBreak: false, width: cmtRightW });

  const tcH = doc.heightOfString(`Class Teacher's Comment: ${tcText}`, { width: cmtLeftW });
  const dsH = doc.heightOfString(`Director of Studies Comment: ${dsText}`, { width: cmtRightW });
  Y += Math.max(tcH, dsH) + 22;

  // ── SIGNATURE ROW ─────────────────────────────────────────────────────────────
  const sigColW    = CW / 3;
  const s1 = ML;
  const s2 = ML + sigColW;
  const s3 = ML + sigColW * 2;
  const centerLabel = secondary ? 'VP Academics' : 'Headmistress';

  // Signature image above the Director of Studies line
  const sigImgH = 26;
  const lineY   = Y + sigImgH + 4;

  if (signatureBuffer) {
    try {
      const sigW = 78;
      doc.image(signatureBuffer, s3 + (sigColW - sigW) / 2, Y, {
        width: sigW, height: sigImgH, fit: [sigW, sigImgH]
      });
    } catch (e) { /* skip */ }
  }

  const pad = 10;
  doc.lineWidth(0.7).strokeColor('#444');
  doc.moveTo(s1 + pad, lineY).lineTo(s1 + sigColW - pad, lineY).stroke();
  doc.moveTo(s2 + pad, lineY).lineTo(s2 + sigColW - pad, lineY).stroke();
  doc.moveTo(s3 + pad, lineY).lineTo(s3 + sigColW - pad, lineY).stroke();

  const lblY = lineY + 4;
  doc.font('Helvetica').fontSize(8.5).fillColor('#333');
  doc.text('Class Teacher',      s1, lblY, { width: sigColW, align: 'center', lineBreak: false });
  doc.text(centerLabel,          s2, lblY, { width: sigColW, align: 'center', lineBreak: false });
  doc.text('Director of Studies', s3, lblY, { width: sigColW, align: 'center', lineBreak: false });

  doc.end();
}

module.exports = { generateReportCard, CAMPUS_FALLBACK };
