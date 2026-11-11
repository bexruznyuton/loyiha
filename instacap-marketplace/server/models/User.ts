import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  telegramId: number;
  firstName: string;
  lastName: string;
  username: string;
  photoUrl: string;
  language: string;
  surveyCompleted: boolean;
  createdAt: Date;
  lastSeen: Date;
}

const UserSchema = new Schema<IUser>({
  telegramId: { type: Number, required: true, unique: true, index: true },
  firstName: { type: String, required: true },
  lastName: { type: String, default: '' },
  username: { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  language: { type: String, default: 'uz' },
  surveyCompleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
});

export const User = mongoose.model<IUser>('User', UserSchema);
