const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const ResultToken = require('../models/ResultToken');
const Student = require('../models/Student');
const Session = require('../models/Session');
const PDFDocument = require('pdfkit');
const { getClassLevel } = require('../utils/classLevel');

// Token management - admin and officer
router.get('/', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  const campus = req.session.campus || 'Lagos';
  const { search, class: classFilter, term, session: sessionFilter, includeInactive } = req.query;

  let activeSession = null;
  try {
    activeSession = await Session.getActiveSession(campus);
  } catch (e) {
    console.error('Session.getActiveSession failed:', e.message);
  }

  const filter = { campus };
  if (!includeInactive) {
    filter.isActive = true;
  }
  if (activeSession && !sessionFilter) {
    filter.session = activeSession.sessionName;
  } else if (sessionFilter) {
    filter.session = sessionFilter;
  }
  if (term) filter.term = term;
  if (classFilter) filter.className = classFilter;
  if (search) {
    filter.$or = [
      { token: { $regex: search, $options: 'i' } },
      { studentID: { $regex: search, $options: 'i' } },
      { studentName: { $regex: search, $options: 'i' } }
    ];
  }

  let tokens = [];
  let classes = [];
  let sessions = [];
  try {
    tokens = await ResultToken.find(filter).sort({ createdAt: -1 }).lean();
  } catch (e) {
    console.error('ResultToken.find failed:', e.message);
  }
  try {
    classes = (await Student.distinct('currentClass', { campus, isActive: true })).sort();
  } catch (e) {
    console.error('Student.distinct failed:', e.message);
  }
  try {
    sessions = await Session.find({ campus }).sort({ createdAt: -1 }).select('sessionName').lean();
  } catch (e) {
    console.error('Session.find failed:', e.message);
  }

  try {
    res.render('pages/admin/result-tokens', {
      title: 'Result Token Management',
      tokens,
      classes,
      sessions,
      activeSession,
      filters: { search: search || '', classFilter: classFilter || '', term: term || '', sessionFilter: sessionFilter || '' },
      campus,
      user: req.session.user
    });
  } catch (error) {
    console.error('Token page render error:', error);
    if (!res.headersSent) {
      res.status(500).send('Failed to render token management page: ' + error.message);
    }
  }
});

// Generate tokens for a single student
router.post('/generate', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const campus = req.session.campus;
    const { studentID, term, session } = req.body;
    if (!studentID || !term || !session) {
      return res.status(400).json({ success: false, message: 'Student, term, and session are required' });
    }

    let student = await Student.findOne({ studentID, campus, isActive: true });
    if (!student) {
      student = await Student.findOne({ _id: studentID, campus, isActive: true });
    }

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (!student.studentID || !String(student.studentID).trim()) {
      await student.save();
    }

    // Deactivate any existing active token for this student/session/term/campus
    await ResultToken.updateMany(
      { studentID, session, term, campus, isActive: true },
      { $set: { isActive: false } }
    );

    const token = await ResultToken.generateUniqueToken();
    const resultToken = new ResultToken({
      token,
      studentID: student.studentID,
      studentName: student.fullName,
      className: student.currentClass,
      session,
      term,
      campus,
      generatedBy: req.session.user.email
    });
    await resultToken.save();

    res.json({ success: true, token: resultToken.token, message: 'Token generated successfully' });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate token' });
  }
});

// Regenerate token for a student (deactivates old, creates new)
router.post('/regenerate/:id', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const campus = req.session.campus;
    const oldToken = await ResultToken.findOne({ _id: req.params.id, campus });
    if (!oldToken) {
      return res.status(404).json({ success: false, message: 'Token not found' });
    }

    oldToken.isActive = false;
    oldToken.regeneratedBy = oldToken.regeneratedBy || [];
    oldToken.regeneratedBy.push({
      email: req.session.user.email,
      at: new Date()
    });
    await oldToken.save();

    const newTokenValue = await ResultToken.generateUniqueToken();
    const newToken = new ResultToken({
      token: newTokenValue,
      studentID: oldToken.studentID,
      studentName: oldToken.studentName,
      className: oldToken.className,
      session: oldToken.session,
      term: oldToken.term,
      campus,
      generatedBy: req.session.user.email
    });
    await newToken.save();

    res.json({ success: true, token: newToken.token, message: 'Token regenerated successfully' });
  } catch (error) {
    console.error('Token regeneration error:', error);
    res.status(500).json({ success: false, message: 'Failed to regenerate token' });
  }
});

// Bulk generate tokens for all students in a class
router.post('/bulk-generate', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const campus = req.session.campus;
    const { className, term, session } = req.body;
    if (!className || !term || !session) {
      return res.status(400).json({ success: false, message: 'Class, term, and session are required' });
    }

    const students = await Student.find({ currentClass: className, campus, isActive: true });

    if (students.length === 0) {
      return res.status(404).json({ success: false, message: 'No students were found in this class.' });
    }

    await ResultToken.updateMany(
      { className, session, term, campus, isActive: true },
      { $set: { isActive: false } }
    );

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    for (const student of students) {
      if (!student.studentID || !String(student.studentID).trim()) {
        await student.save();
      }

      if (!student.studentID || !String(student.studentID).trim()) {
        failed += 1;
        continue;
      }
      try {
        const existing = await ResultToken.findOne({
          studentID: student.studentID,
          session,
          term,
          campus,
          isActive: true
        });
        if (existing) {
          skipped++;
          continue;
        }

        const token = await ResultToken.generateUniqueToken();
        const resultToken = new ResultToken({
          token,
          studentID: student.studentID,
          studentName: student.fullName,
          className: student.currentClass,
          session,
          term,
          campus,
          generatedBy: req.session.user.email
        });
        await resultToken.save();
        generated++;
      } catch (studentError) {
        console.error('Token generation failed for student:', student.studentID, studentError.message);
        failed++;
      }
    }

    if (generated === 0 && failed > 0) {
      return res.status(500).json({ success: false, message: `Token generation failed for ${failed} student record(s).` });
    }

    res.json({
      success: true,
      message: `Generated ${generated} tokens, skipped ${skipped} existing${failed > 0 ? `, failed ${failed}` : ''}`,
      generated,
      skipped,
      failed
    });
  } catch (error) {
    console.error('Bulk token generation error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate tokens' });
  }
});

// Bulk regenerate tokens for a class
router.post('/bulk-regenerate', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const campus = req.session.campus;
    const { className, term, session } = req.body;
    if (!className || !term || !session) {
      return res.status(400).json({ success: false, message: 'Class, term, and session are required' });
    }

    const existingTokens = await ResultToken.find({
      className,
      term,
      session,
      campus,
      isActive: true
    });

    let regenerated = 0;
    for (const oldToken of existingTokens) {
      try {
        oldToken.isActive = false;
        oldToken.regeneratedBy = oldToken.regeneratedBy || [];
        oldToken.regeneratedBy.push({
          email: req.session.user.email,
          at: new Date()
        });
        await oldToken.save();

        const newTokenValue = await ResultToken.generateUniqueToken();
        const newToken = new ResultToken({
          token: newTokenValue,
          studentID: oldToken.studentID,
          studentName: oldToken.studentName,
          className: oldToken.className,
          session: oldToken.session,
          term: oldToken.term,
          campus,
          generatedBy: req.session.user.email
        });
        await newToken.save();
        regenerated++;
      } catch (tokenError) {
        console.error('Token regeneration failed for token:', oldToken._id, tokenError.message);
      }
    }

    res.json({ success: true, message: `Regenerated ${regenerated} tokens`, regenerated });
  } catch (error) {
    console.error('Bulk token regeneration error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to regenerate tokens' });
  }
});

// Print token slip (PDF)
router.get('/slip/:id', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const campus = req.session.campus;
    const token = await ResultToken.findOne({ _id: req.params.id, campus });
    if (!token) {
      return res.redirect('/tokens?error=Token not found');
    }

    const school = await require('../models/School').findOne({ campus });
    const schoolName = campus === 'Ekiti'
      ? 'OSBOT INTERNATIONAL SCHOOLS'
      : 'OSBOT ROYAL SCHOOLS';
    const schoolAddress = campus === 'Ekiti'
      ? 'Osbot Road, Aso Ayegunle, Ado-Ekiti, Ekiti State'
      : '38 Unit Road, Isale Odo, Eleyin B/Stop, Ikole-Odunsi via Ipaja, Lagos State';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="token-slip-${token.studentID}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text(schoolName, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').text(schoolAddress, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).font('Helvetica-Bold').text('RESULT ACCESS TOKEN SLIP', { align: 'center' });
    doc.moveDown(1);

    // Student details
    doc.fontSize(11).font('Helvetica-Bold').text('Student Information', { underline: true });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Name: ${token.studentName}`);
    doc.text(`Student ID: ${token.studentID}`);
    doc.text(`Class: ${token.className}`);
    doc.text(`Session: ${token.session}`);
    doc.text(`Term: ${token.term}`);
    doc.text(`Campus: ${token.campus}`);
    doc.moveDown(1);

    // Token box
    doc.fontSize(11).font('Helvetica-Bold').text('Your Result Access Token', { underline: true });
    doc.moveDown(0.5);
    doc.rect(80, doc.y, 400, 60).stroke();
    doc.fontSize(24).font('Courier-Bold').text(token.token, 100, doc.y + 15, { width: 400, align: 'center' });
    doc.moveDown(2);

    // Instructions
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#555').text(
      'Keep this token safe. You will need it to view and print your results on the student portal. ' +
      'Do not share this token with anyone. If lost, contact the school administrator to regenerate.',
      { align: 'left', width: 450 }
    );

    doc.end();
  } catch (error) {
    console.error('Token slip error:', error);
    res.redirect('/tokens?error=Failed to generate token slip');
  }
});

// Bulk print token slips for a class
router.get('/bulk-slip', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const campus = req.session.campus;
    const { className, term, session } = req.query;
    if (!className || !term || !session) {
      return res.redirect('/tokens?error=Class, term, and session are required');
    }

    const tokens = await ResultToken.find({
      className,
      term,
      session,
      campus,
      isActive: true
    }).sort({ studentName: 1 });

    if (tokens.length === 0) {
      return res.redirect('/tokens?error=No active tokens found for the selected criteria');
    }

    const schoolName = campus === 'Ekiti'
      ? 'OSBOT INTERNATIONAL SCHOOLS'
      : 'OSBOT ROYAL SCHOOLS';
    const schoolAddress = campus === 'Ekiti'
      ? 'Osbot Road, Aso Ayegunle, Ado-Ekiti, Ekiti State'
      : '38 Unit Road, Isale Odo, Eleyin B/Stop, Ikole-Odunsi via Ipaja, Lagos State';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="token-slips-${className}-${term}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    tokens.forEach((token, idx) => {
      if (idx > 0) doc.addPage();

      doc.fontSize(20).font('Helvetica-Bold').text(schoolName, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').text(schoolAddress, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(12).font('Helvetica-Bold').text('RESULT ACCESS TOKEN SLIP', { align: 'center' });
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold').text('Student Information', { underline: true });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Name: ${token.studentName}`);
      doc.text(`Student ID: ${token.studentID}`);
      doc.text(`Class: ${token.className}`);
      doc.text(`Session: ${token.session}`);
      doc.text(`Term: ${token.term}`);
      doc.text(`Campus: ${token.campus}`);
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold').text('Your Result Access Token', { underline: true });
      doc.moveDown(0.5);
      const tokenY = doc.y;
      doc.rect(80, tokenY, 400, 60).stroke();
      doc.fontSize(24).font('Courier-Bold').text(token.token, 100, tokenY + 15, { width: 400, align: 'center' });
      doc.moveDown(2);

      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#555').text(
        'Keep this token safe. You will need it to view and print your results on the student portal. ' +
        'Do not share this token with anyone. If lost, contact the school administrator to regenerate.',
        { align: 'left', width: 450 }
      );
      doc.fillColor('#000');
    });

    doc.end();
  } catch (error) {
    console.error('Bulk token slip error:', error);
    res.redirect('/tokens?error=Failed to generate token slips');
  }
});

// Clear currently loaded active tokens for the selected filters
router.post('/clear', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const campus = req.session.campus;
    const { className, term, session } = req.body;

    const filter = { campus, isActive: true };
    if (className) filter.className = className;
    if (term) filter.term = term;
    if (session) filter.session = session;

    const result = await ResultToken.updateMany(filter, { $set: { isActive: false } });
    const count = result.modifiedCount || 0;

    res.json({
      success: true,
      message: count > 0 ? `Cleared ${count} loaded token(s).` : 'No active tokens were found to clear.'
    });
  } catch (error) {
    console.error('Token clear error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to clear tokens' });
  }
});

// Export tokens as CSV
router.get('/export', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const campus = req.session.campus;
    const { className, term, session, includeInactive } = req.query;
    const filter = { campus };
    if (!includeInactive) {
      filter.isActive = true;
    }
    if (className) filter.className = className;
    if (term) filter.term = term;
    if (session) filter.session = session;

    const tokens = await ResultToken.find(filter).sort({ studentName: 1 }).lean();

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="result-tokens-${campus}.csv"`);

    const header = 'Student ID,Student Name,Class,Session,Term,Token,Status,Campus,Generated At\n';
    res.write(header);
    tokens.forEach(t => {
      const row = [
        t.studentID,
        `"${t.studentName}"`,
        t.className,
        t.session,
        t.term,
        t.token,
        t.isActive ? 'Active' : 'Inactive',
        t.campus,
        new Date(t.createdAt).toISOString()
      ].join(',');
      res.write(row + '\n');
    });
    res.end();
  } catch (error) {
    console.error('Token export error:', error);
    res.redirect('/tokens?error=Failed to export tokens');
  }
});

// Validate token (student endpoint)
router.post('/validate', requireAuth, async (req, res) => {
  try {
    const campus = req.session.campus;
    const { token, studentID, term, session } = req.body;
    if (!token || !studentID || !term || !session) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const result = await ResultToken.validateToken(token, studentID, session, term, campus);
    if (result.valid) {
      // Mark token as used
      result.record.usedAt = new Date();
      await result.record.save();
      // Store validated status in session for this result view
      req.session.tokenValidated = { studentID, term, session, at: Date.now() };
      return res.json({ success: true, message: 'Token validated successfully' });
    }
    return res.status(400).json({ success: false, message: result.message });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ success: false, message: 'Validation failed' });
  }
});

module.exports = router;
