import mongoose from 'mongoose';
import { env } from '../config/env.js';

export async function connectMongo() {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 50,
      minPoolSize: 5,
    });
    console.log(`MongoDB connected: host=${mongoose.connection.host}, database=${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (error) {
    console.error('MongoDB connection failed', error);
    throw error;
  }
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
