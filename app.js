const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();

// Import Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const teacherRoutes = require('./routes/teacher');
const studentRoutes = require('./routes/student');
const resultRoutes = require('./routes/result');
const dashboardRoutes = require('./routes/dashboard');
const analyticsRoutes = require('./routes/analytics');
const practiceRoutes = require('./routes/practice');
const tokenRoutes = require('./routes/tokens');

// Import Models
require('./models/User');
require('./models/Student');
require('./models/Result');
require('./models/Class');
require('./models/Session');
require('./models/School');
require('./models/PracticeQuestion');
require('./models/PassedOutStudent');
require('./models/ResultToken');
require('./models/Announcement');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  // store: MongoStore.create({
  //   mongoUrl: process.env.MONGODB_URI
  // }),
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Global Middleware for User Session
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  // Campus lives on req.session.user.campus (set at login); mirror it to req.session.campus
  // for convenience and so unauthenticated routes fall back to a default.
  req.session.campus = (req.session.user && req.session.user.campus) || req.session.campus || null;
  res.locals.campus = req.session.campus || null;

  try {
    const School = require('./models/School');
    const schoolDoc = await School.findOne({ campus: req.session.campus || 'Lagos' }) || await School.findOne({ campus: 'Lagos' }) || await School.findOne({}) || null;
    res.locals.school = schoolDoc;
    res.locals.schoolLogo = schoolDoc && schoolDoc.logo ? schoolDoc.logo : '/images/default-logo.png';
  } catch (error) {
    console.error('Error loading school for header:', error.message);
    res.locals.school = null;
    res.locals.schoolLogo = '/images/default-logo.png';
  }

  // Set notification data for authenticated users
  if (req.session.user) {
    try {
      const { getAdminNotifications, getStudentNotifications } = require('./utils/notifications');
      const lastLogin = req.session.user.lastLogin ? new Date(req.session.user.lastLogin) : null;
      const lastRead = req.session.notificationLastReadAt ? new Date(req.session.notificationLastReadAt) : null;

      if (req.session.user.role === 'student') {
        const notificationData = await getStudentNotifications(req.session.user.studentID, lastRead, req.session.campus);
        res.locals.notificationData = notificationData;
        res.locals.unreadCount = Array.isArray(notificationData.activities) ? notificationData.activities.length : 0;
      } else {
        const notificationData = await getAdminNotifications(lastLogin, req.session.user.email, req.session.user.role, lastRead, req.session.campus);
        res.locals.notificationData = notificationData;
        res.locals.unreadCount = Array.isArray(notificationData.activities) ? notificationData.activities.length : 0;
      }
    } catch (error) {
      console.error('Error setting notification data:', error);
      res.locals.notificationData = {
        lastLogin: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        activities: []
      };
      res.locals.unreadCount = 0;
    }
  }
  
  next();
});

// Routes
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/teacher', teacherRoutes);
app.use('/student', studentRoutes);
app.use('/result', resultRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/', practiceRoutes);
app.use('/tokens', tokenRoutes);

// Notification routes (mark read)
const notificationRoutes = require('./routes/notifications');
app.use('/', notificationRoutes);

// Database Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(async () => {
  console.log('Connected to MongoDB Atlas');
    await ensureStudentIndexes();

    // Migrate existing documents to default campus 'Lagos' if campus field is missing
    try {
      const models = ['Student', 'User', 'Class', 'Session', 'Announcement', 'PracticeQuestion', 'PassedOutStudent', 'School', 'Result', 'ResultToken'];
      for (const name of models) {
        try {
          const Model = require(`./models/${name}`);
          if (Model.updateMany) {
            await Model.updateMany({ campus: { $exists: false } }, { $set: { campus: 'Lagos' } });
          }
        } catch (e) { /* model may not exist */ }
      }
    } catch (e) { console.error('Campus migration error:', e.message); }

    try {
      const Student = require('./models/Student');
      await Student.updateMany(
        {
          $or: [
            { parentPhone: '' },
            { parentPhone: ' ' },
            { parentEmail: '' },
            { parentEmail: ' ' }
          ]
        },
        {
          $set: {
            parentPhone: null,
            parentEmail: null
          }
        }
      );
      console.log('Student contact cleanup completed');
    } catch (e) {
      console.error('Student contact cleanup error:', e.message);
    }

    try {
      const Student = require('./models/Student');
      const Result = require('./models/Result');
      const ResultToken = require('./models/ResultToken');

      const fixedStudents = await Student.ensureMissingStudentIds();
      console.log(`Student ID normalization completed: ${fixedStudents} student(s) fixed`);

      const resultsWithoutIds = await Result.find({
        $or: [
          { studentID: null },
          { studentID: '' },
          { studentID: { $exists: false } }
        ]
      }).sort({ createdAt: 1 });

      let fixedResults = 0;
      for (const result of resultsWithoutIds) {
        let matchedStudent = null;
        if (result.studentRef) {
          matchedStudent = await Student.findById(result.studentRef);
        }
        if (!matchedStudent && result.studentName) {
          matchedStudent = await Student.findOne({
            fullName: result.studentName,
            currentClass: result.className,
            campus: result.campus || 'Lagos'
          });
        }
        if (matchedStudent && matchedStudent.studentID) {
          await Result.updateOne({ _id: result._id }, {
            $set: {
              studentID: matchedStudent.studentID,
              studentRef: matchedStudent._id.toString()
            }
          });
          fixedResults += 1;
        }
      }
      console.log(`Result student ID backfill completed: ${fixedResults} result(s) fixed`);

      const tokensWithoutIds = await ResultToken.find({
        $or: [
          { studentID: null },
          { studentID: '' },
          { studentID: { $exists: false } }
        ]
      }).sort({ createdAt: 1 });

      let fixedTokens = 0;
      for (const token of tokensWithoutIds) {
        const matchedStudent = await Student.findOne({
          fullName: token.studentName,
          currentClass: token.className,
          campus: token.campus || 'Lagos'
        });
        if (matchedStudent && matchedStudent.studentID) {
          await ResultToken.updateOne({ _id: token._id }, { $set: { studentID: matchedStudent.studentID } });
          fixedTokens += 1;
        }
      }
      console.log(`Token student ID backfill completed: ${fixedTokens} token(s) fixed`);
    } catch (e) {
      console.error('Student ID normalization error:', e.message);
    }
    // Initialize default data ONLY if needed
    initializeDefaultData();
})
.catch(err => {
  console.error('MongoDB connection error:', err);
});
async function ensureStudentIndexes() {
  try {
    const Student = require('./models/Student');
    const indexes = await Student.collection.indexes();
    const studentIdIndex = indexes.find((idx) => idx.key && idx.key.studentID === 1 && idx.key.campus === 1);

    if (studentIdIndex) {
      await Student.collection.dropIndex(studentIdIndex.name);
    }

    await Student.updateMany(
      { $or: [{ studentID: '' }, { studentID: { $exists: false } }] },
      { $set: { studentID: null } }
    );

    await Student.syncIndexes();
    console.log('Student indexes synchronized');
  } catch (error) {
    console.error('Student index migration error:', error.message);
  }
}
// Initialize Default Data - FIXED to prevent dummy data
async function initializeDefaultData() {
  const User = require('./models/User');
  const School = require('./models/School');
  const Session = require('./models/Session');
  
  try {
    // Set default values if environment variables are not set
    const defaultAdminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@school.edu.ng';
    const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    
    console.log('Checking for default admin with email:', defaultAdminEmail);

   // Create default admin for EACH campus if missing
const campuses = ['Lagos', 'Ekiti'];
for (const campus of campuses) {
  let existingAdmin = await User.findOne({ email: defaultAdminEmail, campus });

  if (!existingAdmin || !existingAdmin.password) {
    if (existingAdmin) {
      await User.deleteOne({ email: defaultAdminEmail, campus });
      console.log(`⚠️ Corrupted admin deleted from DB (${campus})`);
    }

    await User.create({
      name: 'System Administrator',
      email: defaultAdminEmail,
      password: defaultAdminPassword, // plain text, will be hashed by the pre-save middleware
      role: 'admin',
      assignedSubjects: [],
      assignedClasses: [],
      campus
    });

    console.log(`✅ Default admin created for ${campus} campus`);
    console.log(`Login email: ${defaultAdminEmail}`);
    console.log(`Password: ${defaultAdminPassword}`);
  } else {
    console.log(`✅ Default admin already exists for ${campus} campus`);
  }
}


    // Create default school profile for EACH campus if none exists
    for (const campus of campuses) {
      const schoolExists = await School.findOne({ campus });
      if (!schoolExists) {
        await School.create({
          name: campus === 'Ekiti' ? 'Osbot International Schools' : 'Osbot Royal Schools',
          motto: 'Excellence in Education',
          address: campus === 'Ekiti'
            ? 'Osbot Road, Aso Ayegunle, Ado-Ekiti, Ekiti State'
            : '38 Unit Road, Isale Odo, Eleyin B/Stop, Ikole-Odunsi via Ipaja, Lagos State',
          phone: '+234-XXX-XXX-XXXX',
          email: 'info@yourschool.edu.ng',
          logo: '/images/default-logo.png',
          mission: 'To provide quality education that prepares students for success.',
          vision: 'To be a leading educational institution in Nigeria.',
          about: 'We are committed to academic excellence and character development.',
          gallery: [],
          campus
        });
        console.log(`Default school profile created for ${campus} campus`);
      }
    }

    // DO NOT create default session - let admin create sessions manually
    console.log('Initialization complete - no dummy sessions created');

  } catch (error) {
    console.error('Error initializing default data:', error);
  }
}

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack || err.message || err);
  if (res.headersSent) return next(err);
  try {
    res.status(500).render('error', { 
      title: 'Server Error',
      message: 'Something went wrong!',
      error: process.env.NODE_ENV === 'development' ? err : {}
    });
  } catch (e) {
    console.error('Error rendering error page:', e.message);
    res.status(500).send('Internal Server Error');
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 - Page Not Found',
    message: 'The page you are looking for does not exist.',
    error: {}
  });
});

const requestedPort = Number(process.env.PORT) || 3000;

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`EduControl NG Server running on port ${port}`);
    console.log(`Visit: http://localhost:${port}`);
    console.log('Environment variables loaded:');
    console.log('- DEFAULT_ADMIN_EMAIL:', process.env.DEFAULT_ADMIN_EMAIL || 'admin@school.edu.ng (fallback)');
    console.log('- DEFAULT_ADMIN_PASSWORD:', process.env.DEFAULT_ADMIN_PASSWORD || 'admin123 (fallback)');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const fallbackPort = port + 1;
      console.warn(`Port ${port} is busy. Trying ${fallbackPort} instead.`);
      startServer(fallbackPort);
      return;
    }

    console.error('Server startup error:', error);
    process.exit(1);
  });
}

startServer(requestedPort);

module.exports = app;