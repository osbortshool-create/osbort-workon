const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  targetAudience: [{ type: String, enum: ['all', 'students', 'teachers', 'parents'] }],
  isActive: { type: Boolean, default: true },
  createdBy: String,
  campus: { type: String, default: 'Lagos' }
}, { timestamps: true });

module.exports = mongoose.model('Announcement', announcementSchema);
