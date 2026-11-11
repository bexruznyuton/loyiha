import mongoose, { Schema, Document } from 'mongoose';

export interface ISurveyResponse extends Document {
  telegramId: number;
  firstName: string;
  pollIndex: number;
  question: string;
  selectedOption: number;
  selectedOptionText: string;
  pollId: string;
  answeredAt: Date;
}

const SurveyResponseSchema = new Schema<ISurveyResponse>({
  telegramId: { type: Number, required: true, index: true },
  firstName: { type: String, default: '' },
  pollIndex: { type: Number, required: true },
  question: { type: String, required: true },
  selectedOption: { type: Number, required: true },
  selectedOptionText: { type: String, required: true },
  pollId: { type: String, required: true, index: true },
  answeredAt: { type: Date, default: Date.now },
});

// Har bir user har bir savolga faqat bitta javob berishi mumkin
SurveyResponseSchema.index({ telegramId: 1, pollIndex: 1 }, { unique: true });

export const SurveyResponse = mongoose.model<ISurveyResponse>(
  'SurveyResponse',
  SurveyResponseSchema
);
