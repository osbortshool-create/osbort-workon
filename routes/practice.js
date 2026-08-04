const express = require('express');
const router = express.Router();
const PracticeQuestion = require('../models/PracticeQuestion');
const Class = require('../models/Class');
const { requireAuth, requireRole } = require('../middleware/auth');

// All practice routes require authentication
router.use(requireAuth);

// Admin routes for managing practice questions
router.get('/admin/post-practice-question', requireRole('admin'), async (req, res) => {
  try {
    const classes = await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 });
    const subjects = await Class.getAllSubjects();
    
    res.render('pages/admin/post-practice-question', {
      title: 'Post Practice Question',
      classes,
      subjects
    });
  } catch (error) {
    console.error('Error loading post practice question page:', error);
    res.render('pages/error', { 
      title: 'Error', 
      message: 'Unable to load page', 
      error 
    });
  }
});

router.post('/admin/post-practice-question', requireRole('admin'), async (req, res) => {
  try {
    const { question, option1, option2, option3, option4, correctAnswer, targetClass, subject, difficulty } = req.body;
    
    // Validate required fields
    if (!question || !option1 || !option2 || !option3 || !option4 || !correctAnswer || !targetClass || !subject) {
      return res.render('pages/admin/post-practice-question', {
        title: 'Post Practice Question',
        error: 'All fields are required',
        classes: await Class.find({ isActive: true, campus: req.session.campus }).sort({ className: 1 }),
        subjects: await Class.getAllSubjects()
      });
    }
    
    // Create options array
    const options = [
      { text: option1, isCorrect: correctAnswer === 'option1' },
      { text: option2, isCorrect: correctAnswer === 'option2' },
      { text: option3, isCorrect: correctAnswer === 'option3' },
      { text: option4, isCorrect: correctAnswer === 'option4' }
    ];
    
    // Get correct answer text
    const correctAnswerText = req.body[correctAnswer];
    
    const practiceQuestion = new PracticeQuestion({
      question,
      options,
      correctAnswer: correctAnswerText,
      targetClass,
      subject,
      difficulty: difficulty || 'Medium',
      createdBy: req.session.user.email,
      campus: req.session.campus
    });
    
    await practiceQuestion.save();
    
    res.redirect('/admin/post-practice-question?success=Practice question posted successfully');
  } catch (error) {
    console.error('Error posting practice question:', error);
    res.render('pages/admin/post-practice-question', {
      title: 'Post Practice Question',
      error: 'Failed to post practice question',
      classes: await Class.find({ isActive: true }).sort({ className: 1 }),
      subjects: await Class.getAllSubjects()
    });
  }
});

// Admin view all practice questions
router.get('/admin/practice-questions', requireRole('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    
    const filter = { isActive: true, campus: req.session.campus };
    if (req.query.class) filter.targetClass = req.query.class;
    if (req.query.subject) filter.subject = req.query.subject;
    
    const questions = await PracticeQuestion.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalQuestions = await PracticeQuestion.countDocuments(filter);
    const totalPages = Math.ceil(totalQuestions / limit);
    
    const classes = await PracticeQuestion.distinct('targetClass');
    const subjects = await PracticeQuestion.distinct('subject');
    
    res.render('pages/admin/practice-questions', {
      title: 'Manage Practice Questions',
      questions,
      classes,
      subjects,
      currentPage: page,
      totalPages,
      query: req.query
    });
  } catch (error) {
    console.error('Error loading practice questions:', error);
    res.render('pages/error', { 
      title: 'Error', 
      message: 'Unable to load practice questions', 
      error 
    });
  }
});

// Student practice zone
router.get('/student/practice', requireRole('student'), async (req, res) => {
  try {
    const user = req.session.user;
    const studentClass = user.currentClass;
    
    const questions = await PracticeQuestion.find({ targetClass: studentClass, isActive: true, campus: req.session.campus }).sort({ createdAt: -1 });
    
    // Group questions by subject
    const questionsBySubject = questions.reduce((acc, question) => {
      if (!acc[question.subject]) {
        acc[question.subject] = [];
      }
      acc[question.subject].push(question);
      return acc;
    }, {});
    
    res.render('pages/student/practice', {
      title: 'Smart Revision - Practice Zone',
      questionsBySubject,
      studentClass
    });
  } catch (error) {
    console.error('Error loading practice zone:', error);
    res.render('pages/error', { 
      title: 'Error', 
      message: 'Unable to load practice zone', 
      error 
    });
  }
});

// API endpoint to get questions for a subject
router.get('/api/practice-questions/:subject', requireRole('student'), async (req, res) => {
  try {
    const user = req.session.user;
    const studentClass = user.currentClass;
    const subject = req.params.subject;
    
    const questions = await PracticeQuestion.find({
      targetClass: studentClass,
      subject: subject,
      isActive: true,
      campus: req.session.campus
    }).sort({ createdAt: -1 });
    
    res.json({ success: true, questions });
  } catch (error) {
    console.error('Error getting practice questions:', error);
    res.status(500).json({ success: false, message: 'Failed to get questions' });
  }
});

// Delete practice question (admin only)
router.post('/admin/practice-questions/delete/:id', requireRole('admin'), async (req, res) => {
  try {
    await PracticeQuestion.findByIdAndUpdate(req.params.id, { isActive: false });
    res.redirect('/admin/practice-questions?success=Question deleted successfully');
  } catch (error) {
    console.error('Error deleting practice question:', error);
    res.redirect('/admin/practice-questions?error=Failed to delete question');
  }
});

module.exports = router;