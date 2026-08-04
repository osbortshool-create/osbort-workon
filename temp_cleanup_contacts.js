const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    const Student = require('./models/Student');
    const res = await Student.updateMany(
      { $or: [{ parentPhone: '' }, { parentPhone: ' ' }, { parentEmail: '' }, { parentEmail: ' ' }] },
      { $set: { parentPhone: null, parentEmail: null } }
    );

    console.log('Normalized', res.modifiedCount);
  } catch (error) {
    console.error(error.message);
  } finally {
    await mongoose.disconnect();
  }
})();
