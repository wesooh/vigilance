const User = require('../models/User');
const WorkerProfile = require('../models/WorkerProfile');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AdminLog = require('../models/AdminLog');
const Notification = require('../models/Notification');

// ==================== WORKER MANAGEMENT ====================

// Get pending workers for approval
exports.getPendingWorkers = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const workers = await WorkerProfile.find({ isApproved: false })
      .populate('userId', 'firstName lastName email phoneNumber idNumber idPhotoUrl createdAt')
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await WorkerProfile.countDocuments({ isApproved: false });
    
    res.status(200).json({
      success: true,
      data: workers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get pending workers error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Approve worker
exports.approveWorker = async (req, res) => {
  try {
    const { workerId } = req.params;
    const { notes } = req.body;
    
    const workerProfile = await WorkerProfile.findOne({ userId: workerId });
    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    
    workerProfile.isApproved = true;
    await workerProfile.save();
    
    // Update user status
    await User.findByIdAndUpdate(workerId, { isVerified: true });
    
    // Create notification for worker
    const notification = new Notification({
      userId: workerId,
      type: 'verification',
      title: 'Account Approved',
      message: 'Your account has been approved! You can now start accepting bookings.',
      priority: 'high'
    });
    await notification.save();
    
    // Log admin action
    await AdminLog.createLog(
      req.user._id,
      `${req.user.firstName} ${req.user.lastName}`,
      'approve_worker',
      'user',
      workerId,
      `Approved worker account with notes: ${notes || 'N/A'}`,
      { notes },
      'info'
    );
    
    res.status(200).json({
      success: true,
      message: 'Worker approved successfully'
    });
  } catch (error) {
    console.error('Approve worker error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Suspend worker
exports.suspendWorker = async (req, res) => {
  try {
    const { workerId } = req.params;
    const { reason } = req.body;
    
    await User.findByIdAndUpdate(workerId, { isActive: false });
    
    await WorkerProfile.findOneAndUpdate(
      { userId: workerId },
      { 'availability.onDuty': false, 'availability.status': 'offline' }
    );
    
    // Create notification
    const notification = new Notification({
      userId: workerId,
      type: 'system',
      title: 'Account Suspended',
      message: `Your account has been suspended. Reason: ${reason || 'Violation of terms'}. Contact support for more information.`,
      priority: 'high'
    });
    await notification.save();
    
    await AdminLog.createLog(
      req.user._id,
      `${req.user.firstName} ${req.user.lastName}`,
      'suspend_worker',
      'user',
      workerId,
      `Suspended worker account. Reason: ${reason}`,
      { reason },
      'warning'
    );
    
    res.status(200).json({
      success: true,
      message: 'Worker suspended successfully'
    });
  } catch (error) {
    console.error('Suspend worker error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get worker documents for verification
exports.getWorkerDocuments = async (req, res) => {
  try {
    const { workerId } = req.params;
    
    const workerProfile = await WorkerProfile.findOne({ userId: workerId })
      .populate('userId', 'firstName lastName email phoneNumber');
    
    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    
    res.status(200).json({
      success: true,
      data: {
        personalInfo: workerProfile.userId,
        documents: workerProfile.documents,
        categories: workerProfile.categories,
        skills: workerProfile.skills,
        workExperience: workerProfile.workExperience
      }
    });
  } catch (error) {
    console.error('Get worker documents error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== PAYMENT OVERVIEW ====================

// Get all payments (admin overview)
exports.getAllPayments = async (req, res) => {
  try {
    const { status, startDate, endDate, page = 1, limit = 50 } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const payments = await Payment.find(query)
      .populate('clientId', 'firstName lastName email phoneNumber')
      .populate('workerId', 'firstName lastName email phoneNumber')
      .populate('bookingId', 'bookingId serviceDate')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Payment.countDocuments(query);
    
    // Calculate totals
    const totals = await Payment.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          totalCommission: { $sum: '$commission' },
          totalPayouts: { $sum: '$workerPayout' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: payments,
      summary: totals[0] || { totalAmount: 0, totalCommission: 0, totalPayouts: 0, count: 0 },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all payments error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get today's payments
exports.getTodayPayments = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const payments = await Payment.find({
      createdAt: { $gte: today, $lt: tomorrow },
      status: 'completed'
    }).populate('clientId', 'firstName lastName')
      .populate('workerId', 'firstName lastName');
    
    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalCommission = payments.reduce((sum, p) => sum + p.commission, 0);
    
    res.status(200).json({
      success: true,
      data: {
        date: today,
        count: payments.length,
        totalAmount,
        totalCommission,
        payments
      }
    });
  } catch (error) {
    console.error('Get today payments error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get commission report
exports.getCommissionReport = async (req, res) => {
  try {
    const { period = 'monthly', year = new Date().getFullYear() } = req.query;
    
    let groupByFormat;
    if (period === 'daily') groupByFormat = '%Y-%m-%d';
    else if (period === 'weekly') groupByFormat = '%Y-%u';
    else groupByFormat = '%Y-%m';
    
    const report = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: {
            $gte: new Date(`${year}-01-01`),
            $lte: new Date(`${year}-12-31`)
          }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: groupByFormat, date: '$createdAt' }
          },
          totalAmount: { $sum: '$amount' },
          totalCommission: { $sum: '$commission' },
          totalPayouts: { $sum: '$workerPayout' },
          transactionCount: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: report,
      summary: {
        year,
        period,
        totalCommission: report.reduce((sum, r) => sum + r.totalCommission, 0),
        totalTransactions: report.reduce((sum, r) => sum + r.transactionCount, 0)
      }
    });
  } catch (error) {
    console.error('Get commission report error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get pending payouts
exports.getPendingPayouts = async (req, res) => {
  try {
    const pendingPayments = await Payment.find({
      status: 'completed',
      payoutStatus: 'pending'
    })
      .populate('workerId', 'firstName lastName email phoneNumber')
      .populate('bookingId', 'bookingId');
    
    const totalPendingAmount = pendingPayments.reduce((sum, p) => sum + p.workerPayout, 0);
    
    // Group by worker
    const byWorker = {};
    pendingPayments.forEach(payment => {
      const workerId = payment.workerId._id.toString();
      if (!byWorker[workerId]) {
        byWorker[workerId] = {
          worker: payment.workerId,
          totalAmount: 0,
          payments: []
        };
      }
      byWorker[workerId].totalAmount += payment.workerPayout;
      byWorker[workerId].payments.push(payment);
    });
    
    res.status(200).json({
      success: true,
      data: {
        totalPendingAmount,
        pendingCount: pendingPayments.length,
        workersPending: Object.values(byWorker),
        payments: pendingPayments
      }
    });
  } catch (error) {
    console.error('Get pending payouts error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Process payout for worker
exports.processPayout = async (req, res) => {
  try {
    const { workerId, amount } = req.body;
    
    const payments = await Payment.find({
      workerId,
      status: 'completed',
      payoutStatus: 'pending'
    });
    
    let totalAmount = 0;
    for (const payment of payments) {
      totalAmount += payment.workerPayout;
    }
    
    if (amount && amount < totalAmount) {
      // Process partial payout
      let remainingAmount = amount;
      for (const payment of payments) {
        if (remainingAmount <= 0) break;
        if (payment.workerPayout <= remainingAmount) {
          payment.payoutStatus = 'processed';
          payment.payoutDate = new Date();
          remainingAmount -= payment.workerPayout;
        } else {
          // Partial payment for this booking (would need more complex logic)
          break;
        }
        await payment.save();
      }
    } else {
      // Process full payout
      for (const payment of payments) {
        payment.payoutStatus = 'processed';
        payment.payoutDate = new Date();
        await payment.save();
      }
    }
    
    await AdminLog.createLog(
      req.user._id,
      `${req.user.firstName} ${req.user.lastName}`,
      'process_payout',
      'payment',
      null,
      `Processed payout for worker ${workerId} of amount ${amount || totalAmount}`,
      { workerId, amount, totalProcessed: totalAmount },
      'info'
    );
    
    res.status(200).json({
      success: true,
      message: 'Payout processed successfully',
      data: { processedCount: payments.length }
    });
  } catch (error) {
    console.error('Process payout error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== COMMUNICATION OVERVIEW ====================

// Get all conversations overview (admin monitoring)
exports.getCommunicationsOverview = async (req, res) => {
  try {
    const { startDate, endDate, status = 'all', page = 1, limit = 50 } = req.query;
    
    const query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    if (status !== 'all') query.isFlagged = status === 'flagged';
    
    const conversations = await Conversation.find(query)
      .populate('participants.userId', 'firstName lastName email phoneNumber role profilePicture')
      .populate('bookingId', 'bookingId status serviceDate')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Conversation.countDocuments(query);
    
    // Get message statistics
    const messageStats = await Message.aggregate([
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          avgDaily: { $avg: { $dayOfMonth: '$createdAt' } }
        }
      }
    ]);
    
    const flaggedCount = await Conversation.countDocuments({ isFlagged: true });
    
    // Get active conversations today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeToday = await Conversation.countDocuments({
      updatedAt: { $gte: today }
    });
    
    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalConversations: total,
          activeToday,
          flaggedConversations: flaggedCount,
          totalMessages: messageStats[0]?.totalMessages || 0
        },
        conversations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get communications overview error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get specific conversation details (admin view)
exports.getConversationDetails = async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const conversation = await Conversation.findById(conversationId)
      .populate('participants.userId', 'firstName lastName email phoneNumber role profilePicture')
      .populate('bookingId', 'bookingId status serviceDate totalAmount');
    
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    
    // Get all messages in conversation
    const messages = await Message.find({ conversationId })
      .populate('senderId', 'firstName lastName role')
      .populate('receiverId', 'firstName lastName role')
      .sort({ createdAt: 1 })
      .limit(500);
    
    // Log admin view
    await AdminLog.createLog(
      req.user._id,
      `${req.user.firstName} ${req.user.lastName}`,
      'view_conversation',
      'conversation',
      conversationId,
      'Admin viewed conversation details',
      { messageCount: messages.length },
      'info'
    );
    
    res.status(200).json({
      success: true,
      data: {
        conversation,
        messages,
        messageCount: messages.length
      }
    });
  } catch (error) {
    console.error('Get conversation details error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Search messages (admin)
exports.searchMessages = async (req, res) => {
  try {
    const { q, userId, startDate, endDate, page = 1, limit = 100 } = req.query;
    
    const query = {};
    
    if (q) {
      query.content = { $regex: q, $options: 'i' };
    }
    
    if (userId) {
      query.$or = [
        { senderId: userId },
        { receiverId: userId }
      ];
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const messages = await Message.find(query)
      .populate('senderId', 'firstName lastName email role')
      .populate('receiverId', 'firstName lastName email role')
      .populate('conversationId', 'participants')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Message.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Flag conversation for review
exports.flagConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { reason } = req.body;
    
    const conversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { isFlagged: true, flagReason: reason },
      { new: true }
    );
    
    await AdminLog.createLog(
      req.user._id,
      `${req.user.firstName} ${req.user.lastName}`,
      'flag_conversation',
      'conversation',
      conversationId,
      `Flagged conversation for review. Reason: ${reason}`,
      { reason },
      'warning'
    );
    
    res.status(200).json({
      success: true,
      message: 'Conversation flagged for review',
      data: conversation
    });
  } catch (error) {
    console.error('Flag conversation error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get message statistics report
exports.getMessageReport = async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    
    let groupByFormat;
    if (period === 'daily') groupByFormat = '%Y-%m-%d';
    else if (period === 'weekly') groupByFormat = '%Y-%u';
    else groupByFormat = '%Y-%m';
    
    const report = await Message.aggregate([
      {
        $group: {
          _id: {
            date: { $dateToString: { format: groupByFormat, date: '$createdAt' } },
            type: '$messageType'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          textMessages: {
            $sum: {
              $cond: [{ $eq: ['$_id.type', 'text'] }, '$count', 0]
            }
          },
          imageMessages: {
            $sum: {
              $cond: [{ $eq: ['$_id.type', 'image'] }, '$count', 0]
            }
          },
          totalMessages: { $sum: '$count' }
        }
      },
      { $sort: { '_id': -1 } },
      { $limit: 30 }
    ]);
    
    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Get message report error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ==================== ANALYTICS DASHBOARD ====================

// Get admin dashboard analytics
exports.getDashboardAnalytics = async (req, res) => {
  try {
    // User statistics
    const totalClients = await User.countDocuments({ role: 'client', isActive: true });
    const totalWorkers = await User.countDocuments({ role: 'worker', isActive: true });
    const pendingWorkers = await WorkerProfile.countDocuments({ isApproved: false });
    
    // Booking statistics
    const totalBookings = await Booking.countDocuments();
    const completedBookings = await Booking.countDocuments({ status: 'completed' });
    const pendingBookings = await Booking.countDocuments({ status: 'pending' });
    const inProgressBookings = await Booking.countDocuments({ status: 'in_progress' });
    const cancelledBookings = await Booking.countDocuments({ status: 'cancelled' });
    
    // Revenue statistics
    const revenueStats = await Payment.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$commission' },
          totalTransactions: { $sum: 1 },
          averageTransaction: { $avg: '$amount' },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);
    
    // Monthly revenue for chart
    const monthlyRevenue = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: {
            $gte: new Date(new Date().setMonth(new Date().getMonth() - 11))
          }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$commission' },
          transactions: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    // Recent bookings
    const recentBookings = await Booking.find()
      .populate('clientId', 'firstName lastName')
      .populate('workerId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Recent registrations
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('firstName lastName email role createdAt');
    
    res.status(200).json({
      success: true,
      data: {
        users: {
          totalClients,
          totalWorkers,
          pendingWorkers,
          totalUsers: totalClients + totalWorkers
        },
        bookings: {
          total: totalBookings,
          completed: completedBookings,
          pending: pendingBookings,
          inProgress: inProgressBookings,
          cancelled: cancelledBookings,
          completionRate: totalBookings > 0 ? (completedBookings / totalBookings * 100).toFixed(2) : 0
        },
        revenue: {
          total: revenueStats[0]?.totalRevenue || 0,
          totalTransactions: revenueStats[0]?.totalTransactions || 0,
          averageTransaction: revenueStats[0]?.averageTransaction || 0,
          totalVolume: revenueStats[0]?.totalAmount || 0
        },
        charts: {
          monthlyRevenue
        },
        recentActivity: {
          bookings: recentBookings,
          registrations: recentUsers
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard analytics error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get top performing workers
exports.getTopWorkers = async (req, res) => {
  try {
    const { limit = 10, sortBy = 'rating' } = req.query;
    
    let sortField = {};
    if (sortBy === 'rating') sortField = { averageRating: -1 };
    else if (sortBy === 'jobs') sortField = { totalJobsCompleted: -1 };
    else if (sortBy === 'earnings') sortField = { totalEarnings: -1 };
    
    const workers = await WorkerProfile.find({ isApproved: true })
      .populate('userId', 'firstName lastName profilePicture phoneNumber')
      .sort(sortField)
      .limit(parseInt(limit));
    
    res.status(200).json({
      success: true,
      data: workers
    });
  } catch (error) {
    console.error('Get top workers error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get popular service categories
exports.getPopularServices = async (req, res) => {
  try {
    const popular = await Booking.aggregate([
      {
        $group: {
          _id: '$serviceCategory',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          averagePrice: { $avg: '$totalAmount' }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    res.status(200).json({
      success: true,
      data: popular
    });
  } catch (error) {
    console.error('Get popular services error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get all disputes
exports.getDisputes = async (req, res) => {
  try {
    const disputes = await Booking.find({ status: 'disputed' })
      .populate('clientId', 'firstName lastName email phoneNumber')
      .populate('workerId', 'firstName lastName email phoneNumber')
      .sort({ updatedAt: -1 });
    
    res.status(200).json({
      success: true,
      data: disputes
    });
  } catch (error) {
    console.error('Get disputes error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Resolve dispute
exports.resolveDispute = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { resolution, action, notes } = req.body;
    
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    
    // Update booking status based on resolution
    if (action === 'refund_client') {
      booking.status = 'cancelled';
      booking.paymentStatus = 'refunded';
      
      // Process refund
      const payment = await Payment.findOne({ bookingId: booking._id });
      if (payment && payment.status === 'completed') {
        payment.status = 'refunded';
        payment.refundDetails = {
          refundAmount: payment.amount,
          refundDate: new Date(),
          refundReason: resolution
        };
        await payment.save();
      }
    } else if (action === 'pay_worker') {
      booking.status = 'completed';
      booking.paymentStatus = 'paid';
    } else if (action === 'split_payment') {
      booking.status = 'completed';
      // Handle partial payment logic
    }
    
    booking.timeline.push({
      status: 'resolved',
      timestamp: new Date(),
      note: `Dispute resolved: ${resolution}. ${notes}`,
      updatedBy: req.user._id
    });
    
    await booking.save();
    
    // Notify both parties
    await Notification.create({
      userId: booking.clientId,
      type: 'system',
      title: 'Dispute Resolved',
      message: `Your dispute for booking ${booking.bookingId} has been resolved. Resolution: ${resolution}`,
      priority: 'high'
    });
    
    await Notification.create({
      userId: booking.workerId,
      type: 'system',
      title: 'Dispute Resolved',
      message: `Your dispute for booking ${booking.bookingId} has been resolved. Resolution: ${resolution}`,
      priority: 'high'
    });
    
    await AdminLog.createLog(
      req.user._id,
      `${req.user.firstName} ${req.user.lastName}`,
      'resolve_dispute',
      'booking',
      bookingId,
      `Resolved dispute with action: ${action}. Resolution: ${resolution}`,
      { action, resolution, notes },
      'info'
    );
    
    res.status(200).json({
      success: true,
      message: 'Dispute resolved successfully',
      data: booking
    });
  } catch (error) {
    console.error('Resolve dispute error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get admin logs
exports.getAdminLogs = async (req, res) => {
  try {
    const { action, severity, startDate, endDate, page = 1, limit = 50 } = req.query;
    
    const query = {};
    if (action) query.action = action;
    if (severity) query.severity = severity;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const logs = await AdminLog.find(query)
      .populate('adminId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await AdminLog.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get admin logs error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Send notification to users
exports.sendNotification = async (req, res) => {
  try {
    const { userIds, title, message, type = 'system', priority = 'medium' } = req.body;
    
    const notifications = [];
    for (const userId of userIds) {
      const notification = new Notification({
        userId,
        type,
        title,
        message,
        priority,
        isSent: true,
        sentAt: new Date()
      });
      notifications.push(notification);
    }
    
    await Notification.insertMany(notifications);
    
    await AdminLog.createLog(
      req.user._id,
      `${req.user.firstName} ${req.user.lastName}`,
      'send_notification',
      'notification',
      null,
      `Sent notification to ${userIds.length} users`,
      { userIds, title, message },
      'info'
    );
    
    res.status(200).json({
      success: true,
      message: `Notification sent to ${userIds.length} users`,
      data: { count: notifications.length }
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get platform statistics
exports.getPlatformStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true, lastSeen: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });
    const totalBookingsAll = await Booking.countDocuments();
    const totalRevenue = await Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$commission' } } }
    ]);
    
    const averageRating = await WorkerProfile.aggregate([
      { $group: { _id: null, avg: { $avg: '$averageRating' } } }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        totalBookings: totalBookingsAll,
        totalRevenue: totalRevenue[0]?.total || 0,
        averageWorkerRating: averageRating[0]?.avg || 0,
        platformAge: Math.floor((Date.now() - new Date('2024-01-01')) / (1000 * 60 * 60 * 24))
      }
    });
  } catch (error) {
    console.error('Get platform stats error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};