import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    avatar: {
      type: String,
      default: '',
    },
    googleId: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },
    preferences: {
      type: Object,
      default: {},
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    role: {
      type: String,
      enum: ['customer', 'vendor', 'admin'],
      default: 'customer',
    },
    verificationStatus: {
      type: String,
      enum: ['PENDING_VERIFICATION', 'VERIFIED'],
      default: 'PENDING_VERIFICATION',
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    otpResendAvailableAt: {
      type: Date,
      default: null,
    },
    pendingExpiresAt: {
      type: Date,
      default: null,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index(
  { pendingExpiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: {
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
    },
  },
);

userSchema.methods.comparePassword = async function comparePassword(password) {
  return bcrypt.compare(password, this.password);
};

export const User = model('User', userSchema);
