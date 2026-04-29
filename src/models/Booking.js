const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const bookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    default: () => `VHC${Date.now()}${Math.floor(Math.random() * 1000)}`,
    unique: true
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
  serviceCategory: {
    type: String,
    required: true
  },
  serviceDate: {
    type: Date,
    required: true
  },
  duration: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true
  },
  startTime: String,
  endTime: String,
  address: {
    type: String,
    required: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: [Number]
  },
  specialInstructions: String,
  totalAmount: {
    type: Number,
    required: true
  },
  commissionAmount: {
    type: Number,
    required: true
  },
  workerEarnings: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'disputed'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded', 'failed'],
    default: 'pending'
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  rating: {
    clientRating: {
      type: Number,
      min: 1,
      max: 5
    },
    workerRating: {
      type: Number,
      min: 1,
      max: 5
    },
    clientReview: String,
    workerReview: String
  },
  timeline: [{
    status: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    note: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  cancellationReason: String,
  cancelledBy: {
    type: String,
    enum: ['client', 'worker', 'admin']
  }
}, {
  timestamps: true
});

// Create index for queries
bookingSchema.index({ clientId: 1, createdAt: -1 });
bookingSchema.index({ workerId: 1, createdAt: -1 });
bookingSchema.index({ serviceDate: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ location: '2dsphere' });

// Pre-save middleware to add timeline entry
bookingSchema.pre('save', function(next) {
  if (this.isNew) {
    this.timeline.push({
      status: 'pending',
      timestamp: new Date(),
      note: 'Booking created'
    });
  }
  next();
});

// Method to update booking status
bookingSchema.methods.updateStatus = async function(newStatus, userId, note = '') {
  const oldStatus = this.status;
  this.status = newStatus;
  
  this.timeline.push({
    status: newStatus,
    timestamp: new Date(),
    note: note || `Status changed from ${oldStatus} to ${newStatus}`,
    updatedBy: userId
  });
  
  await this.save();
  
  // Emit socket event if global function exists
  if (global.emitBookingUpdate) {
    global.emitBookingUpdate(this._id, this.workerId, this.clientId, newStatus);
  }
  
  return this;
};

module.exports = mongoose.model('Booking', bookingSchema);