const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
  subjectName: { type: String, required: true },
  subjectCode: String,
  isCore: { type: Boolean, default: false }
}, { _id: false });

const sectionSchema = new mongoose.Schema({
  sectionName: { type: String, default: 'A' }
}, { _id: false });

const classSchema = new mongoose.Schema({
  className: { type: String, required: true },
  level: String,
  classTeacher: String,
  sections: [sectionSchema],
  assignedSubjects: [subjectSchema],
  isActive: { type: Boolean, default: true },
  campus: { type: String, default: 'Lagos' }
}, { timestamps: true });

classSchema.statics.getAllSubjects = async function () {
  const classes = await this.find({ isActive: true });
  const subjectSet = new Set();
  classes.forEach(c => {
    (c.assignedSubjects || []).forEach(s => subjectSet.add(s.subjectName));
  });
  return Array.from(subjectSet).sort();
};

module.exports = mongoose.model('Class', classSchema);
