const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Student = require('../models/Student');
const Result = require('../models/Result');
const Session = require('../models/Session');
const { requireAuth, requireRole } = require('../middleware/auth');

// Dashboard Route
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    
    // Get current session
    const currentSession = await Session.getActiveSession(req.session.campus);
    
    if (user.role === 'admin') {
      // Admin Dashboard
      const stats = await getAdminStats(req.session.campus);
      res.render('pages/admin-dashboard', {
        title: 'Admin Dashboard',
        user,
        stats,
        currentSession
      });
    } else if (user.role === 'teacher') {
      // Teacher Dashboard
      const stats = await getTeacherStats(user, req.session.campus);
      res.render('pages/teacher-dashboard', {
        title: 'Teacher Dashboard',
        user,
        stats,
        currentSession
      });
    } else if (user.role === 'officer') {
      // Result Officer Dashboard
      const stats = await getOfficerStats(req.session.campus);
      res.render('pages/officer-dashboard', {
        title: 'Result Officer Dashboard',
        user,
        stats,
        currentSession
      });
    } else {
      res.redirect('/login');
    }
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('pages/error', {
      title: 'Error',
      message: 'Unable to load dashboard',
      error
    });
  }
});

// Helper function to get admin statistics
async function getAdminStats(campus) {
  try {
    const totalStudents = await Student.countDocuments({ isActive: true, campus });
    const totalTeachers = await User.countDocuments({ role: 'teacher', isActive: true, campus });
    const totalOfficers = await User.countDocuments({ role: 'officer', isActive: true, campus });
    const publishedResults = await Result.countDocuments({ published: true, campus });
    const unpublishedResults = await Result.countDocuments({ published: false, campus });
    
    // Get students by class
    const studentsByClass = await Student.aggregate([
      { $match: { isActive: true, campus } },
      { $group: { _id: '$currentClass', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // Get recent activities (show only 3 at a time)
    const recentResults = await Result.find({ campus })
      .sort({ enteredAt: -1 })
      .limit(3)
      .select('studentName subject className term session enteredAt');

    return {
      totalStudents,
      totalTeachers,
      totalOfficers,
      publishedResults,
      unpublishedResults,
      studentsByClass,
      recentResults
    };
  } catch (error) {
    console.error('Error getting admin stats:', error);
    return {};
  }
}

// Helper function to get teacher statistics
async function getTeacherStats(user, campus) {
  try {
    const assignedClasses = user.assignedClasses || [];
    const assignedSubjects = user.assignedSubjects || [];
    
    const studentsInClasses = await Student.countDocuments({
      currentClass: { $in: assignedClasses },
      isActive: true,
      campus
    });
    
    const resultsEntered = await Result.countDocuments({
      enteredBy: user.email,
      subject: { $in: assignedSubjects },
      campus
    });
    
    const pendingResults = await Result.countDocuments({
      enteredBy: user.email,
      published: false,
      campus
    });

    // Get recent results entered by this teacher
    const recentResults = await Result.find({
      enteredBy: user.email,
      campus
    })
    .sort({ enteredAt: -1 })
    .limit(5)
    .select('studentName subject className total grade enteredAt');

    return {
      assignedClasses: assignedClasses.length,
      assignedSubjects: assignedSubjects.length,
      studentsInClasses,
      resultsEntered,
      pendingResults,
      recentResults
    };
  } catch (error) {
    console.error('Error getting teacher stats:', error);
    return {};
  }
}

// Helper function to get officer statistics
async function getOfficerStats(campus) {
  try {
    const pendingApproval = await Result.countDocuments({ published: false, campus });
    const approvedResults = await Result.countDocuments({ published: true, campus });
    
    // Get results by class for approval
    const resultsByClass = await Result.aggregate([
      { $match: { published: false, campus } },
      { $group: { _id: '$className', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // Get recent approvals
    const recentApprovals = await Result.find({ published: true, campus })
      .sort({ publishedAt: -1 })
      .limit(10)
      .select('studentName subject className publishedBy publishedAt');

    return {
      pendingApproval,
      approvedResults,
      resultsByClass,
      recentApprovals
    };
  } catch (error) {
    console.error('Error getting officer stats:', error);
    return {};
  }
}

// Get notification data for user
async function getNotificationData(user, campus) {
  try {
    // Last login - use current date minus some time for demo
    const lastLogin = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    
    // Recent activities - get recent results
    const recentResults = await Result.find({ campus })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('studentName subject className createdAt');
    
    const activities = recentResults.map(result => ({
      type: 'activity',
      message: `Result entered for ${result.studentName} - ${result.subject}`,
      time: result.createdAt
    }));
    
    return {
      lastLogin,
      activities
    };
  } catch (error) {
    console.error('Error getting notification data:', error);
    return {
      lastLogin: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      activities: []
    };
  }
}

module.exports = router;