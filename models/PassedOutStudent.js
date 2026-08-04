const mongoose = require('mongoose');

const passedOutStudentSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  studentID: String,
  gender: String,
  dateOfBirth: Date,
  parentPhone: String,
  parentEmail: String,
  address: String,
  passportURL: String,
  passedOutFromClass: String,
  passedOutFromSession: String,
  passedOutYear: Number,
  overallAverage: Number,
  archivedSessions: [mongoose.Schema.Types.Mixed],
  admissionDate: Date,
  passedOutDate: { type: Date, default: Date.now },
  campus: { type: String, default: 'Lagos' }
}, { timestamps: true });

module.exports = mongoose.model('PassedOutStudent', passedOutStudentSchema);
