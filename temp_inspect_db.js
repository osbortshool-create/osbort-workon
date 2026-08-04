require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    const Student = require('./models/Student');
    const Result = require('./models/Result');

    const student = await Student.findOne({
      $or: [
        { studentID: 'STUD2A4B1' },
        { fullName: /Abdulrazaq Abdulfatai/i }
      ]
    }).lean();

    console.log('STUDENT');
    console.log(JSON.stringify(student, null, 2));

    const results = await Result.find({
      $or: [
        { studentID: 'STUD2A4B1' },
        { studentName: /Abdulrazaq Abdulfatai/i }
      ]
    }).sort({ createdAt: -1 }).lean();

    console.log('RESULTS');
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
