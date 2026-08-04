const express = require('express');
const router = express.Router();
const Result = require('../models/Result');
const Student = require('../models/Student');
const Class = require('../models/Class');
const Session = require('../models/Session');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getClassLevel } = require('../utils/classLevel');

// Teacher-related routes require authentication and allow teacher/admin access
router.use(requireAuth);
router.use(requireRole(['teacher', 'admin']));


function normalizeHeaderValue(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeStudentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCell(row, candidates) {
  if (!row || typeof row !== 'object') return '';
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) {
      return String(row[candidate] ?? '').trim();
    }
  }
  const normalizedKeys = Object.keys(row).map(normalizeHeaderValue);
  for (const candidate of candidates.map(normalizeHeaderValue)) {
    const match = normalizedKeys.find((key) => key === candidate);
    if (match) {
      const actualKey = Object.keys(row).find((key) => normalizeHeaderValue(key) === candidate);
      return String(row[actualKey] ?? '').trim();
    }
  }
  return '';
}

async function persistTeacherResults(req, { className, subject, term, session, results }) {
  const safeResults = Array.isArray(results) ? results : [];
  if (!safeResults.length) {
    return [];
  }

  const resultPromises = safeResults.map(async (result) => {
    const rawStudentID = (result.studentID || '').toString().trim();
    const rawStudentRef = (result.studentRef || '').toString().trim();
    const rawStudentName = (result.studentName || '').toString().trim();
    const ca1 = parseFloat(result.ca1) || 0;
    const exam = parseFloat(result.exam) || 0;

    let studentDoc = null;
    if (rawStudentRef) {
      studentDoc = await Student.findOne({ _id: rawStudentRef, campus: req.session.campus });
    }

    if (!studentDoc && rawStudentID) {
      studentDoc = await Student.findOne({ studentID: rawStudentID, campus: req.session.campus });
    }

    if (!studentDoc && rawStudentName) {
      studentDoc = await Student.findOne({
        fullName: { $regex: new RegExp(`^${escapeRegex(rawStudentName)}$`, 'i') },
        currentClass: className,
        campus: req.session.campus
      });
    }

    if (!studentDoc && rawStudentName) {
      studentDoc = await Student.findOne({
        fullName: { $regex: new RegExp(`^${escapeRegex(rawStudentName)}$`, 'i') },
        campus: req.session.campus
      });
    }

    // Resolve an identifier we can use reliably for results (prefer student.studentID, fall back to _id)
    const resolvedStudentID = (studentDoc?.studentID && String(studentDoc.studentID).trim()) || (studentDoc?._id ? studentDoc._id.toString() : null) || rawStudentName || `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedStudentName = studentDoc?.fullName || rawStudentName || 'Unknown Student';

    const existingResult = await Result.findOne({
      studentID: resolvedStudentID,
      className,
      subject,
      term,
      session,
      campus: req.session.campus
    });

    if (existingResult) {
      existingResult.ca1 = ca1;
      existingResult.ca2 = 0;
      existingResult.exam = exam;
      existingResult.studentName = resolvedStudentName;
      existingResult.enteredBy = req.session.user.email;
      existingResult.published = false;
      return existingResult.save();
    }

    return Result.create({
      studentID: resolvedStudentID,
      studentName: resolvedStudentName,
      className,
      subject,
      term,
      session,
      ca1,
      ca2: 0,
      exam,
      enteredBy: req.session.user.email,
      campus: req.session.campus
    });
  });

  return Promise.all(resultPromises);
}

// Result Entry Page
router.get('/results', async (req, res) => {
  try {
    const user = req.session.user;
    const activeSession = await Session.getActiveSession(req.session.campus);
    
    // Get assigned classes and subjects
    const assignedClasses = user.assignedClasses || [];
    const assignedSubjects = user.assignedSubjects || [];
    
    // Get filter parameters
    const selectedClass = req.query.class;
    const selectedSubject = req.query.subject;
    const selectedTerm = req.query.term || (activeSession ? activeSession.currentTerm : 'First Term');
    
    let students = [];
    let existingResults = [];
    const isPrimary = getClassLevel(selectedClass) === 'primary';
    
    if (selectedClass && selectedSubject) {
      // Get students in the selected class
      students = await Student.find({
        currentClass: selectedClass,
        isActive: true,
        campus: req.session.campus
      }).sort({ fullName: 1 });
      
      // Get existing results for this class and subject
      existingResults = await Result.find({
        className: selectedClass,
        subject: selectedSubject,
        term: selectedTerm,
        session: activeSession.sessionName,
        campus: req.session.campus
      });
    }
    
    res.render('pages/teacher/results', {
      title: 'Enter Results',
      user,
      assignedClasses,
      assignedSubjects,
      students,
      existingResults,
      selectedClass,
      selectedSubject,
      selectedTerm,
      activeSession,
      isPrimary
    });
  } catch (error) {
    console.error('Error loading results page:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load results page', error });
  }
});

// Save Results
router.post('/results/save', async (req, res) => {
  try {
    const user = req.session.user;
    const { className, subject, term, session, results } = req.body;

    const assignedClasses = Array.isArray(user.assignedClasses) ? user.assignedClasses : [];
    const assignedSubjects = Array.isArray(user.assignedSubjects) ? user.assignedSubjects : [];
    const hasAssignments = assignedClasses.length > 0 || assignedSubjects.length > 0;

    // Allow saves when no assignments are configured yet, but still block if the teacher is explicitly assigned and the class/subject do not match.
    if (hasAssignments && (!assignedClasses.includes(className) || !assignedSubjects.includes(subject))) {
      return res.status(403).json({ success: false, message: 'Not authorized for this class or subject' });
    }
    
    await persistTeacherResults(req, { className, subject, term, session, results });
    
    res.json({ success: true, message: 'Results saved successfully' });
  } catch (error) {
    console.error('Error saving results:', error);
    res.status(500).json({ success: false, message: 'Failed to save results' });
  }
});

// My Results (view entered results)
router.get('/my-results', async (req, res) => {
  try {
    const user = req.session.user;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    
    const filter = { enteredBy: user.email, campus: req.session.campus };
    if (req.query.class) filter.className = req.query.class;
    if (req.query.subject) filter.subject = req.query.subject;
    if (req.query.term) filter.term = req.query.term;
    if (req.query.session) filter.session = req.query.session;
    
    const results = await Result.find(filter)
      .sort({ enteredAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalResults = await Result.countDocuments(filter);
    const totalPages = Math.ceil(totalResults / limit);
    
    // Get unique values for filters
    const classes = await Result.distinct('className', { enteredBy: user.email, campus: req.session.campus });
    const subjects = await Result.distinct('subject', { enteredBy: user.email, campus: req.session.campus });
    const terms = await Result.distinct('term', { enteredBy: user.email, campus: req.session.campus });
    const sessions = await Result.distinct('session', { enteredBy: user.email, campus: req.session.campus });
    
    res.render('pages/teacher/my-results', {
      title: 'My Results',
      results,
      classes,
      subjects,
      terms,
      sessions,
      currentPage: page,
      totalPages,
      query: req.query
    });
  } catch (error) {
    console.error('Error loading my results:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load results', error });
  }
});

// Class Lists
router.get('/classes', async (req, res) => {
  try {
    const user = req.session.user;
    const assignedClasses = user.assignedClasses || [];
    
    // Get students for each assigned class
    const classData = await Promise.all(
      assignedClasses.map(async (className) => {
        const students = await Student.find({
          currentClass: className,
          isActive: true,
          campus: req.session.campus
        }).sort({ fullName: 1 });
        
        return {
          className,
          students,
          count: students.length
        };
      })
    );
    
    res.render('pages/teacher/classes', {
      title: 'My Classes',
      classData
    });
  } catch (error) {
    console.error('Error loading classes:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load classes', error });
  }
});

module.exports = router;