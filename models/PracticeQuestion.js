const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  isCorrect: { type: Boolean, default: false }
}, { _id: false });

const practiceQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [optionSchema],
  correctAnswer: String,
  targetClass: { type: String, required: true },
  subject: { type: String, required: true },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' },
  isActive: { type: Boolean, default: true },
  createdBy: String,
  campus: { type: String, default: 'Lagos' }
}, { timestamps: true });

module.exports = mongoose.model('PracticeQuestion', practiceQuestionSchema);
