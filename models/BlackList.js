const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const tunnel = require('tunnel');
const url = require('url');

const mongoUri = process.env.MONGODB_URI;
const quotaguardStaticUrl = process.env.QUOTAGUARDSTATIC_URL;

const proxyOptions = url.parse(quotaguardStaticUrl);
const auth = proxyOptions.auth.split(':');

const connectDB = async () => {
    try {
        console.log(mongoUri);
        await mongoose.connect(`${mongoUri}`, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        });
        console.log('MongoDB connected');
      } catch (err) {
      console.error('Error connecting to MongoDB:', err.message);
      process.exit(1);
    }
  };

const blacklistSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, index: { expires: '1d' } },
});

const Blacklist = mongoose.model('Blacklist', blacklistSchema);
connectDB();

module.exports = Blacklist;