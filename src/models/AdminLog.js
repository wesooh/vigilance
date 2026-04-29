const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminName: String,
  action: {
    type: String,
    required: true
  },
  targetType: {
    type: String,
    enum: ['user', 'worker', 'booking', 'payment', 'chat', 'conversation', 'dispute'],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  description: String,
  metadata: {
    ipAddress: String,
    userAgent: String,
    changes: mongoose.Schema.Types.Mixed,
    previousState: mongoose.Schema.Types.Mixed,
    newState: mongoose.Schema.Types.Mixed
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info'
  }
}, {
  timestamps: true
});

// Indexes for admin logs
adminLogSchema.index({ adminId: 1, createdAt: -1 });
adminLogSchema.index({ action: 1, createdAt: -1 });
adminLogSchema.index({ targetType: 1, targetId: 1 });
adminLogSchema.index({ severity: 1, createdAt: -1 });

// Method to create log entry
adminLogSchema.statics.createLog = async function(adminId, adminName, action, targetType, targetId, description, metadata = {}, severity = 'info') {
  const log = new this({
    adminId,
    adminName,
    action,
    targetType,
    targetId,
    description,
    metadata,
    severity
  });
  
  await log.save();
  return log;
};

module.exports = mongoose.model('AdminLog', adminLogSchema);