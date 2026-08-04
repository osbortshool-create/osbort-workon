const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    const Class = require('./models/Class');

    try {
      await Class.collection.dropIndex('className_1');
      console.log('Dropped global className index');
    } catch (error) {
      console.log('No global className index to drop');
    }

    try {
      await Class.collection.dropIndex('className_1_campus_1');
      console.log('Dropped compound className/campus index');
    } catch (error) {
      console.log('No compound className/campus index to drop');
    }

    await Class.collection.createIndex({ className: 1, campus: 1 }, { unique: true });
    console.log('Recreated campus-scoped unique class index');

    const indexes = await Class.collection.indexes();
    console.log(JSON.stringify(indexes, null, 2));
  } catch (error) {
    console.error(error.message);
  } finally {
    await mongoose.disconnect();
  }
})();
