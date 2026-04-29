const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');

// Test route
router.get('/test', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, message: 'Worker route working' });
});

// Get nearby workers (accessible by both clients and workers)
router.get('/nearby', protect, (req, res) => {
  res.json({ success: true, data: [] });
});

// Update availability
router.put('/availability', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, message: 'Availability updated' });
});

// Update profile
router.put('/profile', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, message: 'Profile updated' });
});

// Get worker profile
router.get('/profile/:id', protect, (req, res) => {
  res.json({ success: true, data: {} });
});

// Get worker bookings
router.get('/bookings', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, data: [] });
});

// Respond to booking
router.post('/respond-booking', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, message: 'Response sent' });
});

// Get earnings
router.get('/earnings', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, data: { totalEarnings: 0, totalJobs: 0 } });
});

// Upload documents
router.post('/upload-documents', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, message: 'Documents uploaded' });
});

module.exports = router;