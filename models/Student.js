const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

function normalizeContactValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value === undefined || value === null ? null : value;
}

function buildLoginLookupValues(identifier) {
  if (typeof identifier !== 'string') return [];

  const raw = identifier.trim();
  if (!raw) return [];

  const variants = new Set();
  const lower = raw.toLowerCase();
  const compact = raw.replace(/\s+/g, '');
  const digitsOnly = raw.replace(/\D/g, '');

  variants.add(raw);
  variants.add(lower);
  variants.add(compact);
  variants.add(digitsOnly);

  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    variants.add(`234${digitsOnly.slice(1)}`);
  }

  if (digitsOnly.length === 10) {
    variants.add(`234${digitsOnly}`);
  }

  return Array.from(variants).filter(Boolean);
}

const archivedSessionSchema = new mongoose.Schema({
  sessionName: String,
  className: String,
  promoted: { type: Boolean, default: false },
  promotionDate: Date
}, { _id: false });

const studentSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  studentID: { type: String, default: null },
  password: { type: String, required: true },
  gender: String,
  dateOfBirth: Date,
  parentPhone: { type: String, default: null },
  parentEmail: { type: String, default: null },
  address: String,
  currentClass: String,
  section: String,
  currentSession: String,
  passportURL: { type: String, default: '/images/default-avatar.png' },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
  admissionDate: { type: Date, default: Date.now },
  archivedSessions: [archivedSessionSchema],
  campus: { type: String, default: 'Lagos' }
}, { timestamps: true });

studentSchema.index({ studentID: 1, campus: 1 }, { unique: true, sparse: true });

studentSchema.pre('save', async function (next) {
  if (!this.studentID || !String(this.studentID).trim()) {
    const base = (this._id ? this._id.toString() : Date.now().toString()).slice(-6).toUpperCase();
    const Student = mongoose.models.Student || this.constructor;
    let candidate = `STU${base}`;
    let counter = 1;

    while (await Student.exists({ studentID: candidate, campus: this.campus || 'Lagos' })) {
      candidate = `STU${base}${counter}`;
      counter += 1;
    }

    this.studentID = candidate;
  }

  if (this.isModified('parentPhone')) {
    this.parentPhone = normalizeContactValue(this.parentPhone);
  }
  if (this.isModified('parentEmail')) {
    this.parentEmail = normalizeContactValue(this.parentEmail);
  }

  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

studentSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();
  if (update && typeof update === 'object') {
    if (Object.prototype.hasOwnProperty.call(update, 'parentPhone')) {
      update.parentPhone = normalizeContactValue(update.parentPhone);
    }
    if (Object.prototype.hasOwnProperty.call(update, 'parentEmail')) {
      update.parentEmail = normalizeContactValue(update.parentEmail);
    }
  }
  next();
});

studentSchema.pre('updateOne', async function (next) {
  const update = this.getUpdate();
  if (update && typeof update === 'object') {
    if (Object.prototype.hasOwnProperty.call(update, 'parentPhone')) {
      update.parentPhone = normalizeContactValue(update.parentPhone);
    }
    if (Object.prototype.hasOwnProperty.call(update, 'parentEmail')) {
      update.parentEmail = normalizeContactValue(update.parentEmail);
    }
  }
  next();
});

studentSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.password) return false;

  if (typeof this.password === 'string' && this.password.startsWith('$2')) {
    return bcrypt.compare(candidatePassword, this.password);
  }

  return String(this.password) === String(candidatePassword);
};

studentSchema.statics.buildLoginLookupValues = function (identifier) {
  return buildLoginLookupValues(identifier);
};

studentSchema.statics.ensureMissingStudentIds = async function (campus = null) {
  const filter = {
    $or: [
      { studentID: '' },
      { studentID: null },
      { studentID: { $exists: false } }
    ]
  };

  if (campus) {
    filter.campus = campus;
  }

  const students = await this.find(filter).sort({ createdAt: 1 });
  let fixed = 0;

  for (const student of students) {
    const doc = await this.findById(student._id);
    if (!doc || (doc.studentID && String(doc.studentID).trim())) continue;

    doc.studentID = undefined;
    await doc.save();
    fixed += 1;
  }

  return fixed;
};

module.exports = mongoose.model('Student', studentSchema);
