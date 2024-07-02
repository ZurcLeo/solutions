// models/Blacklist.js
const mongoose = require('mongoose');

// Connect to MongoDB
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('MongoDB connected...');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err.message);
    process.exit(1);
  }
};

connectDB();

const blacklistSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, index: { expires: '1d' } },
});

module.exports = mongoose.model('Blacklist', blacklistSchema);