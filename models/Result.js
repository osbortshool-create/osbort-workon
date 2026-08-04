const mongoose = require('mongoose');
const { getGradeInfo } = require('../utils/classLevel');

const resultSchema = new mongoose.Schema({
  studentID: { type: String },
  studentRef: { type: String },
  studentName: String,
  className: String,
  subject: String,
  term: String,
  session: String,
  ca1: { type: Number, default: 0 },
  ca2: { type: Number, default: 0 },
  exam: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  grade: String,
  remark: String,
  position: Number,
  subjectPosition: Number,
  status: { type: String, enum: ['draft', 'sent', 'approved', 'published'], default: 'draft' },
  sentForApproval: { type: Boolean, default: false },
  sentAt: Date,
  approvedBy: String,
  approvedAt: Date,
  publishedBy: String,
  publishedAt: Date,
  published: { type: Boolean, default: false },
  enteredBy: String,
  enteredAt: { type: Date, default: Date.now },
  campus: { type: String, default: 'Lagos' }
}, { timestamps: true });

resultSchema.pre('save', function (next) {
  const ca = Number(this.ca1 || 0);
  const exam = Number(this.exam || 0);
  this.total = ca + exam;
  const gradeInfo = getGradeInfo(this.total, this.className);
  this.grade = gradeInfo.grade;
  this.remark = gradeInfo.remark;
  next();
});

resultSchema.statics.calculatePositions = async function (className, term, session, campus) {
  try {
    const filter = { className, term, session, status: { $in: ['approved', 'published'] } };
    if (campus) filter.campus = campus;

    const results = await this.find(filter);
    const studentTotals = {};
    results.forEach(r => {
      if (!studentTotals[r.studentID]) studentTotals[r.studentID] = 0;
      studentTotals[r.studentID] += r.total;
    });

    const sorted = Object.entries(studentTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([sid], idx) => ({ studentID: sid, position: idx + 1 }));

    for (const { studentID, position } of sorted) {
      await this.updateMany({ studentID, className, term, session }, { position });
    }
  } catch (e) {
    console.error('calculatePositions error:', e.message);
  }
};

module.exports = mongoose.model('Result', resultSchema);
