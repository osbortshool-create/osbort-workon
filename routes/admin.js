const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Student = require('../models/Student');
const Class = require('../models/Class');
const Session = require('../models/Session');
const School = require('../models/School');
const Result = require('../models/Result');
const Announcement = require('../models/Announcement');
const PassedOutStudent = require('../models/PassedOutStudent');
const { requireAuth, requireRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { getClassLevel, getScoreStructure } = require('../utils/classLevel');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'public/uploads/';
    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// All admin routes require admin role
router.use(requireAuth);
router.use(requireRole('admin'));

function normalizeOptionalText(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value === undefined || value === null ? null : value;
}

function normalizeHeaderValue(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
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

async function persistResultsForSave(req, { className, subject, term, session, results }) {
  const safeResults = Array.isArray(results) ? results : [];
  if (!safeResults.length) {
    return [];
  }

  const resultPromises = safeResults.map(async (result) => {
    const rawStudentID = (result.studentID || '').toString().trim();
    const rawStudentName = (result.studentName || '').toString().trim();
    const rawStudentRef = (result.studentRef || '').toString().trim();
    const ca1 = parseFloat(result.ca1) || 0;
    const exam = parseFloat(result.exam) || 0;

    let studentDoc = null;
    if (rawStudentRef) {
      studentDoc = await Student.findById(rawStudentRef);
    }

    if (!studentDoc && rawStudentID) {
      studentDoc = await Student.findOne({ studentID: rawStudentID, campus: req.session.campus });
    }

    if (!studentDoc && rawStudentName) {
      studentDoc = await Student.findOne({
        fullName: rawStudentName,
        currentClass: className,
        campus: req.session.campus
      });
    }

    const resolvedStudentID = rawStudentID || studentDoc?.studentID || studentDoc?._id?.toString() || rawStudentName || `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedStudentRef = studentDoc?._id?.toString() || rawStudentRef || '';
    const resolvedStudentName = studentDoc?.fullName || rawStudentName || 'Unknown Student';

    const existingResult = await Result.findOne({
      $or: [
        { studentRef: resolvedStudentRef },
        { studentID: resolvedStudentID, className, subject, term, session, status: 'draft', campus: req.session.campus }
      ],
      className,
      subject,
      term,
      session,
      status: 'draft',
      campus: req.session.campus
    });

    if (existingResult) {
      existingResult.ca1 = ca1;
      existingResult.ca2 = 0;
      existingResult.exam = exam;
      existingResult.studentID = resolvedStudentID;
      existingResult.studentRef = resolvedStudentRef;
      existingResult.studentName = resolvedStudentName;
      existingResult.enteredBy = req.session.user.email;
      return existingResult.save();
    }

    return Result.create({
      studentID: resolvedStudentID,
      studentRef: resolvedStudentRef,
      studentName: resolvedStudentName,
      className,
      subject,
      term,
      session,
      ca1,
      ca2: 0,
      exam,
      status: 'draft',
      enteredBy: req.session.user.email,
      campus: req.session.campus
    });
  });

  return Promise.all(resultPromises);
}

// Manage Students
router.get('/students', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    
    const filter = { isActive: true }; // Only show active students
    if (req.query.class) filter.currentClass = req.query.class;
    if (req.query.session) filter.currentSession = req.query.session;
    filter.campus = req.session.campus;
    if (req.query.search) {
      filter.$or = [
        { fullName: { $regex: req.query.search, $options: 'i' } },
        { studentID: { $regex: req.query.search, $options: 'i' } }
      ];
    }
    
    const students = await Student.find(filter)
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limit);
    
    const totalStudents = await Student.countDocuments(filter);
    const totalPages = Math.ceil(totalStudents / limit);
    
    const classes = await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 });
    const sessions = await Session.find({ campus: req.session.campus }).sort({ sessionName: -1 });
    
    res.render('pages/admin/students', {
      title: 'Manage Students',
      students,
      classes,
      sessions,
      currentPage: page,
      totalPages,
      query: req.query
    });
  } catch (error) {
    console.error('Error loading students:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load students', error });
  }
});

// Add Student Form
router.get('/students/add', async (req, res) => {
  try {
    const classes = await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 });
    const activeSession = await Session.getActiveSession(req.session.campus);
    
    res.render('pages/admin/add-student', {
      title: 'Add New Student',
      classes,
      activeSession
    });
  } catch (error) {
    console.error('Error loading add student form:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load form', error });
  }
});


// Add Student POST - FIXED with default password "student123"
router.post('/students/add', upload.single('passport'), async (req, res) => {
  try {
    const {
      fullName, studentID, gender, age, parentPhone, 
      parentEmail, address, currentClass, section
    } = req.body;

    const trimmedStudentID = studentID ? studentID.trim() : '';
    const normalizedParentPhone = normalizeOptionalText(parentPhone);
    const normalizedParentEmail = normalizeOptionalText(parentEmail);
    
    // Check if student ID already exists when one is provided
    const existingStudent = trimmedStudentID
      ? await Student.findOne({ studentID: trimmedStudentID, campus: req.session.campus })
      : null;
    if (existingStudent) {
      return res.render('pages/admin/add-student', {
        title: 'Add New Student',
        error: 'Student ID already exists',
        classes: await Class.find({ isActive: true }).sort({ className: 1 }),
        activeSession: await Session.getActiveSession(req.session.campus)
      });
    }
    
    const activeSession = await Session.getActiveSession(req.session.campus);
    
    const parsedAge = Number(age);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      throw new Error('Please enter a valid age between 1 and 120');
    }

    const birthDate = new Date();
    birthDate.setFullYear(birthDate.getFullYear() - parsedAge);
    
    // FIXED: Use default password "student123"
    const defaultPassword = 'student123';
    
    const studentData = {
      fullName,
      studentID: trimmedStudentID || null,
      password: defaultPassword, // This will be hashed by the pre-save middleware
      gender,
      dateOfBirth: birthDate,
      parentPhone: normalizedParentPhone,
      parentEmail: normalizedParentEmail,
      address,
      currentClass,
      section,
      currentSession: activeSession ? activeSession.sessionName : '2024/2025',
      passportURL: req.file ? `/uploads/${req.file.filename}` : '/images/default-avatar.png',
      campus: req.session.campus
    };
    
    await Student.create(studentData);
    
    res.redirect(`/admin/students?success=Student added successfully. Default password: ${defaultPassword}`);
  } catch (error) {
    console.error('Error adding student:', error);
    res.render('pages/admin/add-student', {
      title: 'Add New Student',
      error: 'Failed to add student: ' + error.message,
      classes: await Class.find({ isActive: true }).sort({ className: 1 }),
      activeSession: await Session.getActiveSession(req.session.campus)
    });
  }
});

// Edit Student
router.get('/students/edit/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    const classes = await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 });
    const sessions = await Session.find({ campus: req.session.campus }).sort({ sessionName: -1 });
    
    if (!student) {
      return res.redirect('/admin/students?error=Student not found');
    }
    
    res.render('pages/admin/edit-student', {
      title: 'Edit Student',
      student,
      classes,
      sessions
    });
  } catch (error) {
    console.error('Error loading student for edit:', error);
    res.redirect('/admin/students?error=Unable to load student');
  }
});

// Update Student - FIXED password handling
router.post('/students/edit/:id', upload.single('passport'), async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.file) {
      updateData.passportURL = `/uploads/${req.file.filename}`;
    }

    if (updateData.studentID !== undefined) {
      updateData.studentID = updateData.studentID ? updateData.studentID.trim() : null;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'parentPhone')) {
      updateData.parentPhone = normalizeOptionalText(updateData.parentPhone);
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'parentEmail')) {
      updateData.parentEmail = normalizeOptionalText(updateData.parentEmail);
    }
    
    // If password is provided, it will be hashed by the pre-save middleware
    if (!updateData.password || updateData.password.trim() === '') {
      delete updateData.password; // Don't update password if not provided
    }
    
    await Student.findByIdAndUpdate(req.params.id, updateData);
    res.redirect('/admin/students?success=Student updated successfully');
  } catch (error) {
    console.error('Error updating student:', error);
    res.redirect('/admin/students?error=Failed to update student');
  }
});

// Delete Student (Deactivate) - FIXED
router.post('/students/delete/:id', async (req, res) => {
  try {
    await Student.findByIdAndUpdate(req.params.id, { isActive: false });
    res.redirect('/admin/students?success=Student deactivated successfully');
  } catch (error) {
    console.error('Error deactivating student:', error);
    res.redirect('/admin/students?error=Failed to deactivate student');
  }
});

// Reset Student Password to default "student123" - FIXED
router.post('/students/reset-password/:id', async (req, res) => {
  try {
    const defaultPassword = 'student123';
    const student = await Student.findById(req.params.id);
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    student.password = defaultPassword; // Will be hashed by pre-save middleware
    await student.save();
    
    res.json({ 
      success: true, 
      message: 'Password reset successfully', 
      newPassword: defaultPassword,
      studentID: student.studentID 
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// Promote Students Page - NEW
router.get('/promote', async (req, res) => {
  try {
    const activeSession = await Session.getActiveSession(req.session.campus);
    const classes = await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 });
    
    // Check if current term is Third Term
    const isThirdTerm = activeSession && activeSession.currentTerm === 'Third Term';
    
    let students = [];
    let studentsWithAverages = [];
    const selectedClass = req.query.class;
    
    if (selectedClass && isThirdTerm) {
      // Get students in the selected class
      students = await Student.find({
        currentClass: selectedClass,
        isActive: true,
        campus: req.session.campus
      }).sort({ fullName: 1 });
      
      // Calculate overall averages for each student
      studentsWithAverages = await Promise.all(students.map(async (student) => {
        // Get all approved results for this student in the current session
        const results = await Result.find({
          studentID: student.studentID,
          session: activeSession.sessionName,
          status: 'approved',
          campus: req.session.campus
        });
        
        // Calculate overall average across all terms and subjects
        let totalMarks = 0;
        let totalSubjects = 0;
        
        results.forEach(result => {
          totalMarks += result.total;
          totalSubjects++;
        });
        
        const overallAverage = totalSubjects > 0 ? (totalMarks / totalSubjects).toFixed(2) : 0;
        
        return {
          ...student.toObject(),
          overallAverage: parseFloat(overallAverage)
        };
      }));
    }
    
    res.render('pages/admin/promote', {
      title: 'Promote Students',
      classes,
      students: studentsWithAverages,
      selectedClass,
      activeSession,
      isThirdTerm
    });
  } catch (error) {
    console.error('Error loading promote page:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load promote page', error });
  }
});

// Process Student Promotion - NEW
router.post('/promote', async (req, res) => {
  try {
    const { selectedStudents, newClass } = req.body;
    const activeSession = await Session.getActiveSession(req.session.campus);
    
    if (!activeSession || activeSession.currentTerm !== 'Third Term') {
      return res.status(400).json({ 
        success: false, 
        message: 'Student promotion is only allowed during Third Term' 
      });
    }
    
    if (!selectedStudents || selectedStudents.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please select at least one student to promote' 
      });
    }
    
    if (!newClass) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please select a destination class' 
      });
    }
    
    const studentIds = Array.isArray(selectedStudents) ? selectedStudents : [selectedStudents];
    let promotedCount = 0;
    let passedOutCount = 0;
    
    for (const studentId of studentIds) {
      const student = await Student.findById(studentId);
      if (!student) continue;
      
      // Calculate overall average for this student
      const results = await Result.find({
        studentID: student.studentID,
        session: activeSession.sessionName,
        status: 'approved',
        campus: req.session.campus
      });
      
      let totalMarks = 0;
      let totalSubjects = 0;
      
      results.forEach(result => {
        totalMarks += result.total;
        totalSubjects++;
      });
      
      const overallAverage = totalSubjects > 0 ? (totalMarks / totalSubjects) : 0;
      
      if (newClass === 'Passing Out') {
        // Move student to PassedOutStudent collection
        const passedOutData = {
          fullName: student.fullName,
          studentID: student.studentID,
          gender: student.gender,
          dateOfBirth: student.dateOfBirth,
          parentPhone: student.parentPhone,
          parentEmail: student.parentEmail,
          address: student.address,
          passportURL: student.passportURL,
          passedOutFromClass: student.currentClass,
          passedOutFromSession: student.currentSession,
          passedOutYear: new Date().getFullYear(),
          overallAverage: overallAverage,
          archivedSessions: student.archivedSessions,
          admissionDate: student.admissionDate
        };
        
        await PassedOutStudent.create({ ...passedOutData, campus: req.session.campus });
        
        // Deactivate the student
        await Student.findByIdAndUpdate(studentId, { isActive: false });
        
        passedOutCount++;
      } else {
        // Regular promotion
        // Add current session to archived sessions
        const archivedSession = {
          sessionName: student.currentSession,
          className: student.currentClass,
          promoted: true,
          promotionDate: new Date()
        };
        
        // Update student with new class and archive current session
        await Student.findByIdAndUpdate(studentId, {
          currentClass: newClass,
          $push: { archivedSessions: archivedSession }
        });
        
        promotedCount++;
      }
    }
    
    let message = '';
    if (promotedCount > 0 && passedOutCount > 0) {
      message = `${promotedCount} students promoted and ${passedOutCount} students passed out successfully`;
    } else if (promotedCount > 0) {
      message = `${promotedCount} students promoted successfully`;
    } else if (passedOutCount > 0) {
      message = `${passedOutCount} students passed out successfully`;
    }
    
    res.json({ success: true, message });
  } catch (error) {
    console.error('Error promoting students:', error);
    res.status(500).json({ success: false, message: 'Failed to promote students' });
  }
});

// View Passed Out Students - NEW
router.get('/passed-out-students', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    
    // Build filter
    const filter = {};
    if (req.query.year) filter.passedOutYear = parseInt(req.query.year);
    if (req.query.class) filter.passedOutFromClass = req.query.class;
    if (req.query.session) filter.passedOutFromSession = req.query.session;
    if (req.query.search) {
      filter.$or = [
        { fullName: { $regex: req.query.search, $options: 'i' } },
        { studentID: { $regex: req.query.search, $options: 'i' } }
      ];
    }
    
    filter.campus = req.session.campus;
    
    const passedOutStudents = await PassedOutStudent.find(filter)
      .sort({ passedOutDate: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalStudents = await PassedOutStudent.countDocuments(filter);
    const totalPages = Math.ceil(totalStudents / limit);
    
    // Get unique values for filters
    const availableYears = await PassedOutStudent.distinct('passedOutYear');
    const availableClasses = await PassedOutStudent.distinct('passedOutFromClass');
    const availableSessions = await PassedOutStudent.distinct('passedOutFromSession');
    
    res.render('pages/admin/passed-out-students', {
      title: 'Passed Out Students',
      passedOutStudents,
      availableYears: availableYears.sort((a, b) => b - a), // Sort years descending
      availableClasses: availableClasses.sort(),
      availableSessions: availableSessions.sort(),
      currentPage: page,
      totalPages,
      query: req.query
    });
  } catch (error) {
    console.error('Error loading passed out students:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load passed out students', error });
  }
});

// Manage Staff
router.get('/staff', async (req, res) => {
  try {
    const staff = await User.find({ role: { $in: ['teacher', 'officer'] }, campus: req.session.campus })
      .sort({ name: 1 });
    
    res.render('pages/admin/staff', {
      title: 'Manage Staff',
      staff
    });
  } catch (error) {
    console.error('Error loading staff:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load staff', error });
  }
});

// Add Staff Form
router.get('/staff/add', async (req, res) => {
  try {
    const classes = await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 });
    const subjects = await Class.getAllSubjects();
    
    res.render('pages/admin/add-staff', {
      title: 'Add New Staff',
      classes,
      subjects
    });
  } catch (error) {
    console.error('Error loading add staff form:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load form', error });
  }
});

// Add Staff POST
router.post('/staff/add', async (req, res) => {
  try {
    const { name, email, password, role, phone, address, assignedSubjects, assignedClasses } = req.body;
    
    // Check if email already exists
    const existingUser = await User.findOne({ email, campus: req.session.campus });
    if (existingUser) {
      return res.render('pages/admin/add-staff', {
        title: 'Add New Staff',
        error: 'Email already exists',
        classes: await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 }),
        subjects: await Class.getAllSubjects()
      });
    }
    
    const userData = {
      name,
      email,
      password,
      role,
      phone,
      address,
      assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : [assignedSubjects].filter(Boolean),
      assignedClasses: Array.isArray(assignedClasses) ? assignedClasses : [assignedClasses].filter(Boolean),
      campus: req.session.campus
    };
    
    await User.create(userData);
    
    res.redirect('/admin/staff?success=Staff member added successfully');
  } catch (error) {
    console.error('Error adding staff:', error);
    res.render('pages/admin/add-staff', {
      title: 'Add New Staff',
      error: 'Failed to add staff member',
      classes: await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 }),
      subjects: await Class.getAllSubjects()
    });
  }
});

// Edit Staff Form
router.get('/staff/edit/:id', async (req, res) => {
  try {
    const staff = await User.findById(req.params.id);
    const classes = await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 });
    const subjects = await Class.getAllSubjects();
    
    if (!staff) {
      return res.redirect('/admin/staff?error=Staff member not found');
    }
    
    res.render('pages/admin/edit-staff', {
      title: 'Edit Staff',
      staff,
      classes,
      subjects
    });
  } catch (error) {
    console.error('Error loading staff for edit:', error);
    res.redirect('/admin/staff?error=Unable to load staff member');
  }
});

// Update Staff
router.post('/staff/edit/:id', async (req, res) => {
  try {
    const { name, email, role, phone, address, assignedSubjects, assignedClasses } = req.body;
    
    const updateData = {
      name,
      email,
      role,
      phone,
      address,
      assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : [assignedSubjects].filter(Boolean),
      assignedClasses: Array.isArray(assignedClasses) ? assignedClasses : [assignedClasses].filter(Boolean)
    };
    
    // Only update password if provided
    if (req.body.password && req.body.password.trim()) {
      updateData.password = req.body.password;
    }
    
    await User.findByIdAndUpdate(req.params.id, updateData);
    res.redirect('/admin/staff?success=Staff member updated successfully');
  } catch (error) {
    console.error('Error updating staff:', error);
    res.redirect('/admin/staff?error=Failed to update staff member');
  }
});

// Toggle Staff Status
router.post('/staff/toggle/:id', async (req, res) => {
  try {
    const staff = await User.findById(req.params.id);
    if (staff) {
      staff.isActive = !staff.isActive;
      await staff.save();
      res.redirect('/admin/staff?success=Staff status updated successfully');
    } else {
      res.redirect('/admin/staff?error=Staff member not found');
    }
  } catch (error) {
    console.error('Error toggling staff status:', error);
    res.redirect('/admin/staff?error=Failed to update staff status');
  }
});

// Manage Classes
router.get('/classes', async (req, res) => {
  try {
    const classes = await Class.find({ campus: req.session.campus }).sort({ className: 1 });
    res.render('pages/admin/classes', {
      title: 'Manage Classes',
      classes
    });
  } catch (error) {
    console.error('Error loading classes:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load classes', error });
  }
});

// Add Class Form
router.get('/classes/add', (req, res) => {
  res.render('pages/admin/add-class', {
    title: 'Add New Class'
  });
});

// Add Class POST
router.post('/classes/add', async (req, res) => {
  try {
    const { className, level, classTeacher, sections, subjects, subjectCodes, isCore } = req.body;
    const campus = req.session.campus || 'Lagos';

    if (!className || !level) {
      return res.render('pages/admin/add-class', {
        title: 'Add New Class',
        error: 'Class name and level are required'
      });
    }

    const trimmedClassName = className.trim();
    const existingClass = await Class.findOne({ className: trimmedClassName, campus });
    if (existingClass) {
      return res.render('pages/admin/add-class', {
        title: 'Add New Class',
        error: `A class named "${trimmedClassName}" already exists for ${campus} campus`
      });
    }
    
    const classData = {
      className: trimmedClassName,
      level,
      classTeacher,
      sections: sections ? sections.split(',').map(s => ({ sectionName: s.trim() })) : [{ sectionName: 'A' }],
      assignedSubjects: [],
      campus
    };
    
    // Process subjects
    if (subjects) {
      const subjectArray = Array.isArray(subjects) ? subjects : [subjects];
      const codeArray = Array.isArray(subjectCodes) ? subjectCodes : [subjectCodes];
      const coreArray = Array.isArray(isCore) ? isCore : [isCore];
      
      subjectArray.forEach((subject, index) => {
        if (subject && subject.trim()) {
          classData.assignedSubjects.push({
            subjectName: subject.trim(),
            subjectCode: codeArray[index] || '',
            isCore: coreArray[index] === 'true'
          });
        }
      });
    }
    
    await Class.create(classData);
    
    res.redirect('/admin/classes?success=Class added successfully');
  } catch (error) {
    console.error('Error adding class:', error);
    res.render('pages/admin/add-class', {
      title: 'Add New Class',
      error: error.message || 'Failed to add class'
    });
  }
});

// Edit Class Form - FIXED
router.get('/classes/edit/:id', async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.id);
    
    if (!classDoc) {
      return res.redirect('/admin/classes?error=Class not found');
    }
    
    res.render('pages/admin/edit-class', {
      title: 'Edit Class',
      classDoc
    });
  } catch (error) {
    console.error('Error loading class for edit:', error);
    res.redirect('/admin/classes?error=Unable to load class');
  }
});

// Update Class - FIXED
router.post('/classes/edit/:id', async (req, res) => {
  try {
    const { className, level, classTeacher, sections, subjects, subjectCodes, isCore } = req.body;
    
    const updateData = {
      className,
      level,
      classTeacher,
      sections: sections ? sections.split(',').map(s => ({ sectionName: s.trim() })) : [{ sectionName: 'A' }],
      assignedSubjects: []
    };
    
    // Process subjects
    if (subjects) {
      const subjectArray = Array.isArray(subjects) ? subjects : [subjects];
      const codeArray = Array.isArray(subjectCodes) ? subjectCodes : [subjectCodes];
      const coreArray = Array.isArray(isCore) ? isCore : [isCore];
      
      subjectArray.forEach((subject, index) => {
        if (subject && subject.trim()) {
          updateData.assignedSubjects.push({
            subjectName: subject.trim(),
            subjectCode: codeArray[index] || '',
            isCore: coreArray[index] === 'true'
          });
        }
      });
    }
    
    await Class.findByIdAndUpdate(req.params.id, updateData);
    res.redirect('/admin/classes?success=Class updated successfully');
  } catch (error) {
    console.error('Error updating class:', error);
    res.redirect('/admin/classes?error=Failed to update class');
  }
});

// Toggle Class Status
router.post('/classes/toggle/:id', async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.id);
    if (classDoc) {
      classDoc.isActive = !classDoc.isActive;
      await classDoc.save();
      res.redirect('/admin/classes?success=Class status updated successfully');
    } else {
      res.redirect('/admin/classes?error=Class not found');
    }
  } catch (error) {
    console.error('Error toggling class status:', error);
    res.redirect('/admin/classes?error=Failed to update class status');
  }
});

// Manage Sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await Session.find({ campus: req.session.campus }).sort({ sessionName: -1 });

    // Ensure term status is consistent with current date
    await Promise.all(sessions.map(async (session) => {
      await session.updateCurrentTermBasedOnDate();

      // Precompute UI helpers
      const now = new Date();
      const isWithin = (start, end) => start && end && now >= start && now <= end;
      const hasEnded = (end) => end && now > end;

      session.canOpenFirst = isWithin(session.firstTermStart, session.firstTermEnd) && session.firstTermLocked;
      session.canOpenSecond = (hasEnded(session.firstTermEnd) || session.firstTermLocked) && isWithin(session.secondTermStart, session.secondTermEnd) && session.secondTermLocked;
      session.canOpenThird = (hasEnded(session.secondTermEnd) || session.secondTermLocked) && isWithin(session.thirdTermStart, session.thirdTermEnd) && session.thirdTermLocked;
    }));

    res.render('pages/admin/sessions', {
      title: 'Manage Sessions',
      sessions
    });
  } catch (error) {
    console.error('Error loading sessions:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load sessions', error });
  }
});

// Add Session
router.post('/sessions/add', async (req, res) => {
  try {
    const { sessionName, startDate, endDate, firstTermStart, firstTermEnd, secondTermStart, secondTermEnd, thirdTermStart, thirdTermEnd } = req.body;
    const sessionData = {
      sessionName,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      firstTermStart: firstTermStart ? new Date(firstTermStart) : null,
      firstTermEnd: firstTermEnd ? new Date(firstTermEnd) : null,
      secondTermStart: secondTermStart ? new Date(secondTermStart) : null,
      secondTermEnd: secondTermEnd ? new Date(secondTermEnd) : null,
      thirdTermStart: thirdTermStart ? new Date(thirdTermStart) : null,
      thirdTermEnd: thirdTermEnd ? new Date(thirdTermEnd) : null,
      campus: req.session.campus
    };
    
    await Session.create(sessionData);
    res.redirect('/admin/sessions?success=Session added successfully');
  } catch (error) {
    console.error('Error adding session:', error);
    res.redirect('/admin/sessions?error=Failed to add session');
  }
});



router.post('/sessions/edit/:id', async (req, res) => {
  try {
    const { sessionName, startDate, endDate, firstTermStart, firstTermEnd, secondTermStart, secondTermEnd, thirdTermStart, thirdTermEnd } = req.body;
    const updateData = { 
      sessionName,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      firstTermStart: firstTermStart ? new Date(firstTermStart) : null,
      firstTermEnd: firstTermEnd ? new Date(firstTermEnd) : null,
      secondTermStart: secondTermStart ? new Date(secondTermStart) : null,
      secondTermEnd: secondTermEnd ? new Date(secondTermEnd) : null,
      thirdTermStart: thirdTermStart ? new Date(thirdTermStart) : null,
      thirdTermEnd: thirdTermEnd ? new Date(thirdTermEnd) : null
    };
    
    await Session.findByIdAndUpdate(req.params.id, updateData);
    res.redirect('/admin/sessions?success=Session updated successfully');
  } catch (error) {
    console.error('Error updating session:', error);
    res.redirect('/admin/sessions?error=Failed to update session');
  }
});

// Delete Session - FIXED
router.post('/sessions/delete/:id', async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.redirect('/admin/sessions?error=Session not found');
    }
    
    // Check if this is the active session
    if (session.isActive) {
      return res.redirect('/admin/sessions?error=Cannot delete active session. Please activate another session first.');
    }
    
    await Session.findByIdAndDelete(req.params.id);
    res.redirect('/admin/sessions?success=Session deleted successfully');
  } catch (error) {
    console.error('Error deleting session:', error);
    res.redirect('/admin/sessions?error=Failed to delete session');
  }
});

// Set Active Session
router.post('/sessions/activate/:id', async (req, res) => {
  try {
    await Session.findByIdAndUpdate(req.params.id, { isActive: true });
    res.redirect('/admin/sessions?success=Session activated successfully');
  } catch (error) {
    console.error('Error activating session:', error);
    res.redirect('/admin/sessions?error=Failed to activate session');
  }
});

// Set Current Term
router.post('/sessions/set-term/:id', async (req, res) => {
  try {
    const { currentTerm } = req.body;
    await Session.findByIdAndUpdate(req.params.id, { currentTerm });
    res.redirect('/admin/sessions?success=Term updated successfully');
  } catch (error) {
    console.error('Error updating term:', error);
    res.redirect('/admin/sessions?error=Failed to update term');
  }
});

// Lock/Unlock Term (enforced by calendar range)
router.post('/sessions/toggle-term-lock/:id', async (req, res) => {
  try {
    const { term } = req.body;
    const session = await Session.findById(req.params.id);

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Recalculate term status based on current date before any manual change
    await session.updateCurrentTermBasedOnDate();

    const now = new Date();
    const termMap = {
      'First Term': {
        lockedField: 'firstTermLocked',
        start: session.firstTermStart,
        end: session.firstTermEnd,
        prevEnd: null
      },
      'Second Term': {
        lockedField: 'secondTermLocked',
        start: session.secondTermStart,
        end: session.secondTermEnd,
        prevEnd: session.firstTermEnd
      },
      'Third Term': {
        lockedField: 'thirdTermLocked',
        start: session.thirdTermStart,
        end: session.thirdTermEnd,
        prevEnd: session.secondTermEnd
      }
    };

    const data = termMap[term];
    if (!data) {
      return res.status(400).json({ success: false, message: 'Invalid term specified' });
    }

    const isWithinRange = (start, end) => start && end && now >= start && now <= end;
    const hasEnded = (end) => end && now > end;

    // Require previous term to be ended before opening this term
    if (!session[data.lockedField] && data.prevEnd && !hasEnded(data.prevEnd)) {
      return res.status(400).json({
        success: false,
        message: `Cannot open ${term} until the previous term is complete.`
      });
    }

    // Only allow unlocking when within the term date window (if configured)
    if (session[data.lockedField] && !isWithinRange(data.start, data.end)) {
      return res.status(400).json({
        success: false,
        message: `Cannot open ${term} outside its configured date range.`
      });
    }

    // Toggle lock state
    const newLockState = !session[data.lockedField];
    session[data.lockedField] = newLockState;

    // If unlocking, lock other terms and set current term accordingly
    if (!newLockState) {
      session.currentTerm = term;
      Object.keys(termMap).forEach((termName) => {
        if (termName !== term) {
          session[termMap[termName].lockedField] = true;
        }
      });
    }

    await session.save();

    res.json({
      success: true,
      message: `${term} ${session[data.lockedField] ? 'locked' : 'unlocked'} successfully`,
      locked: session[data.lockedField]
    });
  } catch (error) {
    console.error('Error toggling term lock:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle term lock' });
  }
});

// Score Progress Dashboard
router.get('/score-entry/progress', async (req, res) => {
  try {
    const campus = req.session.campus;
    const activeSession = await Session.getActiveSession(campus);
    const selectedTerm = req.query.term || (activeSession ? activeSession.currentTerm : 'First Term');
    const selectedClass = req.query.class || '';

    const classes = await Class.find({ isActive: true, campus }).sort({ className: 1 });

    const classProgress = await Promise.all(classes.map(async (cls) => {
      const students = await Student.find({
        currentClass: cls.className,
        isActive: true,
        campus
      }).sort({ fullName: 1 });

      const assignedSubjects = (cls.assignedSubjects || []).map(subject => subject.subjectName);

      const subjectProgress = await Promise.all(assignedSubjects.map(async (subject) => {
        const totalStudents = students.length;
        const enteredCount = await Result.countDocuments({
          className: cls.className,
          subject,
          term: selectedTerm,
          session: activeSession ? activeSession.sessionName : '',
          campus
        });

        const percentage = totalStudents > 0 ? Math.round((enteredCount / totalStudents) * 100) : 0;

        return {
          subject,
          enteredCount,
          totalStudents,
          percentage
        };
      }));

      const completionPercent = subjectProgress.length > 0
        ? Math.round(subjectProgress.reduce((sum, item) => sum + item.percentage, 0) / subjectProgress.length)
        : 0;

      return {
        className: cls.className,
        studentsCount: students.length,
        completionPercent,
        subjectProgress
      };
    }));

    const highlightedClass = selectedClass || (classProgress[0] ? classProgress[0].className : '');
    classProgress.sort((a, b) => {
      if (a.className === highlightedClass) return -1;
      if (b.className === highlightedClass) return 1;
      return a.className.localeCompare(b.className);
    });

    res.render('pages/admin/score-progress', {
      title: 'Score Progress',
      classProgress,
      activeSession,
      selectedTerm,
      selectedClass: highlightedClass,
      campus,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error loading score progress page:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load score progress page', error });
  }
});

// Score Entry Page - COMPLETELY REWRITTEN
router.get('/score-entry', async (req, res) => {
  try {
    const activeSession = await Session.getActiveSession(req.session.campus);
    const classes = await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 });
    
    // Get filter parameters
    const selectedClass = req.query.class;
    const selectedSubject = req.query.subject;
    const selectedTerm = req.query.term || (activeSession ? activeSession.currentTerm : 'First Term');
    
    let students = [];
    let subjects = [];
    let existingResults = [];
    
    if (selectedClass) {
      // Get students in the selected class
      students = await Student.find({
        currentClass: selectedClass,
        isActive: true,
        campus: req.session.campus
      }).sort({ fullName: 1 });
      
      // Get subjects for the selected class
      const classDoc = await Class.findOne({ className: selectedClass, campus: req.session.campus });
      subjects = classDoc ? classDoc.assignedSubjects : [];
      
      if (selectedSubject) {
        // Check if results have been approved/published for this class/subject/term
        const finalizedResults = await Result.findOne({
          className: selectedClass,
          subject: selectedSubject,
          term: selectedTerm,
          session: activeSession ? activeSession.sessionName : '',
          status: { $in: ['approved', 'published'] },
          campus: req.session.campus
        });

        if (finalizedResults) {
          // Results have been approved/published, show them but disable editing
          existingResults = await Result.find({
            className: selectedClass,
            subject: selectedSubject,
            term: selectedTerm,
            session: activeSession ? activeSession.sessionName : '',
            status: { $in: ['approved', 'published'] },
            campus: req.session.campus
          });
        } else {
          // Get existing draft results for editing
          existingResults = await Result.find({
            className: selectedClass,
            subject: selectedSubject,
            term: selectedTerm,
            session: activeSession ? activeSession.sessionName : '',
            status: 'draft',
            campus: req.session.campus
          });
        }
      }
    }
    
    let isEditingDisabled = false;
    let hasSentForApproval = false;
    let classLevel = 'secondary';
    let scoreStructure = getScoreStructure(selectedClass || '');
    let isPrimary = false;

    if (selectedClass) {
      classLevel = getClassLevel(selectedClass);
      isPrimary = classLevel === 'primary';
      scoreStructure = getScoreStructure(selectedClass);
    }
    
    if (selectedClass && selectedSubject) {
      // If we're loading approved/published results, make the form read-only
      if (existingResults.some(r => ['approved', 'published'].includes(r.status))) {
        isEditingDisabled = true;
      }

      // If any draft has already been sent for approval, show the draft indicator
      if (existingResults.some(r => r.sentForApproval)) {
        hasSentForApproval = true;
      }
    }
    
    res.render('pages/admin/score-entry', {
      title: 'Score Entry',
      classes,
      subjects,
      students,
      existingResults,
      selectedClass,
      selectedSubject,
      selectedTerm,
      activeSession,
      isEditingDisabled,
      hasSentForApproval,
      classLevel,
      isPrimary,
      scoreStructure
    });
  } catch (error) {
    console.error('Error loading score entry page:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load score entry page', error });
  }
});

// Get subjects for class - API endpoint
router.get('/api/classes/:className/subjects', async (req, res) => {
  try {
    const classDoc = await Class.findOne({ className: req.params.className, campus: req.session.campus });
    const subjects = classDoc ? classDoc.assignedSubjects : [];
    res.json({ success: true, subjects });
  } catch (error) {
    console.error('Error getting subjects:', error);
    res.status(500).json({ success: false, message: 'Failed to get subjects' });
  }
});

// Reopen approved/published results for editing
router.post('/score-entry/revoke', async (req, res) => {
  try {
    const { className, subject, term, session } = req.body;

    if (!className || !subject || !term || !session) {
      return res.status(400).json({ success: false, message: 'Class, subject, term, and session are required' });
    }

    const updateResult = await Result.updateMany(
      {
        className,
        subject,
        term,
        session,
        campus: req.session.campus,
        status: { $in: ['approved', 'published'] }
      },
      {
        $set: {
          status: 'draft',
          sentForApproval: false,
          approvedBy: null,
          approvedAt: null,
          published: false,
          publishedBy: null,
          publishedAt: null,
          position: null,
          subjectPosition: null
        }
      }
    );

    if ((updateResult.modifiedCount || updateResult.matchedCount || 0) === 0) {
      return res.status(400).json({ success: false, message: 'No approved or published results found to revoke' });
    }

    res.json({ success: true, message: 'Results reopened for editing successfully' });
  } catch (error) {
    console.error('Error revoking results:', error);
    res.status(500).json({ success: false, message: 'Failed to reopen results for editing' });
  }
});

// Save Scores - UPDATED for new grading system
router.post('/score-entry/save', async (req, res) => {
  try {
    const { className, subject, term, session, results } = req.body;
    await persistResultsForSave(req, { className, subject, term, session, results });
    res.json({ success: true, message: 'Scores saved successfully as draft' });
  } catch (error) {
    console.error('Error saving scores:', error);
    res.status(500).json({ success: false, message: 'Failed to save scores' });
  }
});

// Send Results for Approval - Keep as draft but mark as sent
router.post('/score-entry/send', async (req, res) => {
  try {
    const { className, subject, term, session, results } = req.body;

    await persistResultsForSave(req, { className, subject, term, session, results });

    const updateResult = await Result.updateMany(
      {
        className,
        subject,
        term,
        session,
        status: 'draft',
        campus: req.session.campus
      },
      {
        sentAt: new Date(),
        sentForApproval: true
      }
    );

    if (updateResult.modifiedCount === 0 && updateResult.matchedCount === 0) {
      return res.status(400).json({ success: false, message: 'No draft results found to send' });
    }

    res.json({
      success: true,
      message: `${updateResult.modifiedCount || updateResult.matchedCount || 0} results sent for approval successfully`
    });
  } catch (error) {
    console.error('Error sending results:', error);
    res.status(500).json({ success: false, message: 'Failed to send results' });
  }
});

// Send all draft results for the selected class/term/session for approval
router.post('/score-entry/send-class', async (req, res) => {
  try {
    const { className, term, session, subject, results } = req.body;

    if (subject) {
      await persistResultsForSave(req, { className, subject, term, session, results });
    }

    const updateResult = await Result.updateMany(
      {
        className,
        term,
        session,
        status: 'draft',
        campus: req.session.campus
      },
      {
        sentAt: new Date(),
        sentForApproval: true
      }
    );

    if (updateResult.modifiedCount === 0 && updateResult.matchedCount === 0) {
      return res.status(400).json({ success: false, message: 'No draft class results found to send' });
    }

    res.json({
      success: true,
      message: `${updateResult.modifiedCount || updateResult.matchedCount || 0} class results sent for approval successfully`
    });
  } catch (error) {
    console.error('Error sending class results:', error);
    res.status(500).json({ success: false, message: 'Failed to send class results' });
  }
});

// Announcements - COMPLETE CRUD
router.get('/announcements', async (req, res) => {
  try {
    const announcements = await Announcement.find({ campus: req.session.campus }).sort({ createdAt: -1 });
    res.render('pages/admin/announcements', {
      title: 'Manage Announcements',
      announcements
    });
  } catch (error) {
    console.error('Error loading announcements:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load announcements', error });
  }
});

// Add Announcement
router.post('/announcements/add', async (req, res) => {
  try {
    const { title, content, priority, targetAudience } = req.body;
    
    await Announcement.create({
      title,
      content,
      priority: priority || 'normal',
      targetAudience: Array.isArray(targetAudience) ? targetAudience : [targetAudience],
      createdBy: req.session.user.email,
      campus: req.session.campus
    });
    
    res.redirect('/admin/announcements?success=Announcement created successfully');
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.redirect('/admin/announcements?error=Failed to create announcement');
  }
});

// Edit Announcement
router.post('/announcements/edit/:id', async (req, res) => {
  try {
    const { title, content, priority, targetAudience } = req.body;
    
    await Announcement.findByIdAndUpdate(req.params.id, {
      title,
      content,
      priority: priority || 'normal',
      targetAudience: Array.isArray(targetAudience) ? targetAudience : [targetAudience]
    });
    
    res.redirect('/admin/announcements?success=Announcement updated successfully');
  } catch (error) {
    console.error('Error updating announcement:', error);
    res.redirect('/admin/announcements?error=Failed to update announcement');
  }
});

// Delete Announcement
router.post('/announcements/delete/:id', async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.redirect('/admin/announcements?success=Announcement deleted successfully');
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.redirect('/admin/announcements?error=Failed to delete announcement');
  }
});

// Toggle Announcement Status
router.post('/announcements/toggle/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (announcement) {
      announcement.isActive = !announcement.isActive;
      await announcement.save();
      res.redirect('/admin/announcements?success=Announcement status updated');
    } else {
      res.redirect('/admin/announcements?error=Announcement not found');
    }
  } catch (error) {
    console.error('Error toggling announcement:', error);
    res.redirect('/admin/announcements?error=Failed to update announcement');
  }
});

// School Profile
router.get('/school', async (req, res) => {
  try {
    const school = await School.findOne({ campus: req.session.campus });
    const currentAdmin = await User.findById(req.session.user.id).select('email name role');
    res.render('pages/admin/school', {
      title: 'School Profile',
      school,
      currentAdmin
    });
  } catch (error) {
    console.error('Error loading school profile:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load school profile', error });
  }
});

// Update School Profile
router.post('/school', upload.single('logo'), async (req, res) => {
  try {
    const updateData = {
      name: req.body.name || '',
      motto: req.body.motto || '',
      address: req.body.address || '',
      phone: req.body.phone || '',
      email: req.body.email || '',
      website: req.body.website || '',
      mission: req.body.mission || '',
      vision: req.body.vision || '',
      about: req.body.about || '',
      principalName: req.body.principalName || '',
      principalMessage: req.body.principalMessage || '',
      accreditation: req.body.accreditation || '',
      establishedYear: req.body.establishedYear || null,
      campus: req.session.campus,
      signatureUrl: req.body.signatureUrl || ''
    };

    if (req.file) {
      updateData.logo = `/uploads/${req.file.filename}`;
    }

    const school = await School.findOne({ campus: req.session.campus });
    if (school) {
      Object.assign(school, updateData);
      await school.save();
    } else {
      await School.create(updateData);
    }

    const adminEmail = (req.body.adminEmail || '').trim();
    const adminPassword = (req.body.adminPassword || '').trim();
    if (adminEmail || adminPassword) {
      const adminUser = await User.findById(req.session.user.id);
      if (adminUser) {
        if (adminEmail) {
          adminUser.email = adminEmail;
        }
        if (adminPassword) {
          adminUser.password = adminPassword;
        }
        await adminUser.save();
        req.session.user.email = adminUser.email;
      }
    }

    res.redirect('/admin/school?success=School profile and admin credentials updated successfully');
  } catch (error) {
    console.error('Error updating school profile:', error);
    res.redirect('/admin/school?error=Failed to update school profile');
  }
});

module.exports = router;