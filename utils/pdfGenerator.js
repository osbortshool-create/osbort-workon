const PDFDocument = require('pdfkit');
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

/**
 * Generate a result report card PDF with campus-specific headers.
 * @param {Object} params - { student, results, classResults, school, campus, term, session }
 * @returns {PDFDocument} - Piped to response by caller
 */
function generateReportCard(res, params) {
  const { student, results, classResults, school, campus, term, session, classPosition } = params;
  const header = getCampusHeader(campus);
  const classLevel = getClassLevel(student.currentClass);
  const isPrimary = classLevel === 'primary';
  const scoreStructure = getScoreStructure(student.currentClass);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="result-${student.studentID}-${term}-${session}.pdf"`);
  doc.pipe(res);

  // Campus-specific header
  doc.fontSize(18).font('Helvetica-Bold').text(header.name.toUpperCase(), { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(9).font('Helvetica').text(header.address, { align: 'center', width: 520, lineGap: 3 });
  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica-Bold').text(`${campus} Campus - Student Report Card`, { align: 'center' });
  doc.moveDown(1);

  // Student info
  doc.fontSize(10).font('Helvetica');
  const infoY = doc.y;
  doc.text(`Name: ${student.fullName}`, 40, infoY);
  doc.text(`Student ID: ${student.studentID}`, 320, infoY);
  doc.text(`Class: ${student.currentClass}`, 40, infoY + 18);
  doc.text(`Gender: ${student.gender || 'N/A'}`, 320, infoY + 18);
  doc.text(`Session: ${session}`, 40, infoY + 36);
  doc.text(`Term: ${term}`, 320, infoY + 36);
  doc.moveDown(3);

  // Results table header
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

  // Separator line
  doc.moveTo(40, doc.y).lineTo(560, doc.y).stroke();
  doc.moveDown(0.3);

  // Results rows
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

  // Summary
  const totalScore = results.reduce((sum, r) => sum + (r.total || 0), 0);
  const subjectCount = results.length;
  const average = subjectCount > 0 ? (totalScore / subjectCount).toFixed(2) : '0';
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`Total Score: ${totalScore}`, 40, doc.y);
  doc.text(`Average: ${average}%`, 170, doc.y);
  if (classPosition) {
    doc.text(`Class Position: ${classPosition}`, 300, doc.y);
  }
  doc.moveDown(1);

  // Comments - label and value on the same row
  const teacherCommentY = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).text("Class Teacher's Comment: ", 40, teacherCommentY, { continued: true, width: 520 });
  doc.font('Helvetica').text(student.teacherComment || 'Keep up the good work.');
  doc.moveDown(0.8);
  const directorCommentY = doc.y;
  doc.font('Helvetica-Bold').text("Director of Studies Comment: ", 40, directorCommentY, { continued: true, width: 520 });
  doc.font('Helvetica').text(student.principalComment || 'Satisfactory progress.');
  doc.moveDown(2);

  // Signatures
  doc.fontSize(9);
  doc.text('Class Teacher', 60, doc.y, { width: 150, align: 'center' });
  doc.text('Principal', 250, doc.y, { width: 150, align: 'center' });
  doc.text('Parent/Guardian', 440, doc.y, { width: 120, align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(60, doc.y).lineTo(180, doc.y).stroke();
  doc.moveTo(250, doc.y).lineTo(370, doc.y).stroke();
  doc.moveTo(440, doc.y).lineTo(560, doc.y).stroke();

  doc.end();
  return doc;
}

module.exports = { generateReportCard, getCampusHeader, CAMPUS_ADDRESSES };
