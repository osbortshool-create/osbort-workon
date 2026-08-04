const express = require('express');
const router = express.Router();
const Result = require('../models/Result');
const Student = require('../models/Student');
const Session = require('../models/Session');
const { requireAuth, requireRole } = require('../middleware/auth');

// All analytics routes require admin role
router.use(requireAuth);
router.use(requireRole('admin'));

// Performance Analytics Page
router.get('/performance-analytics', async (req, res) => {
  try {
    const activeSession = await Session.getActiveSession(req.session.campus);
    const sessionName = activeSession ? activeSession.sessionName : '2024/2025';
    
    // Get top 10 students by term
    const terms = ['First Term', 'Second Term', 'Third Term'];
    const termAnalytics = {};
    
    for (const term of terms) {
      const topStudents = await Result.aggregate([
        {
          $match: {
            term: term,
            session: sessionName,
            status: { $in: ['approved', 'published'] },
            campus: req.session.campus
          }
        },
        {
          $group: {
            _id: '$studentID',
            studentName: { $first: '$studentName' },
            className: { $first: '$className' },
            averageScore: { $avg: '$total' },
            totalSubjects: { $sum: 1 }
          }
        },
        {
          $match: {
            totalSubjects: { $gte: 3 } // At least 3 subjects
          }
        },
        {
          $sort: { averageScore: -1 }
        },
        {
          $limit: 10
        }
      ]);
      
      termAnalytics[term] = topStudents;
    }
    
    // Get overall top 10 students for the session
    const overallTopStudents = await Result.aggregate([
      {
        $match: {
          session: sessionName,
          status: { $in: ['approved', 'published'] },
          campus: req.session.campus
        }
      },
      {
        $group: {
          _id: '$studentID',
          studentName: { $first: '$studentName' },
          className: { $first: '$className' },
          averageScore: { $avg: '$total' },
          totalSubjects: { $sum: 1 },
          totalScore: { $sum: '$total' }
        }
      },
      {
        $match: {
          totalSubjects: { $gte: 5 } // At least 5 subjects for overall ranking
        }
      },
      {
        $sort: { averageScore: -1, totalScore: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    // Get class performance summary
    const classPerformance = await Result.aggregate([
      {
        $match: {
          session: sessionName,
          status: { $in: ['approved', 'published'] },
          campus: req.session.campus
        }
      },
      {
        $group: {
          _id: '$className',
          averageScore: { $avg: '$total' },
          totalStudents: { $addToSet: '$studentID' },
          totalResults: { $sum: 1 }
        }
      },
      {
        $addFields: {
          studentCount: { $size: '$totalStudents' }
        }
      },
      {
        $sort: { averageScore: -1 }
      }
    ]);
    
    // Get subject performance
    const subjectPerformance = await Result.aggregate([
      {
        $match: {
          session: sessionName,
          status: { $in: ['approved', 'published'] },
          campus: req.session.campus
        }
      },
      {
        $group: {
          _id: '$subject',
          averageScore: { $avg: '$total' },
          totalStudents: { $sum: 1 },
          passRate: {
            $avg: {
              $cond: [{ $gte: ['$total', 40] }, 1, 0]
            }
          }
        }
      },
      {
        $sort: { averageScore: -1 }
      }
    ]);
    
    res.render('pages/admin/performance-analytics', {
      title: 'Performance Analytics',
      termAnalytics,
      overallTopStudents,
      classPerformance,
      subjectPerformance,
      activeSession
    });
  } catch (error) {
    console.error('Error loading performance analytics:', error);
    res.render('pages/error', { 
      title: 'Error', 
      message: 'Unable to load performance analytics', 
      error 
    });
  }
});

// API endpoint for chart data
router.get('/api/chart-data', async (req, res) => {
  try {
    const { type, term } = req.query;
    const activeSession = await Session.getActiveSession(req.session.campus);
    const sessionName = activeSession ? activeSession.sessionName : '2024/2025';
    
    if (type === 'term' && term) {
      const topStudents = await Result.aggregate([
        {
          $match: {
            term: term,
            session: sessionName,
            status: { $in: ['approved', 'published'] },
            campus: req.session.campus
          }
        },
        {
          $group: {
            _id: '$studentID',
            studentName: { $first: '$studentName' },
            className: { $first: '$className' },
            averageScore: { $avg: '$total' }
          }
        },
        {
          $sort: { averageScore: -1 }
        },
        {
          $limit: 10
        }
      ]);
      
      res.json({ success: true, data: topStudents });
    } else if (type === 'overall') {
      const overallTopStudents = await Result.aggregate([
        {
          $match: {
            session: sessionName,
            status: { $in: ['approved', 'published'] }
          }
        },
        {
          $group: {
            _id: '$studentID',
            studentName: { $first: '$studentName' },
            className: { $first: '$className' },
            averageScore: { $avg: '$total' },
            totalSubjects: { $sum: 1 }
          }
        },
        {
          $match: {
            totalSubjects: { $gte: 3 }
          }
        },
        {
          $sort: { averageScore: -1 }
        },
        {
          $limit: 10
        }
      ]);
      
      res.json({ success: true, data: overallTopStudents });
    } else {
      res.status(400).json({ success: false, message: 'Invalid chart type' });
    }
  } catch (error) {
    console.error('Error getting chart data:', error);
    res.status(500).json({ success: false, message: 'Failed to get chart data' });
  }
});

module.exports = router;