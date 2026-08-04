const express = require('express');
const router = express.Router();
const Result = require('../models/Result');
const Student = require('../models/Student');
const Session = require('../models/Session');
const School = require('../models/School');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendResultNotification } = require('../utils/emailService');

// Result approval (for admin and officer) - UPDATED for new status system
router.get('/approve', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    
    // Build filter - show pending approval results first, then approved results for publishing
    const filter = { status: { $in: ['draft', 'sent', 'approved'] }, sentForApproval: true, campus: req.session.campus };
    let hasFilters = false;
    
    if (req.query.class) {
      filter.className = req.query.class;
      hasFilters = true;
    }
    if (req.query.term) {
      filter.term = req.query.term;
      hasFilters = true;
    }
    if (req.query.session) {
      filter.session = req.query.session;
      hasFilters = true;
    }
    
    // show nothing unless filters are set
    if (!hasFilters) {
      filter.className = '__none__';
    }
    
    // If no filters applied, don't show any results
    let results = [];
    let totalResults = 0;
    let totalPages = 0;
    
    if (hasFilters) {
      results = await Result.find(filter)
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limit);
      
      totalResults = await Result.countDocuments(filter);
      totalPages = Math.ceil(totalResults / limit);
    }
    
    // Get unique values for filters (including approved results that are ready for publishing)
    const classes = await Result.distinct('className', { status: { $in: ['draft', 'sent', 'approved'] }, sentForApproval: true, campus: req.session.campus });
    const terms = await Result.distinct('term', { status: { $in: ['draft', 'sent', 'approved'] }, sentForApproval: true, campus: req.session.campus });
    const sessions = await Result.distinct('session', { status: { $in: ['draft', 'sent', 'approved'] }, sentForApproval: true, campus: req.session.campus });

    const canApprove = results.some(result => ['draft', 'sent'].includes(result.status) && result.sentForApproval);
    const canPublish = results.some(result => result.status === 'approved' || result.status === 'published');
    
    res.render('pages/result/approve', {
      title: 'Approve Results',
      results,
      classes,
      terms,
      sessions,
      currentPage: page,
      totalPages,
      query: req.query,
      hasFilters,
      canApprove,
      canPublish
    });
  } catch (error) {
    console.error('Error loading results for approval:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load results', error });
  }
});

// Approve single result - UPDATED WITH EMAIL NOTIFICATION
router.post('/approve/:id', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const user = req.session.user;
    const result = await Result.findById(req.params.id);
    
    if (!result) {
      return res.status(404).json({ success: false, message: 'Result not found' });
    }
    
    if (result.status !== 'draft' || !result.sentForApproval) {
      return res.status(400).json({ success: false, message: 'Result is not ready for approval' });
    }
    
    result.status = 'approved';
    result.approvedBy = user.email;
    result.approvedAt = new Date();
    
    await result.save();
    
    // Calculate positions for the class after approval
    await Result.calculatePositions(result.className, result.term, result.session, req.session.campus);
    
    // Send email notification to parent
    try {
      const student = await Student.findOne({ studentID: result.studentID, campus: req.session.campus });
      const school = await School.findOne({ campus: req.session.campus });
      
      if (student && student.parentEmail) {
        // Get all approved results for this student for the same term and session
        const allResults = await Result.find({
          studentID: result.studentID,
          term: result.term,
          session: result.session,
          status: 'approved',
          campus: req.session.campus
        }).sort({ subject: 1 });
        
        const emailResult = await sendResultNotification(
          student, 
          allResults, 
          school, 
          result.term, 
          result.session
        );
        
        if (emailResult.success) {
          console.log('Email notification sent successfully:', emailResult.message);
        } else {
          console.log('Email notification failed:', emailResult.message);
        }
      }
    } catch (emailError) {
      console.error('Error sending email notification:', emailError);
      // Don't fail the approval if email fails
    }
    
    res.json({ success: true, message: 'Result approved successfully' });
  } catch (error) {
    console.error('Error approving result:', error);
    res.status(500).json({ success: false, message: 'Failed to approve result' });
  }
});

// Approve multiple results - UPDATED WITH EMAIL NOTIFICATIONS
router.post('/approve-multiple', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const user = req.session.user;
    const { resultIds } = req.body;
    
    if (!resultIds || resultIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No results selected' });
    }
    
    const results = await Result.find({ 
      _id: { $in: resultIds },
      status: 'draft',
      sentForApproval: true,
      campus: req.session.campus
    });
    
    if (results.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid results found for approval' });
    }
    
    await Result.updateMany(
      { 
        _id: { $in: resultIds },
        status: 'draft',
        sentForApproval: true,
        campus: req.session.campus
      },
      { 
        status: 'approved',
        approvedBy: user.email, 
        approvedAt: new Date() 
      }
    );
    
    // Calculate positions for affected classes
    const classTermSessions = new Set();
    results.forEach(result => {
      classTermSessions.add(`${result.className}|${result.term}|${result.session}`);
    });
    
    for (const classTermSession of classTermSessions) {
      const [className, term, session] = classTermSession.split('|');
      await Result.calculatePositions(className, term, session, req.session.campus);
    }
    
    // Send email notifications for each student
    try {
      const school = await School.findOne({ campus: req.session.campus });
      const studentNotifications = new Map();
      
      // Group results by student
      for (const result of results) {
        if (!studentNotifications.has(result.studentID)) {
          studentNotifications.set(result.studentID, {
            term: result.term,
            session: result.session,
            results: []
          });
        }
        studentNotifications.get(result.studentID).results.push(result);
      }
      
      // Send notifications
      for (const [studentID, data] of studentNotifications) {
        const student = await Student.findOne({ studentID, campus: req.session.campus });
        
        if (student && student.parentEmail) {
          // Get all approved results for this student for the same term and session
          const allResults = await Result.find({
            studentID: studentID,
            term: data.term,
            session: data.session,
            status: 'approved',
            campus: req.session.campus
          }).sort({ subject: 1 });
          
          const emailResult = await sendResultNotification(
            student, 
            allResults, 
            school, 
            data.term, 
            data.session
          );
          
          if (emailResult.success) {
            console.log(`Email sent to ${student.parentEmail} for ${student.fullName}`);
          } else {
            console.log(`Email failed for ${student.fullName}: ${emailResult.message}`);
          }
        }
      }
    } catch (emailError) {
      console.error('Error sending email notifications:', emailError);
      // Don't fail the approval if emails fail
    }
    
    res.json({ success: true, message: `${results.length} results approved successfully` });
  } catch (error) {
    console.error('Error approving multiple results:', error);
    res.status(500).json({ success: false, message: 'Failed to approve results' });
  }
});

// Publish Results for Class/Term - NEW ENDPOINT
router.post('/publish', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const className = req.body.className || req.body.class;
    const { term, session } = req.body;
    const user = req.session.user;

    if (!className || !term || !session) {
      return res.status(400).json({ success: false, message: 'Class, term, and session are required to publish results' });
    }

    const filter = {
      className,
      term,
      session,
      campus: req.session.campus,
      $or: [
        { status: { $in: ['draft', 'sent', 'approved'] } },
        { status: 'published' },
        { published: true }
      ]
    };

    const existingResults = await Result.find(filter);
    if (existingResults.length === 0) {
      return res.status(400).json({ success: false, message: 'No results found to publish' });
    }

    const updateResult = await Result.updateMany(filter, {
      $set: {
        status: 'published',
        published: true,
        publishedBy: user.email,
        publishedAt: new Date()
      }
    });

    const affectedCount = updateResult.modifiedCount || updateResult.matchedCount || existingResults.length;
    if (affectedCount === 0) {
      return res.status(400).json({ success: false, message: 'No results found to publish' });
    }

    // Recalculate positions after publishing
    await Result.calculatePositions(className, term, session, req.session.campus);

    // Send email notifications to parents
    try {
      const students = await Student.find({ currentClass: className, currentSession: session, campus: req.session.campus });
      const school = await School.findOne({ campus: req.session.campus });

      for (const student of students) {
        const studentResults = await Result.find({
          studentID: student.studentID,
          className,
          term,
          session,
          status: 'published',
          campus: req.session.campus
        });

        if (studentResults.length > 0) {
          await sendResultNotification(student, studentResults, school, term, session);
        }
      }
    } catch (emailError) {
      console.error('Error sending result notifications:', emailError);
      // Don't fail the publish if email fails
    }

    res.json({
      success: true,
      message: `Results published for ${className} - ${term}, ${session} and notifications sent to parents`
    });
  } catch (error) {
    console.error('Error publishing results:', error);
    res.status(500).json({ success: false, message: 'Failed to publish results' });
  }
});

// View published results - UPDATED
router.get('/published', requireAuth, requireRole(['admin', 'officer']), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    
    const filter = { status: { $in: ['approved', 'published'] }, campus: req.session.campus };
    if (req.query.class) filter.className = req.query.class;
    if (req.query.subject) filter.subject = req.query.subject;
    if (req.query.term) filter.term = req.query.term;
    if (req.query.session) filter.session = req.query.session;
    
    const results = await Result.find(filter)
      .sort({ approvedAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalResults = await Result.countDocuments(filter);
    const totalPages = Math.ceil(totalResults / limit);

    const publishedClasses = await Result.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$className',
          publishedStudentIds: { $addToSet: '$studentID' },
          publishedRecords: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const campus = req.session.campus;
    const classSummaries = await Promise.all(
      publishedClasses.map(async (item) => {
        const totalStudents = await Student.countDocuments({
          currentClass: item._id,
          campus,
          isActive: true
        });
        const publishedStudents = new Set(item.publishedStudentIds.filter(Boolean)).size;

        return {
          className: item._id,
          publishedStudents,
          totalStudents,
          percentage: totalStudents > 0 ? Math.round((publishedStudents / totalStudents) * 100) : 0
        };
      })
    );
    
    const classes = await Result.distinct('className', { status: { $in: ['approved', 'published'] }, campus: req.session.campus });
    const subjects = await Result.distinct('subject', { status: { $in: ['approved', 'published'] }, campus: req.session.campus });
    const terms = await Result.distinct('term', { status: { $in: ['approved', 'published'] }, campus: req.session.campus });
    const sessions = await Result.distinct('session', { status: { $in: ['approved', 'published'] }, campus: req.session.campus });
    
    res.render('pages/result/published', {
      title: 'Published Results',
      results,
      publishedClasses: classSummaries,
      classes,
      subjects,
      terms,
      sessions,
      currentPage: page,
      totalPages,
      query: req.query
    });
  } catch (error) {
    console.error('Error loading published results:', error);
    res.render('pages/error', { title: 'Error', message: 'Unable to load results', error });
  }
});

// Unpublish result (for admin only) - UPDATED
router.post('/unpublish/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await Result.findById(req.params.id);
    
    if (!result) {
      return res.status(404).json({ success: false, message: 'Result not found' });
    }
    
    if (result.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Result is not approved' });
    }
    
    result.status = 'sent';
    result.approvedBy = null;
    result.approvedAt = null;
    result.publishedBy = null;
    result.publishedAt = null;
    result.position = null;
    
    await result.save();
    
    // Recalculate positions for the class
    await Result.calculatePositions(result.className, result.term, result.session, req.session.campus);
    
    res.json({ success: true, message: 'Result unpublished successfully' });
  } catch (error) {
    console.error('Error unpublishing result:', error);
    res.status(500).json({ success: false, message: 'Failed to unpublish result' });
  }
});

module.exports = router;