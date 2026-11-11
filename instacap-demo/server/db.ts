import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/instacap';

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    // Server ishga tushsin, lekin DB yo'q bo'lsa warning bersin
    console.warn('⚠️  Server will run without database');
  }
}

export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    console.log('🛑 MongoDB disconnected');
  } catch (error) {
    console.error('Error disconnecting MongoDB:', error);
  }
}
