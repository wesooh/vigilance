const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const paymentSchema = new mongoose.Schema({
  paymentId: {
    type: String,
    default: () => `PAY${Date.now()}${Math.floor(Math.random() * 10000)}`,
    unique: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  commission: {
    type: Number,
    required: true
  },
  workerPayout: {
    type: Number,
    required: true
  },
  mpesaCode: String,
  mpesaResponse: mongoose.Schema.Types.Mixed,
  paymentMethod: {
    type: String,
    enum: ['mpesa', 'card', 'cash', 'bank_transfer'],
    default: 'mpesa'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  payoutStatus: {
    type: String,
    enum: ['pending', 'processed', 'failed', 'on_hold'],
    default: 'pending'
  },
  payoutDate: Date,
  payoutMethod: {
    type: String,
    enum: ['mpesa', 'bank', 'cash'],
    default: 'mpesa'
  },
  transactionDetails: {
    mpesaReceiptNumber: String,
    transactionDate: Date,
    phoneNumber: String,
    resultCode: Number,
    resultDesc: String
  },
  refundDetails: {
    refundAmount: Number,
    refundDate: Date,
    refundReason: String,
    refundTransactionId: String
  }
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ bookingId: 1 });
paymentSchema.index({ clientId: 1, createdAt: -1 });
paymentSchema.index({ workerId: 1, payoutStatus: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ mpesaCode: 1 });

module.exports = mongoose.model('Payment', paymentSchema);