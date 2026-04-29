const Booking = require('../models/Booking');
const WorkerProfile = require('../models/WorkerProfile');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

// Book a worker
exports.bookWorker = async (req, res) => {
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
    
    // Calculate total amount based on duration and worker rates
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
    
    // Create or get conversation for chat
    let conversation = await Conversation.findOne({
      participants: { $all: [
        { $elemMatch: { userId: clientId } },
        { $elemMatch: { userId: workerId } }
      ] }
    });
    
    if (!conversation) {
      conversation = new Conversation({
        participants: [
          { userId: clientId, role: 'client', unreadCount: 0 },
          { userId: workerId, role: 'worker', unreadCount: 0 }
        ],
        bookingId: booking._id,
        isActive: true
      });
      await conversation.save();
    }
    
    // Notify worker via socket
    if (global.emitBookingUpdate) {
      global.emitBookingUpdate(booking._id, workerId, clientId, 'pending');
    }
    
    res.status(201).json({
      success: true,
      message: 'Booking request sent successfully',
      data: {
        bookingId: booking._id,
        bookingCode: booking.bookingId,
        totalAmount,
        commissionAmount,
        workerEarnings,
        status: booking.status,
        conversationId: conversation._id
      }
    });
  } catch (error) {
    console.error('Book worker error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get client bookings
exports.getClientBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { clientId: req.user._id };
    if (status) query.status = status;
    
    const bookings = await Booking.find(query)
      .populate('workerId', 'firstName lastName profilePicture phoneNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Booking.countDocuments(query);
    
    // Get worker profiles for each booking
    const bookingsWithProfiles = await Promise.all(bookings.map(async (booking) => {
      const workerProfile = await WorkerProfile.findOne({ userId: booking.workerId._id });
      return {
        ...booking.toObject(),
        worker: {
          ...booking.workerId.toObject(),
          rating: workerProfile ? workerProfile.averageRating : 0,
          totalJobs: workerProfile ? workerProfile.totalJobsCompleted : 0
        }
      };
    }));
    
    res.status(200).json({
      success: true,
      data: bookingsWithProfiles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get client bookings error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Cancel booking
exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      clientId: req.user._id,
      status: { $in: ['pending', 'accepted'] }
    });
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found or cannot be cancelled' });
    }
    
    await booking.updateStatus('cancelled', req.user._id, reason || 'Cancelled by client');
    booking.cancellationReason = reason;
    booking.cancelledBy = 'client';
    await booking.save();
    
    // Check if payment was made and refund
    if (booking.paymentStatus === 'paid') {
      const payment = await Payment.findOne({ bookingId: booking._id });
      if (payment && payment.status === 'completed') {
        // Process refund logic here
        payment.status = 'refunded';
        payment.refundDetails = {
          refundAmount: payment.amount,
          refundDate: new Date(),
          refundReason: reason || 'Booking cancelled by client'
        };
        await payment.save();
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { bookingId, status: booking.status }
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Complete booking (client confirms)
exports.completeBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { rating, review } = req.body;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      clientId: req.user._id,
      status: 'in_progress'
    });
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found or not in progress' });
    }
    
    await booking.updateStatus('completed', req.user._id, 'Booking completed by client');
    
    // Add rating if provided
    if (rating) {
      booking.rating.clientRating = rating;
      booking.rating.clientReview = review;
      await booking.save();
      
      // Update worker's testimonials and rating
      const workerProfile = await WorkerProfile.findOne({ userId: booking.workerId });
      if (workerProfile) {
        const client = await User.findById(req.user._id);
        workerProfile.testimonials.push({
          clientId: req.user._id,
          clientName: `${client.firstName} ${client.lastName}`,
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
      message: 'Booking completed successfully',
      data: { bookingId, status: booking.status }
    });
  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get worker details for client
exports.getWorkerDetails = async (req, res) => {
  try {
    const { workerId } = req.params;
    
    const user = await User.findById(workerId).select('-password');
    if (!user || user.role !== 'worker') {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    
    const workerProfile = await WorkerProfile.findOne({ userId: workerId });
    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker profile not found' });
    }
    
    // Get recent testimonials
    const recentTestimonials = workerProfile.testimonials.slice(-5).reverse();
    
    res.status(200).json({
      success: true,
      data: {
        personalInfo: {
          name: `${user.firstName} ${user.lastName}`,
          profilePicture: user.profilePicture,
          phoneNumber: user.phoneNumber,
          location: user.address,
          memberSince: user.createdAt
        },
        professionalInfo: {
          categories: workerProfile.categories,
          skills: workerProfile.skills,
          experience: workerProfile.workExperience,
          certifications: workerProfile.documents.certificates || [],
          rates: workerProfile.rates
        },
        performance: {
          rating: workerProfile.averageRating,
          totalJobs: workerProfile.totalJobsCompleted,
          testimonials: recentTestimonials,
          badges: workerProfile.badges
        },
        availability: {
          onDuty: workerProfile.availability.onDuty,
          status: workerProfile.availability.status,
          workingHours: workerProfile.availability.workingHours,
          availableDays: workerProfile.availability.availableDays
        }
      }
    });
  } catch (error) {
    console.error('Get worker details error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};