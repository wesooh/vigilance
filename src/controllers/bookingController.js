const Booking = require('../models/Booking');
const WorkerProfile = require('../models/WorkerProfile');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Notification = require('../models/Notification');

// Get all bookings with filters
exports.getAllBookings = async (req, res) => {
  try {
    const { status, workerId, clientId, startDate, endDate, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (workerId) query.workerId = workerId;
    if (clientId) query.clientId = clientId;
    if (startDate || endDate) {
      query.serviceDate = {};
      if (startDate) query.serviceDate.$gte = new Date(startDate);
      if (endDate) query.serviceDate.$lte = new Date(endDate);
    }
    
    const bookings = await Booking.find(query)
      .populate('clientId', 'firstName lastName email phoneNumber profilePicture')
      .populate('workerId', 'firstName lastName email phoneNumber profilePicture')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Booking.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all bookings error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get single booking by ID
exports.getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const booking = await Booking.findById(id)
      .populate('clientId', 'firstName lastName email phoneNumber profilePicture address')
      .populate('workerId', 'firstName lastName email phoneNumber profilePicture')
      .populate('paymentId');
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    
    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking by ID error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Create new booking
exports.createBooking = async (req, res) => {
  try {
    const {
      workerId,
      serviceCategory,
      serviceDate,
      duration,
      startTime,
      endTime,
      address,
      location,
      specialInstructions
    } = req.body;
    
    const clientId = req.user._id;
    
    // Check if worker exists and is available
    const worker = await WorkerProfile.findOne({ userId: workerId, isApproved: true });
    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker not found or not approved' });
    }
    
    if (!worker.availability.onDuty || worker.availability.status !== 'available') {
      return res.status(400).json({ success: false, message: 'Worker is not available at the moment' });
    }
    
    // Calculate total amount
    let totalAmount = 0;
    if (duration === 'daily') totalAmount = worker.rates.daily;
    else if (duration === 'weekly') totalAmount = worker.rates.weekly;
    else if (duration === 'monthly') totalAmount = worker.rates.monthly;
    
    if (totalAmount === 0) {
      return res.status(400).json({ success: false, message: 'Worker rates not set for this duration' });
    }
    
    const commissionAmount = totalAmount * 0.25;
    const workerEarnings = totalAmount * 0.75;
    
    // Create booking
    const booking = new Booking({
      clientId,
      workerId,
      serviceCategory,
      serviceDate: new Date(serviceDate),
      duration,
      startTime,
      endTime,
      address,
      location: location ? {
        type: 'Point',
        coordinates: [location.lng, location.lat]
      } : undefined,
      specialInstructions,
      totalAmount,
      commissionAmount,
      workerEarnings
    });
    
    await booking.save();
    
    // Create notification for worker
    const client = await User.findById(clientId);
    await Notification.create({
      userId: workerId,
      type: 'booking',
      title: 'New Booking Request',
      message: `${client.firstName} ${client.lastName} has requested your service for ${serviceCategory}`,
      data: { bookingId: booking._id },
      priority: 'high'
    });
    
    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: booking
    });
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Update booking status
exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;
    
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    
    await booking.updateStatus(status, req.user._id, note);
    
    // Create notification for the other party
    const otherPartyId = booking.clientId.toString() === req.user._id.toString() 
      ? booking.workerId 
      : booking.clientId;
    
    await Notification.create({
      userId: otherPartyId,
      type: 'booking',
      title: `Booking ${status}`,
      message: `Your booking #${booking.bookingId} has been ${status}`,
      data: { bookingId: booking._id, status },
      priority: 'medium'
    });
    
    res.status(200).json({
      success: true,
      message: `Booking ${status} successfully`,
      data: booking
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Cancel booking
exports.cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    
    // Check if booking can be cancelled
    if (booking.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Completed bookings cannot be cancelled' });
    }
    
    booking.status = 'cancelled';
    booking.cancellationReason = reason;
    booking.cancelledBy = req.user.role;
    
    booking.timeline.push({
      status: 'cancelled',
      timestamp: new Date(),
      note: reason || `Cancelled by ${req.user.role}`,
      updatedBy: req.user._id
    });
    
    await booking.save();
    
    // Process refund if payment was made
    if (booking.paymentStatus === 'paid') {
      const payment = await Payment.findOne({ bookingId: booking._id });
      if (payment && payment.status === 'completed') {
        payment.status = 'refunded';
        payment.refundDetails = {
          refundAmount: payment.amount,
          refundDate: new Date(),
          refundReason: reason
        };
        await payment.save();
      }
      booking.paymentStatus = 'refunded';
      await booking.save();
    }
    
    // Notify both parties
    await Notification.create({
      userId: booking.clientId,
      type: 'booking',
      title: 'Booking Cancelled',
      message: `Your booking #${booking.bookingId} has been cancelled. Reason: ${reason || 'No reason provided'}`,
      data: { bookingId: booking._id },
      priority: 'high'
    });
    
    await Notification.create({
      userId: booking.workerId,
      type: 'booking',
      title: 'Booking Cancelled',
      message: `Booking #${booking.bookingId} has been cancelled. Reason: ${reason || 'No reason provided'}`,
      data: { bookingId: booking._id },
      priority: 'high'
    });
    
    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: booking
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Reschedule booking
exports.rescheduleBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { newDate, startTime, endTime, reason } = req.body;
    
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    
    const oldDate = booking.serviceDate;
    booking.serviceDate = new Date(newDate);
    if (startTime) booking.startTime = startTime;
    if (endTime) booking.endTime = endTime;
    
    booking.timeline.push({
      status: 'rescheduled',
      timestamp: new Date(),
      note: `Rescheduled from ${oldDate} to ${newDate}. Reason: ${reason}`,
      updatedBy: req.user._id
    });
    
    await booking.save();
    
    // Notify both parties
    await Notification.create({
      userId: booking.clientId,
      type: 'booking',
      title: 'Booking Rescheduled',
      message: `Your booking #${booking.bookingId} has been rescheduled to ${newDate}`,
      data: { bookingId: booking._id },
      priority: 'medium'
    });
    
    await Notification.create({
      userId: booking.workerId,
      type: 'booking',
      title: 'Booking Rescheduled',
      message: `Booking #${booking.bookingId} has been rescheduled to ${newDate}`,
      data: { bookingId: booking._id },
      priority: 'medium'
    });
    
    res.status(200).json({
      success: true,
      message: 'Booking rescheduled successfully',
      data: booking
    });
  } catch (error) {
    console.error('Reschedule booking error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Add rating to booking
exports.addBookingRating = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, review } = req.body;
    
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    
    // Determine if client or worker is rating
    if (req.user._id.toString() === booking.clientId.toString()) {
      booking.rating.clientRating = rating;
      booking.rating.clientReview = review;
    } else if (req.user._id.toString() === booking.workerId.toString()) {
      booking.rating.workerRating = rating;
      booking.rating.workerReview = review;
    } else {
      return res.status(403).json({ success: false, message: 'Not authorized to rate this booking' });
    }
    
    await booking.save();
    
    // Update worker's average rating
    if (req.user._id.toString() === booking.clientId.toString()) {
      const workerProfile = await WorkerProfile.findOne({ userId: booking.workerId });
      if (workerProfile) {
        workerProfile.testimonials.push({
          clientId: booking.clientId,
          rating,
          comment: review,
          date: new Date()
        });
        await workerProfile.updateAverageRating();
        await workerProfile.save();
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Rating added successfully',
      data: booking.rating
    });
  } catch (error) {
    console.error('Add booking rating error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get booking timeline
exports.getBookingTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    
    const booking = await Booking.findById(id).select('timeline bookingId');
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    
    res.status(200).json({
      success: true,
      data: {
        bookingId: booking.bookingId,
        timeline: booking.timeline
      }
    });
  } catch (error) {
    console.error('Get booking timeline error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get upcoming bookings for worker
exports.getUpcomingBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;
    
    const query = {
      serviceDate: { $gte: new Date() },
      status: { $in: ['accepted', 'in_progress'] }
    };
    
    if (role === 'client') query.clientId = userId;
    else if (role === 'worker') query.workerId = userId;
    
    const bookings = await Booking.find(query)
      .populate('clientId', 'firstName lastName profilePicture phoneNumber')
      .populate('workerId', 'firstName lastName profilePicture phoneNumber')
      .sort({ serviceDate: 1 })
      .limit(20);
    
    res.status(200).json({
      success: true,
      data: bookings
    });
  } catch (error) {
    console.error('Get upcoming bookings error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get booking statistics
exports.getBookingStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;
    
    const matchQuery = role === 'client' ? { clientId: userId } : { workerId: userId };
    
    const stats = await Booking.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);
    
    const monthlyStats = await Booking.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        byStatus: stats,
        monthlyTrend: monthlyStats,
        totalBookings: stats.reduce((sum, s) => sum + s.count, 0)
      }
    });
  } catch (error) {
    console.error('Get booking stats error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};