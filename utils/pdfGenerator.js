const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { getClassLevel, getGradeInfo, getScoreStructure } = require('./classLevel');

const CAMPUS_ADDRESSES = {
  Ekiti: {
    name: 'OSBOT INTERNATIONAL SCHOOLS',
    address: 'Osbot Road, Aso Ayegunle, Ado-Ekiti, Ekiti State'
  },
  Lagos: {
    name: 'OSBOT ROYAL SCHOOLS',
    address: '38 Unit Road, Isale Odo, Eleyin B/Stop, Ikole-Odunsi via Ipaja, Lagos State. 10 Erimope Crescent, Ikola-Odunsi via Ipaja, Lagos State.'
  }
};

function getCampusHeader(campus) {
  return CAMPUS_ADDRESSES[campus] || CAMPUS_ADDRESSES.Lagos;
}

// Maps a class name to the next class the student will be promoted to
const PROMOTION_MAP = {
  // Pre-primary
  'prep': 'KG 1',
  'preparatory': 'KG 1',
  'pre-nursery': 'KG 1',
  'prenursery': 'KG 1',
  // KG
  'kg 1': 'KG 2',
  'kg1': 'KG 2',
  'kindergarten 1': 'KG 2',
  'kg 2': 'Nursery 1',
  'kg2': 'Nursery 1',
  'kindergarten 2': 'Nursery 1',
  // Nursery
  'nursery 1': 'Nursery 2',
  'nursery1': 'Nursery 2',
  'nursery 2': 'Primary 1',
  'nursery2': 'Primary 1',
  // Primary
  'primary 1': 'Primary 2',
  'primary1': 'Primary 2',
  'pry 1': 'Primary 2',
  'primary 2': 'Primary 3',
  'primary2': 'Primary 3',
  'pry 2': 'Primary 3',
  'primary 3': 'Primary 4',
  'primary3': 'Primary 4',
  'pry 3': 'Primary 4',
  'primary 4': 'Primary 5',
  'primary4': 'Primary 5',
  'pry 4': 'Primary 5',
  'primary 5': 'JSS 1',
  'primary5': 'JSS 1',
  'pry 5': 'JSS 1',
  // JSS
  'jss 1': 'JSS 2',
  'jss1': 'JSS 2',
  'jss 2': 'JSS 3',
  'jss2': 'JSS 3',
  'jss 3': 'SS 1',
  'jss3': 'SS 1',
  // SS
  'ss 1': 'SS 2',
  'ss1': 'SS 2',
  'sss 1': 'SS 2',
  'ss 2': 'SS 3',
  'ss2': 'SS 3',
  'sss 2': 'SS 3',
  'ss 3': 'Graduation',
  'ss3': 'Graduation',
  'sss 3': 'Graduation',
};

function getNextClass(currentClass) {
  if (!currentClass) return null;
  const key = currentClass.trim().toLowerCase();
  return PROMOTION_MAP[key] || null;
}

// Resolve logo path from a stored URL like /uploads/xxx.png or /images/xxx.png
function resolveLogoPath(logoUrl) {
  if (!logoUrl) return null;
  try {
    // logoUrl is typically '/uploads/filename.ext' or '/images/filename.ext'
    const rel = logoUrl.startsWith('/') ? logoUrl.slice(1) : logoUrl;
    const abs = path.join(__dirname, '..', 'public', rel);
    if (fs.existsSync(abs)) return abs;
  } catch (e) { /* ignore */ }
  return null;
}

// Path to the director of studies signature image.
// Place the signature file at: public/images/director-signature.png
// (PNG with transparent background works best)
const SIGNATURE_PATH = path.join(__dirname, '..', 'public', 'images', 'director-signature.png');
// Also accept JPEG variant
const SIGNATURE_PATH_JPG = path.join(__dirname, '..', 'public', 'images', 'director-signature.jpg');

function resolveSignaturePath() {
  if (fs.existsSync(SIGNATURE_PATH)) return SIGNATURE_PATH;
  if (fs.existsSync(SIGNATURE_PATH_JPG)) return SIGNATURE_PATH_JPG;
  return null;
}

function generateReportCard(res, params) {
  const { student, results, classResults, school, campus, term, session, classPosition } = params;
  const fallbackHeader = getCampusHeader(campus);

  // Use school settings name/address if available, else fall back to hardcoded
  const schoolName = (school && school.name && school.name.trim()) ? school.name.trim().toUpperCase() : fallbackHeader.name;
  const schoolAddress = (school && school.address && school.address.trim()) ? school.address.trim() : fallbackHeader.address;

  const classLevel = getClassLevel(student.currentClass);
  const isPrimary = classLevel === 'primary';

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="result-${student.studentID}-${term}-${session}.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;   // 595
  const pageHeight = doc.page.height; // 842
  const margin = 40;

  // ── WATERMARK LOGO ──────────────────────────────────────────────────────────
  const logoUrl = school && school.logo ? school.logo : null;
  const logoPath = resolveLogoPath(logoUrl);
  if (logoPath) {
    try {
      const logoSize = 320;
      const logoX = (pageWidth - logoSize) / 2;
      const logoY = (pageHeight - logoSize) / 2 - 20;
      doc.save();
      doc.opacity(0.10);
      doc.image(logoPath, logoX, logoY, { width: logoSize, height: logoSize });
      doc.restore();
    } catch (e) { /* skip watermark if image fails */ }
  }

  // ── HEADER ───────────────────────────────────────────────────────────────────
  doc.fontSize(18).font('Helvetica-Bold').text(schoolName, margin, 40, { align: 'center', width: pageWidth - margin * 2 });
  doc.moveDown(0.2);
  doc.fontSize(9).font('Helvetica').text(schoolAddress, { align: 'center', width: pageWidth - margin * 2 });
  doc.moveDown(0.3);
  // "Student Report Card" in bold italic, no campus label
  doc.fontSize(12).font('Helvetica-BoldOblique').text('Student Report Card', { align: 'center', width: pageWidth - margin * 2 });
  doc.moveDown(1);

  // ── STUDENT INFO ─────────────────────────────────────────────────────────────
  doc.fontSize(10).font('Helvetica');
  const infoY = doc.y;
  doc.font('Helvetica').text(`Name: `, 40, infoY, { continued: true }).font('Helvetica-Bold').text(student.fullName);
  doc.font('Helvetica').text(`Student ID: `, 320, infoY, { continued: true }).font('Helvetica-Bold').text(student.studentID);

  doc.font('Helvetica').text(`Class: `, 40, infoY + 18, { continued: true }).font('Helvetica-Bold').text(student.currentClass);
  doc.font('Helvetica').text(`Level: `, 320, infoY + 18, { continued: true }).font('Helvetica-Bold').text(classLevel.charAt(0).toUpperCase() + classLevel.slice(1));

  // Session line: "2025/2026 Academic Session" — no school name
  const sessionLabel = session ? `${session} Academic Session` : 'Academic Session';
  doc.font('Helvetica').text(`Session: `, 40, infoY + 36, { continued: true }).font('Helvetica-Bold').text(sessionLabel);
  doc.font('Helvetica').text(`Term: `, 320, infoY + 36, { continued: true }).font('Helvetica-Bold').text(term);

  doc.moveDown(3);

  // ── RESULTS TABLE ────────────────────────────────────────────────────────────
  const tableTop = doc.y;
  const colWidths = [180, 60, 60, 50, 60, 120];
  const headers = ['Subject', 'CA (40)', 'Exam (60)', 'Total', 'Grade', 'Remark'];

  doc.font('Helvetica-Bold').fontSize(9);
  let x = 40;
  headers.forEach((h, i) => {
    doc.text(h, x, tableTop, { width: colWidths[i], align: 'left' });
    x += colWidths[i];
  });
  doc.moveDown(0.5);

  doc.moveTo(40, doc.y).lineTo(560, doc.y).stroke();
  doc.moveDown(0.3);

  doc.font('Helvetica').fontSize(9);
  results.forEach((result) => {
    const y = doc.y;
    x = 40;
    const cells = [
      result.subject,
      String(result.ca1 || 0),
      String(result.exam || 0),
      String(result.total || 0),
      result.grade || '-',
      result.remark || '-'
    ];
    cells.forEach((c, i) => {
      doc.text(c, x, y, { width: colWidths[i], align: 'left' });
      x += colWidths[i];
    });
    doc.moveDown(0.3);
  });

  doc.moveDown(1);

  // ── SUMMARY (no class position) ───────────────────────────────────────────────
  const totalScore = results.reduce((sum, r) => sum + (r.total || 0), 0);
  const subjectCount = results.length;
  const average = subjectCount > 0 ? (totalScore / subjectCount).toFixed(2) : '0';

  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`Total Score: ${totalScore}`, 40, doc.y);
  doc.text(`Average: ${average}%`, 220, doc.y);
  doc.moveDown(1);

  // ── PROMOTION LINE ────────────────────────────────────────────────────────────
  const nextClass = getNextClass(student.currentClass);
  if (nextClass) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e293b')
      .text(`Will be promoted to: ${nextClass}`, 40, doc.y);
  } else {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e293b')
      .text('Will be promoted to the next class', 40, doc.y);
  }
  doc.fillColor('black');
  doc.moveDown(1);

  // ── COMMENTS ─────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10).text("Class Teacher's Comment:", { underline: true });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).text(student.teacherComment || 'Keep up the good work.');
  doc.moveDown(1);
  doc.font('Helvetica-Bold').text("Director of Studies Comment:", { underline: true });
  doc.moveDown(0.2);
  doc.font('Helvetica').text(student.principalComment || 'Satisfactory progress.');
  doc.moveDown(2);

  // ── SIGNATURE ROW ─────────────────────────────────────────────────────────────
  // Three columns: Class Teacher (left) | Director of Studies + signature (center) | Parent/Guardian (right)
  const sigY = doc.y;

  // Left: Class Teacher label only (no signature line below)
  doc.fontSize(9).font('Helvetica').text('Class Teacher', 60, sigY, { width: 150, align: 'center' });

  // Center: Director of Studies with signature image above the line
  const centerX = 225;
  const centerLabelY = sigY;

  // Try to place the signature image above the label
  const sigImgPath = resolveSignaturePath();
  if (sigImgPath) {
    try {
      doc.image(sigImgPath, centerX, centerLabelY - 40, { width: 110, height: 38 });
    } catch (e) { /* skip if image fails */ }
  }

  doc.fontSize(9).font('Helvetica').text('Director of Studies', centerX, centerLabelY, { width: 150, align: 'center' });

  // Right: Parent/Guardian label only (no signature line below)
  doc.fontSize(9).font('Helvetica').text('Parent/Guardian', 420, sigY, { width: 130, align: 'center' });

  // Signature lines
  const lineY = sigY + 14;
  doc.moveTo(60, lineY).lineTo(190, lineY).stroke();
  doc.moveTo(225, lineY).lineTo(375, lineY).stroke();
  doc.moveTo(420, lineY).lineTo(550, lineY).stroke();

  doc.end();
  return doc;
}

module.exports = { generateReportCard, getCampusHeader, CAMPUS_ADDRESSES };
