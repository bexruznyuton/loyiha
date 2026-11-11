import mongoose, { Schema, Document } from 'mongoose';

export interface ICaptionHistory extends Document {
  userId: mongoose.Types.ObjectId;
  telegramId: number;
  url: string;
  caption: string;
  createdAt: Date;
}

const CaptionHistorySchema = new Schema<ICaptionHistory>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  telegramId: { type: Number, required: true, index: true },
  url: { type: String, required: true },
  caption: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// User bo'yicha saralangan so'rovlar uchun index
CaptionHistorySchema.index({ userId: 1, createdAt: -1 });

export const CaptionHistory = mongoose.model<ICaptionHistory>('CaptionHistory', CaptionHistorySchema);
