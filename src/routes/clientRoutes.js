const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');

// Test route
router.get('/test', protect, authorize('client'), (req, res) => {
  res.json({ success: true, message: 'Client route working' });
});

// Book worker route
router.post('/book-worker', protect, authorize('client'), (req, res) => {
  res.json({ success: true, message: 'Booking created' });
});

// Get client bookings
router.get('/bookings', protect, authorize('client'), (req, res) => {
  res.json({ success: true, data: [] });
});

// Cancel booking
router.put('/cancel-booking/:bookingId', protect, authorize('client'), (req, res) => {
  res.json({ success: true, message: 'Booking cancelled' });
});

// Complete booking
router.put('/complete-booking/:bookingId', protect, authorize('client'), (req, res) => {
  res.json({ success: true, message: 'Booking completed' });
});

// Rate worker
router.post('/rate-worker', protect, authorize('client'), (req, res) => {
  res.json({ success: true, message: 'Rating submitted' });
});

// Get worker details
router.get('/worker/:workerId', protect, (req, res) => {
  res.json({ success: true, data: {} });
});

module.exports = router;