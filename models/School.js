const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  motto: { type: String, default: '' },
  address: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  website: { type: String, default: '' },
  logo: { type: String, default: '/images/default-logo.png' },
  mission: { type: String, default: '' },
  vision: { type: String, default: '' },
  about: { type: String, default: '' },
  principalName: { type: String, default: '' },
  principalMessage: { type: String, default: '' },
  accreditation: { type: String, default: '' },
  establishedYear: { type: Number, default: null },
  gallery: [String],
  campus: { type: String, default: 'Lagos' },
  signatureUrl: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('School', schoolSchema);
