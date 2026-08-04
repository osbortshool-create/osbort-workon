const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  sessionName: { type: String, required: true },
  isActive: { type: Boolean, default: false },
  currentTerm: { type: String, enum: ['First Term', 'Second Term', 'Third Term'], default: 'First Term' },
  startDate: Date,
  endDate: Date,
  firstTermStart: Date,
  firstTermEnd: Date,
  firstTermLocked: { type: Boolean, default: true },
  secondTermStart: Date,
  secondTermEnd: Date,
  secondTermLocked: { type: Boolean, default: true },
  thirdTermStart: Date,
  thirdTermEnd: Date,
  thirdTermLocked: { type: Boolean, default: true },
  campus: { type: String, default: 'Lagos' }
}, { timestamps: true });

sessionSchema.methods.updateCurrentTermBasedOnDate = async function () {
  const now = new Date();
  const inRange = (start, end) => start && end && now >= start && now <= end;

  if (inRange(this.firstTermStart, this.firstTermEnd)) {
    this.currentTerm = 'First Term';
  } else if (inRange(this.secondTermStart, this.secondTermEnd)) {
    this.currentTerm = 'Second Term';
  } else if (inRange(this.thirdTermStart, this.thirdTermEnd)) {
    this.currentTerm = 'Third Term';
  }
  // save only if modified
  if (this.isModified()) await this.save();
};

sessionSchema.statics.getActiveSession = async function (campus) {
  const filter = { isActive: true };
  if (campus) filter.campus = campus;
  let session = await this.findOne(filter);
  if (!session && campus) {
    session = await this.findOne({ isActive: true });
  }
  return session;
};

module.exports = mongoose.model('Session', sessionSchema);
