const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { getClassLevel } = require('./classLevel');

const CAMPUS_ADDRESSES = {
  Ekiti: {
    name: 'OSBOT INTERNATIONAL SCHOOLS',
    address: 'Osbot Road, Aso Ayegunle, Ado-Ekiti, Ekiti State'
  },
  Lagos: {
    name: 'OSBOT ROYAL SCHOOLS',
    address: '38 Unit Road, Isale Odo, Eleyin B/Stop, Ikole-Odunsi via Ipaja, Lagos State.'
  }
};

function getCampusHeader(campus) {
  return CAMPUS_ADDRESSES[campus] || CAMPUS_ADDRESSES.Lagos;
}

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

// Fetch image from URL and return as Buffer (supports http and https)
function fetchImageBuffer(url) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http')) return resolve(null);
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

async function generateReportCard(res, params) {
  const { student, results, school, campus, term, session } = params;
  const fallbackHeader = getCampusHeader(campus);

  const schoolName = (school && school.name && school.name.trim())
    ? school.name.trim().toUpperCase()
    : fallbackHeader.name;
  const schoolAddress = (school && school.address && school.address.trim())
    ? school.address.trim()
    : fallbackHeader.address;

  const classLevel = getClassLevel(student.currentClass);

  // Fetch signature from URL (non-blocking — if it fails, we skip it)
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
  const contentWidth = PW - ML - MR;

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

  // ── HEADER ───────────────────────────────────────────────────────────────────
  let cursorY = 38;

  doc.fontSize(17).font('Helvetica-Bold')
    .text(schoolName, ML, cursorY, { align: 'center', width: contentWidth });
  cursorY += 26;

  doc.fontSize(9).font('Helvetica')
    .text(schoolAddress, ML, cursorY, { align: 'center', width: contentWidth });
  cursorY += 20;

  doc.fontSize(13).font('Helvetica-BoldOblique')
    .text('Student Report Card', ML, cursorY, { align: 'center', width: contentWidth });
  cursorY += 22;

  // Divider line
  doc.moveTo(ML, cursorY).lineTo(PW - MR, cursorY).lineWidth(1).stroke();
  cursorY += 12;

  // ── STUDENT INFO GRID ─────────────────────────────────────────────────────────
  const col1X = ML;
  const col2X = ML + contentWidth / 2 + 10;
  const rowH = 18;
  doc.fontSize(10);

  // Extract only the year range (e.g. "2025/2026") from whatever was stored as session name
  const yearMatch = session ? session.match(/\d{4}[\/-]\d{4}/) : null;
  const sessionLabel = yearMatch ? `${yearMatch[0]} Academic Session` : 'Academic Session';

  // Row helper
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
  infoRow('Class', student.currentClass, 'Level', classLevel.charAt(0).toUpperCase() + classLevel.slice(1));
  // Session gets its own full row — no Term next to it, so it never clashes
  infoRow('Session', sessionLabel, null, null);
  infoRow('Term', term, 'Gender', student.gender || '-');

  doc.fillColor('black');
  cursorY += 8;

  // ── RESULTS TABLE ─────────────────────────────────────────────────────────────
  const cols = [
    { label: 'Subject',    width: 160, key: 'subject' },
    { label: 'CA (40)',    width: 65,  key: 'ca1' },
    { label: 'Exam (60)', width: 65,  key: 'exam' },
    { label: 'Total',      width: 55,  key: 'total' },
    { label: 'Grade',      width: 55,  key: 'grade' },
    { label: 'Remark',     width: 115, key: 'remark' },
  ];

  // Table header row
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111');
  let cx = ML + 4;
  cols.forEach((col) => {
    doc.text(col.label, cx, cursorY + 3, { width: col.width - 4, lineBreak: false });
    cx += col.width;
  });
  cursorY += 16;
  doc.moveTo(ML, cursorY).lineTo(PW - MR, cursorY).lineWidth(0.5).stroke();

  doc.fillColor('black').font('Helvetica').fontSize(9);
  let rowIndex = 0;
  results.forEach((r) => {
    doc.fillColor('#111');
    cx = ML + 4;
    [r.subject, r.ca1 || 0, r.exam || 0, r.total || 0, r.grade || '-', r.remark || '-'].forEach((val, i) => {
      doc.text(String(val), cx, cursorY + 3, { width: cols[i].width - 4, lineBreak: false });
      cx += cols[i].width;
    });
    cursorY += 15;
    rowIndex++;
  });

  cursorY += 12;

  // ── SUMMARY ───────────────────────────────────────────────────────────────────
  const totalScore = results.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const average = results.length > 0 ? (totalScore / results.length).toFixed(1) : '0';

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111');
  doc.text(`Total Score: ${totalScore}`, ML, cursorY, { continued: true });
  doc.text(`     Average: ${average}%`, { continued: false });
  cursorY += 18;

  // Promotion line
  const nextClass = getNextClass(student.currentClass);
  const promoText = nextClass ? `Promoted to: ${nextClass}` : 'Will be promoted to the next class';
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a3c6e')
    .text(promoText, ML, cursorY);
  doc.fillColor('black');
  cursorY += 20;

  // ── COMMENTS ─────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text("Class Teacher's Comment:", ML, cursorY);
  cursorY += 13;
  doc.font('Helvetica').fontSize(9).fillColor('#111')
    .text(student.teacherComment || 'Keep up the good work.', ML, cursorY, { width: contentWidth });
  cursorY += 22;

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text("Director of Studies Comment:", ML, cursorY);
  cursorY += 13;
  doc.font('Helvetica').fontSize(9).fillColor('#111')
    .text(student.principalComment || 'Satisfactory progress.', ML, cursorY, { width: contentWidth });
  cursorY += 28;

  cursorY += 18;

  // ── SIGNATURE ROW ─────────────────────────────────────────────────────────────
  // Layout: left 1/3 = Class Teacher, center 1/3 = Director of Studies, right 1/3 = Parent/Guardian
  const sigColW = contentWidth / 3;
  const leftX   = ML;
  const centerX = ML + sigColW;
  const rightX  = ML + sigColW * 2;

  const lineTopY = cursorY + 38;   // where the signature line sits
  const labelY   = lineTopY + 5;   // label just below the line

  // Center: signature image above line (if available)
  if (signatureBuffer) {
    try {
      const sigW = 100;
      const sigH = 34;
      const sigImgX = centerX + (sigColW - sigW) / 2;
      doc.image(signatureBuffer, sigImgX, cursorY, { width: sigW, height: sigH });
    } catch (e) { /* skip */ }
  }

  // Draw the three lines
  const lineInset = 10;
  doc.lineWidth(0.8);
  doc.moveTo(leftX + lineInset, lineTopY).lineTo(leftX + sigColW - lineInset, lineTopY).stroke();
  doc.moveTo(centerX + lineInset, lineTopY).lineTo(centerX + sigColW - lineInset, lineTopY).stroke();
  doc.moveTo(rightX + lineInset, lineTopY).lineTo(rightX + sigColW - lineInset, lineTopY).stroke();

  // Labels — styled with slashes for Class Teacher and Parent/Guardian as in the reference image
  doc.font('Helvetica').fontSize(9).fillColor('#333');

  doc.text('/Class Teacher/', leftX, labelY, { width: sigColW, align: 'center' });
  doc.text('Director of Studies', centerX, labelY, { width: sigColW, align: 'center' });
  doc.text('/Parent & Guardian/', rightX, labelY, { width: sigColW, align: 'center' });

  doc.end();
}

module.exports = { generateReportCard, getCampusHeader, CAMPUS_ADDRESSES };
