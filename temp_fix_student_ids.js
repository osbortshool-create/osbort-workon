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
      { $or: [{ studentID: '' }, { studentID: ' ' }, { studentID: { $exists: false } }] },
      { $set: { studentID: null } }
    );

    console.log('Updated', res.modifiedCount);

    const indexes = await Student.collection.indexes();
    const oldIndex = indexes.find((idx) => idx.name === 'studentID_1_campus_1');

    if (oldIndex) {
      await Student.collection.dropIndex(oldIndex.name);
      console.log('Dropped index', oldIndex.name);
    }

    await Student.syncIndexes();
    console.log('Recreated indexes');

    const currentIndexes = await Student.collection.indexes();
    console.log(JSON.stringify(currentIndexes, null, 2));
  } catch (error) {
    console.error(error.message);
  } finally {
    await mongoose.disconnect();
  }
})();
