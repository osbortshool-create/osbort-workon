const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Student = require('../models/Student');
const School = require('../models/School');
const Announcement = require('../models/Announcement');

// Landing Page
router.get('/', async (req, res) => {
  try {
    const school = await School.findOne({ campus: 'Lagos' }) || await School.findOne({}) || null;
    const announcements = await Announcement.find({
      isActive: true,
      targetAudience: { $in: ['all'] }
    }).sort({ createdAt: -1 }).limit(3);

    res.render('pages/landing', {
      title: 'Welcome to EduControl NG',
      school: school,
      announcements
    });
  } catch (error) {
    console.error('Error loading landing page:', error);
    res.render('pages/landing', {
      title: 'Welcome to EduControl NG',
      school: null,
      announcements: []
    });
  }
});

// Login Page
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('pages/login', {
    title: 'Login - EduControl NG',
    error: null
  });
});

// Login POST
router.post('/login', async (req, res) => {
  const { email, password, loginType, campus } = req.body;

  const selectedCampus = ['Lagos', 'Ekiti'].includes(campus) ? campus : 'Lagos';

  console.log('Login attempt:', { email, loginType, campus: selectedCampus });

  try {
    if (loginType === 'student') {
      const loginIdentifier = (email || '').trim();
      const escapedEmail = loginIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Build phone number variants to handle different storage formats
      // e.g. "08012345678", "8012345678", "+2348012345678", "2348012345678"
      const phoneVariants = [loginIdentifier];
      const digitsOnly = loginIdentifier.replace(/\D/g, '');
      if (digitsOnly && digitsOnly !== loginIdentifier) phoneVariants.push(digitsOnly);
      if (digitsOnly.startsWith('234') && digitsOnly.length > 10) {
        phoneVariants.push('0' + digitsOnly.slice(3));
        phoneVariants.push(digitsOnly.slice(3));
      }
      if (digitsOnly.length === 10 && !digitsOnly.startsWith('0')) {
        phoneVariants.push('0' + digitsOnly);
      }
      if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
        phoneVariants.push('+234' + digitsOnly.slice(1));
        phoneVariants.push('234' + digitsOnly.slice(1));
      }
      const uniquePhoneVariants = [...new Set(phoneVariants)];

      console.log('Attempting student login with:', loginIdentifier, '| phone variants:', uniquePhoneVariants);

      // Siblings may share the same parent phone/email, so multiple students can
      // match the identifier. Fetch all matches and pick the one whose password
      // is correct so each student can log in independently.
      const students = await Student.find({
        campus: selectedCampus,
        $or: [
          { parentPhone: { $in: uniquePhoneVariants } },
          { parentEmail: { $regex: new RegExp('^' + escapedEmail + '$', 'i') } },
          { studentID: { $regex: new RegExp('^' + escapedEmail + '$', 'i') } }
        ]
      });

      if (!students || students.length === 0) {
        console.log('Student login failed: Student not found');
        return res.render('pages/login', {
          title: 'Login - EduControl NG',
          error: 'Invalid parent phone/email or password'
        });
      }

      let student = null;
      for (const candidate of students) {
        const ok = await candidate.comparePassword(password);
        if (ok) {
          student = candidate;
          break;
        }
      }

      if (!student) {
        console.log('Student login failed: Invalid password for', students.length, 'matching record(s)');
        return res.render('pages/login', {
          title: 'Login - EduControl NG',
          error: 'Invalid parent phone/email or password'
        });
      }

      console.log('Student found:', { id: student.studentID, name: student.fullName, isActive: student.isActive });

      if (!student.isActive) {
        console.log('Student login failed: Account deactivated');
        return res.render('pages/login', {
          title: 'Login - EduControl NG',
          error: 'Your account has been deactivated. Contact the school administration.'
        });
      }

      student.lastLogin = new Date();
      await student.save();

      req.session.user = {
        id: student._id,
        name: student.fullName,
        studentID: student.studentID,
        role: 'student',
        currentClass: student.currentClass,
        currentSession: student.currentSession,
        lastLogin: student.lastLogin,
        campus: selectedCampus
      };
      req.session.studentTokenVerified = false;
      delete req.session.studentToken;

      console.log('Student login successful');

      const announcements = await Announcement.find({
        isActive: true,
        targetAudience: { $in: ['all', 'students'] },
        campus: selectedCampus
      }).sort({ createdAt: -1 }).limit(3);

      req.session.announcements = announcements;

      await new Promise((resolve, reject) => {
        req.session.save(err => err ? reject(err) : resolve());
      });

      return res.redirect('/student/portal');
    } else {
      // Staff login
      console.log('Looking for staff user with email:', email, 'campus:', selectedCampus);
      let user = await User.findOne({ email, campus: selectedCampus });

      if (!user) {
        console.log('User not found in', selectedCampus, 'campus, trying any campus');
        user = await User.findOne({ email });
      }

      if (!user) {
        console.log('Staff login failed: User not found');
        return res.render('pages/login', {
          title: 'Login - EduControl NG',
          error: 'Invalid email or password'
        });
      }

      console.log('Found user:', { name: user.name, email: user.email, role: user.role, isActive: user.isActive });

      const isValidPassword = await user.comparePassword(password);
      console.log('Password validation result:', isValidPassword);

      if (!isValidPassword) {
        console.log('Staff login failed: Invalid password');
        return res.render('pages/login', {
          title: 'Login - EduControl NG',
          error: 'Invalid email or password'
        });
      }

      if (!user.isActive) {
        console.log('Staff login failed: Account deactivated');
        return res.render('pages/login', {
          title: 'Login - EduControl NG',
          error: 'Your account has been deactivated. Contact the administrator.'
        });
      }

      user.lastLogin = new Date();
      await user.save();

      const normalizedUserRole = String(user.role || '').toLowerCase().trim();
      req.session.user = {
        id: user._id,
        name: user.name,
        email: user.email,
        role: normalizedUserRole,
        assignedSubjects: user.assignedSubjects,
        assignedClasses: user.assignedClasses,
        lastLogin: user.lastLogin,
        campus: selectedCampus
      };

      await new Promise((resolve, reject) => {
        req.session.save(err => err ? reject(err) : resolve());
      });

      console.log('Staff login successful, redirecting to dashboard');
      return res.redirect('/dashboard');
    }
  } catch (error) {
    console.error('Login error:', error);
    res.render('pages/login', {
      title: 'Login - EduControl NG',
      error: 'An error occurred during login. Please try again.'
    });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/login');
  });
});

module.exports = router;
