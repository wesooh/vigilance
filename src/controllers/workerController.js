const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const { uploadFilesToCloudinary } = require('../middleware/upload');

// Get worker profile
exports.getWorkerProfile = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findById(id).select('-password');
    if (!user || user.role !== 'worker') {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    
    const workerProfile = await WorkerProfile.findOne({ userId: id });
    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker profile not found' });
    }
    
    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          profilePicture: user.profilePicture,
          phoneNumber: user.phoneNumber,
          email: user.email,
          location: user.location,
          address: user.address,
          rating: workerProfile.averageRating,
          totalJobs: workerProfile.totalJobsCompleted
        },
        profile: workerProfile
      }
    });
  } catch (error) {
    console.error('Get worker profile error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Update worker profile
exports.updateWorkerProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const updates = req.body;
    
    const allowedUpdates = ['skills', 'workExperience', 'rates', 'availability', 'categories'];
    const filteredUpdates = {};
    
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }
    
    const workerProfile = await WorkerProfile.findOneAndUpdate(
      { userId },
      filteredUpdates,
      { new: true, runValidators: true }
    );
    
    res.status(200).json({
      success: true,
      message: 'Worker profile updated successfully',
      data: workerProfile
    });
  } catch (error) {
    console.error('Update worker profile error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Update availability
exports.updateAvailability = async (req, res) => {
  try {
    const { onDuty, latitude, longitude, status, workingHours, availableDays } = req.body;
    
    const workerProfile = await WorkerProfile.findOne({ userId: req.user._id });
    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker profile not found' });
    }
    
    if (onDuty !== undefined) {
      workerProfile.availability.onDuty = onDuty;
      workerProfile.availability.status = onDuty ? 'available' : 'offline';
    }
    
    if (latitude && longitude) {
      workerProfile.availability.currentLocation = {
        type: 'Point',
        coordinates: [longitude, latitude]
      };
      workerProfile.availability.lastLocationUpdate = new Date();
    }
    
    if (status) workerProfile.availability.status = status;
    if (workingHours) workerProfile.availability.workingHours = workingHours;
    if (availableDays) workerProfile.availability.availableDays = availableDays;
    
    await workerProfile.save();
    
    // Update user location
    if (latitude && longitude) {
      await User.findByIdAndUpdate(req.user._id, {
        'location.coordinates': [longitude, latitude]
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Availability updated successfully',
      data: {
        onDuty: workerProfile.availability.onDuty,
        status: workerProfile.availability.status,
        location: workerProfile.availability.currentLocation,
        lastUpdate: workerProfile.availability.lastLocationUpdate
      }
    });
  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get nearby workers (for map)
exports.getNearbyWorkers = async (req, res) => {
  try {
    const { latitude, longitude, radius = 5, category, subCategory, minRating } = req.query;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude required' });
    }
    
    const radiusInMeters = radius * 1000;
    
    // Find workers with location
    const query = {
      'availability.onDuty': true,
      'availability.status': 'available',
      isApproved: true,
      'availability.currentLocation': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: radiusInMeters
        }
      }
    };
    
    if (category) {
      query['categories.mainCategory'] = category;
    }
    
    if (subCategory) {
      query['categories.subCategory'] = subCategory;
    }
    
    if (minRating) {
      query.averageRating = { $gte: parseFloat(minRating) };
    }
    
    const workers = await WorkerProfile.find(query)
      .populate('userId', 'firstName lastName profilePicture phoneNumber averageRating')
      .limit(50);
    
    // Calculate distance for each worker
    const workersWithDistance = workers.map(worker => {
      const distance = calculateDistance(
        latitude,
        longitude,
        worker.availability.currentLocation.coordinates[1],
        worker.availability.currentLocation.coordinates[0]
      );
      
      return {
        ...worker.toObject(),
        distance: `${distance.toFixed(1)} km`
      };
    });
    
    res.status(200).json({
      success: true,
      count: workersWithDistance.length,
      data: workersWithDistance
    });
  } catch (error) {
    console.error('Get nearby workers error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Helper function to calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Upload worker documents
exports.uploadDocuments = async (req, res) => {
  try {
    const files = req.files;
    const userId = req.user._id;
    
    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }
    
    const uploadedFiles = await uploadFilesToCloudinary(files, userId, 'workers');
    
    const workerProfile = await WorkerProfile.findOne({ userId });
    
    // Update document URLs
    if (uploadedFiles.cv) {
      workerProfile.documents.cv = uploadedFiles.cv[0].url;
    }
    
    if (uploadedFiles.certificates) {
      workerProfile.documents.certificates = uploadedFiles.certificates.map(f => f.url);
    }
    
    if (uploadedFiles.portfolio) {
      workerProfile.documents.portfolio = uploadedFiles.portfolio.map(f => f.url);
    }
    
    if (uploadedFiles.idPhoto) {
      workerProfile.documents.idPhoto = uploadedFiles.idPhoto[0].url;
      await User.findByIdAndUpdate(userId, { idPhotoUrl: uploadedFiles.idPhoto[0].url });
    }
    
    if (uploadedFiles.profilePicture) {
      await User.findByIdAndUpdate(userId, { profilePicture: uploadedFiles.profilePicture[0].url });
    }
    
    await workerProfile.save();
    
    res.status(200).json({
      success: true,
      message: 'Documents uploaded successfully',
      data: uploadedFiles
    });
  } catch (error) {
    console.error('Upload documents error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get worker bookings
exports.getWorkerBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { workerId: req.user._id };
    if (status) query.status = status;
    
    const bookings = await Booking.find(query)
      .populate('clientId', 'firstName lastName profilePicture phoneNumber')
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
    console.error('Get worker bookings error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get worker earnings
exports.getWorkerEarnings = async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    
    let dateFilter = {};
    const now = new Date();
    
    if (period === 'today') {
      dateFilter = {
        createdAt: {
          $gte: new Date(now.setHours(0, 0, 0, 0)),
          $lte: new Date(now.setHours(23, 59, 59, 999))
        }
      };
    } else if (period === 'week') {
      const weekAgo = new Date(now.setDate(now.getDate() - 7));
      dateFilter = { createdAt: { $gte: weekAgo } };
    } else if (period === 'month') {
      const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
      dateFilter = { createdAt: { $gte: monthAgo } };
    }
    
    const payments = await Payment.find({
      workerId: req.user._id,
      status: 'completed',
      ...dateFilter
    });
    
    const totalEarnings = payments.reduce((sum, p) => sum + p.workerPayout, 0);
    const totalCommission = payments.reduce((sum, p) => sum + p.commission, 0);
    const totalBookings = payments.length;
    
    const monthlyEarnings = {};
    payments.forEach(payment => {
      const month = payment.createdAt.toISOString().slice(0, 7);
      if (!monthlyEarnings[month]) {
        monthlyEarnings[month] = 0;
      }
      monthlyEarnings[month] += payment.workerPayout;
    });
    
    res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        totalCommission,
        totalBookings,
        averagePerJob: totalBookings > 0 ? totalEarnings / totalBookings : 0,
        monthlyBreakdown: monthlyEarnings,
        recentPayments: payments.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('Get worker earnings error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Respond to booking request
exports.respondToBooking = async (req, res) => {
  try {
    const { bookingId, action } = req.body;
    
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or reject' });
    }
    
    const booking = await Booking.findOne({
      _id: bookingId,
      workerId: req.user._id,
      status: 'pending'
    });
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found or already responded' });
    }
    
    if (action === 'accept') {
      await booking.updateStatus('accepted', req.user._id, 'Worker accepted the booking');
    } else {
      await booking.updateStatus('cancelled', req.user._id, 'Worker rejected the booking');
    }
    
    res.status(200).json({
      success: true,
      message: `Booking ${action}ed successfully`,
      data: { bookingId, status: booking.status }
    });
  } catch (error) {
    console.error('Respond to booking error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Add testimonial for worker
exports.addTestimonial = async (req, res) => {
  try {
    const { workerId, rating, comment } = req.body;
    const clientId = req.user._id;
    
    // Check if client has completed booking with this worker
    const completedBooking = await Booking.findOne({
      clientId,
      workerId,
      status: 'completed',
      'rating.clientRating': { $exists: false }
    });
    
    if (!completedBooking) {
      return res.status(400).json({ 
        success: false, 
        message: 'You can only review workers you have completed a booking with' 
      });
    }
    
    const workerProfile = await WorkerProfile.findOne({ userId: workerId });
    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    
    const client = await User.findById(clientId);
    
    workerProfile.testimonials.push({
      clientId,
      clientName: `${client.firstName} ${client.lastName}`,
      rating,
      comment,
      date: new Date()
    });
    
    await workerProfile.updateAverageRating();
    await workerProfile.save();
    
    // Update booking with rating
    completedBooking.rating.clientRating = rating;
    completedBooking.rating.clientReview = comment;
    await completedBooking.save();
    
    res.status(201).json({
      success: true,
      message: 'Testimonial added successfully',
      data: {
        averageRating: workerProfile.averageRating,
        testimonialCount: workerProfile.testimonials.length
      }
    });
  } catch (error) {
    console.error('Add testimonial error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Search workers with filters
exports.searchWorkers = async (req, res) => {
  try {
    const { query, category, subCategory, minRating, maxRate, location, radius = 10 } = req.query;
    
    const searchQuery = {
      isApproved: true,
      'availability.onDuty': true
    };
    
    if (category) {
      searchQuery['categories.mainCategory'] = category;
    }
    
    if (subCategory) {
      searchQuery['categories.subCategory'] = subCategory;
    }
    
    if (minRating) {
      searchQuery.averageRating = { $gte: parseFloat(minRating) };
    }
    
    if (maxRate) {
      searchQuery.$or = [
        { 'rates.daily': { $lte: parseFloat(maxRate) } },
        { 'rates.weekly': { $lte: parseFloat(maxRate) } },
        { 'rates.monthly': { $lte: parseFloat(maxRate) } }
      ];
    }
    
    if (query) {
      const users = await User.find({
        role: 'worker',
        $or: [
          { firstName: { $regex: query, $options: 'i' } },
          { lastName: { $regex: query, $options: 'i' } }
        ]
      }).select('_id');
      
      searchQuery.userId = { $in: users.map(u => u._id) };
    }
    
    let workers = await WorkerProfile.find(searchQuery)
      .populate('userId', 'firstName lastName profilePicture phoneNumber')
      .limit(50);
    
    // Filter by location if provided
    if (location && location.latitude && location.longitude) {
      workers = workers.filter(worker => {
        if (worker.availability.currentLocation && worker.availability.currentLocation.coordinates) {
          const distance = calculateDistance(
            location.latitude,
            location.longitude,
            worker.availability.currentLocation.coordinates[1],
            worker.availability.currentLocation.coordinates[0]
          );
          return distance <= radius;
        }
        return false;
      });
    }
    
    res.status(200).json({
      success: true,
      count: workers.length,
      data: workers,
    });
  } catch (error) {
    console.error('Search workers error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};