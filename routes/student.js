const express = require('express');
const router = express.Router();
const Result = require('../models/Result');
const Student = require('../models/Student');
const Session = require('../models/Session');
const School = require('../models/School');
const Announcement = require('../models/Announcement');
const ResultToken = require('../models/ResultToken');
const bcrypt = require('bcrypt');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateReportCard } = require('../utils/pdfGenerator');

function buildStudentIdentifierFilters(student) {
  const filters = [];

  if (student?.studentID) {
    const escapedStudentID = String(student.studentID).trim();
    if (escapedStudentID) {
      filters.push({ studentID: escapedStudentID });
      filters.push({ studentID: new RegExp(`^${escapedStudentID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    }
  }

  if (student?._id) {
    const studentRef = student._id.toString();
    filters.push({ studentRef: studentRef });
    filters.push({ studentRef: student._id });
    filters.push({ studentID: studentRef });
  }

  if (student?.fullName) {
    const fullName = String(student.fullName).trim();
    if (fullName) {
      const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filters.push({ studentName: fullName });
      filters.push({ studentName: new RegExp(`^${escapedName}$`, 'i') });
    }
  }

  return filters;
}

function deduplicateResults(results) {
  // Keep only one record per subject (prefer published > approved > others)
  const seen = new Map();
  const statusRank = { published: 3, approved: 2, sent: 1, draft: 0 };
  for (const r of results) {
    const key = `${r.subject}|${r.term}|${r.session}`;
    const existing = seen.get(key);
    const rRank = statusRank[r.status] ?? 0;
    const existingRank = existing ? (statusRank[existing.status] ?? 0) : -1;
    if (!existing || rRank > existingRank) {
      seen.set(key, r);
    }
  }
  return [...seen.values()].sort((a, b) => a.subject.localeCompare(b.subject));
}

async function findStudentResults(student, { campus } = {}) {
  const identifierFilters = buildStudentIdentifierFilters(student);
  if (!identifierFilters.length) {
    return [];
  }

  const baseQuery = { $or: identifierFilters };

  const publishedQuery = {
    $and: [
      baseQuery,
      { $or: [{ status: 'published' }, { published: true }, { status: 'approved' }] }
    ]
  };

  if (campus) publishedQuery.$and.push({ campus });

  let results = await Result.find(publishedQuery).sort({ subject: 1 });

  if (results.length > 0) {
    return deduplicateResults(results);
  }

  const fallbackQuery = { $and: [baseQuery] };
  if (campus) fallbackQuery.$and.push({ campus });

  results = await Result.find(fallbackQuery).sort({ subject: 1 });

  if (results.length > 0) {
    return deduplicateResults(results);
  }

  if (campus) {
    results = await Result.find({ $or: identifierFilters }).sort({ subject: 1 });
  }

  return deduplicateResults(results);
}

async function calculateStudentClassPosition(student, { className, term, session, campus }) {
  const normalizedClassName = className || student?.currentClass;
  const normalizedTerm = term || 'First Term';
  const normalizedSession = session || student?.currentSession;
  const normalizedCampus = campus || student?.campus || null;

  if (!student?.studentID || !normalizedClassName || !normalizedTerm || !normalizedSession || !normalizedCampus) {
    return null;
  }

  const classResults = await Result.find({
    className: normalizedClassName,
    term: normalizedTerm,
    session: normalizedSession,
    campus: normalizedCampus
  }).sort({ total: -1 });

  if (!classResults.length) {
    return null;
  }

  const studentAverages = classResults.reduce((acc, result) => {
    const studentKey = result.studentID || result.studentRef || result.studentName;
    if (!studentKey) {
      return acc;
    }

    if (!acc[studentKey]) {
      acc[studentKey] = { total: 0, count: 0 };
    }

    acc[studentKey].total += Number(result.total || 0);
    acc[studentKey].count += 1;
    return acc;
  }, {});

  const averages = Object.entries(studentAverages)
    .map(([studentKey, data]) => ({
      studentKey,
      average: data.total / Math.max(data.count, 1)
    }))
    .sort((a, b) => b.average - a.average);

  const studentIndex = averages.findIndex((entry) => entry.studentKey === student.studentID || entry.studentKey === student.fullName || entry.studentKey === String(student._id));
  if (studentIndex >= 0) {
    return studentIndex + 1;
  }

  const studentResults = await Result.find({
    studentID: student.studentID,
    campus: normalizedCampus,
    status: { $in: ['published', 'approved'] }
  }).sort({ total: -1 });

  if (!studentResults.length) {
    return null;
  }

  const studentTotal = studentResults.reduce((sum, result) => sum + Number(result.total || 0), 0);
  const studentAverage = studentTotal / Math.max(studentResults.length, 1);
  const rankedStudents = Object.values(studentAverages).map((data) => data.total / Math.max(data.count, 1));

  return rankedStudents.filter((average) => average > studentAverage).length + 1;
}

// All student routes require authentication and student role
router.use(requireAuth);
router.use(requireRole('student'));

// Student Portal
router.get('/portal', async (req, res) => {
  try {
    const user = req.session.user;
    const student = await Student.findById(user.id);
    
    if (!student) {
      return res.redirect('/login?error=Student not found');
    }
    
    const activeSession = await Session.getActiveSession(req.session.campus);
    
    // Get current term results (approved/published results)
    const currentTerm = activeSession ? activeSession.currentTerm : 'First Term';
    const currentSession = student.currentSession || (activeSession ? activeSession.sessionName : '');

    const campus = req.session.campus || student.campus || null;
    let currentResults = await findStudentResults(student, { campus });

    if (currentResults.length > 0) {
      currentResults = currentResults.filter((result) => {
        return Boolean(result.subject && result.total !== undefined);
      });
    }

    const hasPublishedResults = currentResults.some((result) => {
      return ['published', 'approved'].includes(result.status) || result.published === true;
    });
    const visibleResults = hasPublishedResults || !currentResults.length
      ? currentResults.filter((result) => {
          return ['published', 'approved'].includes(result.status) || result.published === true || result.status === 'draft';
        })
      : currentResults;
    currentResults = visibleResults;
    
    // Calculate subject positions
    for (const result of currentResults) {
      const subjectResults = await Result.find({
        className: result.className,
        subject: result.subject,
        term: result.term,
        session: result.session,
        status: 'published',
        campus: req.session.campus
      }).sort({ total: -1 });
      
      result.subjectPosition = subjectResults.findIndex(r => r.studentID === result.studentID) + 1;
    }
    
    const selectedTerm = currentResults[0]?.term || currentTerm;
    const selectedSession = currentResults[0]?.session || currentSession;
    const classPosition = await calculateStudentClassPosition(student, {
      className: currentResults[0]?.className || student.currentClass,
      term: selectedTerm,
      session: selectedSession,
      campus: req.session.campus
    });
    
    // Calculate statistics
    const totalSubjects = currentResults.length;
    const totalMarks = currentResults.reduce((sum, result) => sum + result.total, 0);
    const averageScore = totalSubjects > 0 ? (totalMarks / totalSubjects).toFixed(2) : 0;
    
    // Grade distribution
    const gradeDistribution = currentResults.reduce((acc, result) => {
      acc[result.grade] = (acc[result.grade] || 0) + 1;
      return acc;
    }, {});
    
    // Get announcements for students
    const announcements = await Announcement.find({
      isActive: true,
      targetAudience: { $in: ['all', 'students'] },
      campus: req.session.campus
    }).sort({ createdAt: -1 }).limit(5);
    
    // Get login announcements from session
    const loginAnnouncements = req.session.announcements || [];
    delete req.session.announcements; // Clear after showing
    
    res.render('pages/student/portal', {
      title: 'Student Portal',
      student,
      currentResults,
      activeSession,
      announcements,
      loginAnnouncements,
      tokenVerified: Boolean(req.session.studentTokenVerified || req.session.studentToken),
      debugInfo: {
        studentID: student.studentID,
        resultCount: currentResults.length,
        campus: req.session.campus,
        currentTerm,
        currentSession
      },
      stats: {
        totalSubjects,
        totalMarks,
        averageScore,
        gradeDistribution,
        classPosition
      }
    });
  } catch (error) {
    console.error('Error loading student portal:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load portal', error });
  }
});

router.post('/portal/verify-token', async (req, res) => {
  try {
    const user = req.session.user;
    const student = await Student.findById(user.id);

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const tokenValue = (req.body.token || '').trim().toUpperCase();
    if (!tokenValue) {
      return res.status(400).json({ success: false, message: 'Please enter your token' });
    }

    const activeSession = await Session.getActiveSession(req.session.campus);
    const tokenResult = await ResultToken.validateToken(
      tokenValue,
      student.studentID,
      activeSession ? activeSession.sessionName : student.currentSession,
      activeSession ? activeSession.currentTerm : 'First Term',
      req.session.campus
    );

    if (!tokenResult.valid) {
      return res.status(400).json({ success: false, message: tokenResult.message || 'Invalid token' });
    }

    tokenResult.record.usedAt = new Date();
    tokenResult.record.isActive = true;
    await tokenResult.record.save();

    req.session.studentTokenVerified = true;
    req.session.studentToken = tokenValue;
    return res.json({ success: true, message: 'Portal unlocked successfully' });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(500).json({ success: false, message: 'Unable to verify token' });
  }
});

// View All Results - UPDATED for new status system
router.get('/results', async (req, res) => {
  try {
    const user = req.session.user;
    const student = await Student.findById(user.id);
    
    if (!student) {
      return res.redirect('/login?error=Student not found');
    }
    
    const selectedTerm = req.query.term;
    const selectedSession = req.query.session || student.currentSession;
    
    const campus = req.session.campus || student.campus || null;

    const studentLookup = { $or: buildStudentIdentifierFilters(student) };

    // Get filter options (only from approved/published results)
    const availableTerms = await Result.distinct('term', {
      $and: [
        studentLookup,
        { $or: [{ status: 'published' }, { published: true }, { status: 'approved' }] },
        ...(campus ? [{ campus }] : [])
      ]
    });
    const availableSessions = await Result.distinct('session', {
      $and: [
        studentLookup,
        { $or: [{ status: 'published' }, { published: true }, { status: 'approved' }] },
        ...(campus ? [{ campus }] : [])
      ]
    });
    
    // Build filter
    const filter = {
      $and: [studentLookup]
    };
    
    if (campus) filter.$and.push({ campus });
    if (selectedTerm) filter.$and.push({ term: selectedTerm });
    if (selectedSession) filter.$and.push({ session: selectedSession });
    
    let results = deduplicateResults(await Result.find(filter).sort({ subject: 1 }));

    if (!results.length) {
      const fallbackFilter = {
        $and: [{ $or: buildStudentIdentifierFilters(student) }]
      };
      if (campus) fallbackFilter.$and.push({ campus });
      if (selectedTerm) fallbackFilter.$and.push({ term: selectedTerm });
      if (selectedSession) fallbackFilter.$and.push({ session: selectedSession });
      results = deduplicateResults(await Result.find(fallbackFilter).sort({ subject: 1 }));
    }
    
    // Calculate subject positions
    for (const result of results) {
      const subjectResults = await Result.find({
        className: result.className,
        subject: result.subject,
        term: result.term,
        session: result.session,
        status: 'published',
        campus: req.session.campus
      }).sort({ total: -1 });
      
      result.subjectPosition = subjectResults.findIndex(r => r.studentID === result.studentID) + 1;
    }
    
    // Group results by term and session
    const groupedResults = results.reduce((acc, result) => {
      const key = `${result.session}-${result.term}`;
      if (!acc[key]) {
        acc[key] = {
          session: result.session,
          term: result.term,
          results: []
        };
      }
      acc[key].results.push(result);
      return acc;
    }, {});
    
    // Calculate class positions for each group
    for (const group of Object.values(groupedResults)) {
      group.classPosition = await calculateStudentClassPosition(student, {
        className: group.results[0].className,
        term: group.term,
        session: group.session,
        campus: req.session.campus
      });
    }
    
    res.render('pages/student/results', {
      title: 'My Results',
      student,
      groupedResults,
      availableTerms,
      availableSessions,
      selectedTerm,
      selectedSession
    });
  } catch (error) {
    console.error('Error loading student results:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load results', error });
  }
});

// Download Result PDF - UPDATED for new grading system
router.get('/results/download', async (req, res) => {
  try {
    const user = req.session.user;
    const student = await Student.findById(user.id);
    const { term, session, token } = req.query;
    
    if (!student) {
      return res.status(404).send('Student not found');
    }
    
    const isPortalUnlocked = Boolean(req.session.studentTokenVerified || req.session.studentToken);

    if (!isPortalUnlocked) {
      if (!token || !token.trim()) {
        return res.status(403).send('Result Token is required. Please contact your school administration.');
      }

      const activeSession = await Session.getActiveSession(req.session.campus);
      const tokenResult = await ResultToken.validateToken(
        token.trim().toUpperCase(),
        student.studentID,
        session || (activeSession ? activeSession.sessionName : student.currentSession),
        term || (activeSession ? activeSession.currentTerm : 'First Term'),
        req.session.campus
      );

      if (!tokenResult.valid) {
        return res.status(403).send(tokenResult.message || 'Invalid Result Token. Please contact your school administration.');
      }
    }
    
    const campus = req.session.campus || student.campus || null;
    const results = await findStudentResults(student, { campus });
    const selectedTerm = term || 'First Term';
    const selectedSession = session || student.currentSession;
    const filteredResults = results.filter((result) => {
      const matchesTerm = !selectedTerm || result.term === selectedTerm;
      const matchesSession = !selectedSession || result.session === selectedSession;
      return matchesTerm && matchesSession && (
        ['published', 'approved'].includes(result.status) || result.published === true || result.status === 'draft'
      );
    });

    if (filteredResults.length === 0) {
      return res.status(404).send('No approved results found for the specified term and session');
    }

    const school = await School.findOne({ campus: req.session.campus });
    const classPosition = await calculateStudentClassPosition(student, {
      className: filteredResults[0]?.className || student.currentClass,
      term: selectedTerm,
      session: selectedSession,
      campus: req.session.campus
    });

    const pdfParams = {
      student,
      results: filteredResults,
      classResults: [],
      school,
      campus: req.session.campus,
      term: selectedTerm,
      session: selectedSession,
      classPosition
    };

    generateReportCard(res, pdfParams);
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send('Error generating PDF');
  }
});

// Student Profile
router.get('/profile', async (req, res) => {
  try {
    const user = req.session.user;
    const student = await Student.findById(user.id);
    
    if (!student) {
      return res.redirect('/login?error=Student not found');
    }
    
    res.render('pages/student/profile', {
      title: 'My Profile',
      student
    });
  } catch (error) {
    console.error('Error loading student profile:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load profile', error });
  }
});

// Update Password
router.post('/profile/password', async (req, res) => {
  try {
    const user = req.session.user;
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    const student = await Student.findById(user.id);
    if (!student) {
      return res.redirect('/student/profile?error=Student not found');
    }
    
    // Verify current password
    const isValidPassword = await student.comparePassword(currentPassword);
    if (!isValidPassword) {
      return res.redirect('/student/profile?error=Current password is incorrect');
    }
    
    // Check if new passwords match
    if (newPassword !== confirmPassword) {
      return res.redirect('/student/profile?error=New passwords do not match');
    }
    
    // Update password
    student.password = newPassword;
    await student.save();
    
    res.redirect('/student/profile?success=Password updated successfully');
  } catch (error) {
    console.error('Error updating password:', error);
    res.redirect('/student/profile?error=Failed to update password');
  }
});

module.exports = router;