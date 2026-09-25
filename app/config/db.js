const mongoose = require('mongoose');


const connectDB = async () => {
    try {
        const uri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rupakar').trim();
        const conn = await mongoose.connect(uri);
        console.log(`MongoDB connected: host=${mongoose.connection.host}, database=${mongoose.connection.name}`);
        return conn;
    } catch (err) {
        console.error('MongoDB connection error:', err);
    }
};

module.exports = connectDB;
