const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const resultTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  studentID: { type: String, required: true },
  studentName: String,
  className: String,
  session: String,
  term: String,
  campus: { type: String, default: 'Lagos' },
  isActive: { type: Boolean, default: true },
  expiresAt: Date,
  usedAt: Date,
  generatedBy: String,
  regeneratedBy: [mongoose.Schema.Types.Mixed]
}, { timestamps: true });

resultTokenSchema.statics.generateUniqueToken = async function () {
  let token;
  let exists = true;
  while (exists) {
    token = uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase();
    exists = await this.findOne({ token });
  }
  return token;
};

resultTokenSchema.statics.validateToken = async function (token, studentID, session, term, campus) {
  const likelyMatches = [
    { token, studentID, session, term, campus },
    { token, studentID, session, campus },
    { token, studentID, term, campus },
    { token, studentID, campus }
  ];

  let record = null;
  for (const filter of likelyMatches) {
    record = await this.findOne(filter);
    if (record) break;
  }

  if (!record) return { valid: false, message: 'Invalid or inactive token' };
  if (record.expiresAt && record.expiresAt < new Date()) {
    return { valid: false, message: 'Token has expired' };
  }

  if (!record.isActive) {
    record.isActive = true;
    record.usedAt = null;
    await record.save();
  }

  return { valid: true, record };
};

module.exports = mongoose.model('ResultToken', resultTokenSchema);
