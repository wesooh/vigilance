const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');

// M-Pesa callback (public)
router.post('/mpesa/callback', (req, res) => {
  res.json({ success: true, message: 'Callback received' });
});

// Initiate M-Pesa payment
router.post('/mpesa/stkpush', protect, authorize('client'), (req, res) => {
  res.json({ success: true, message: 'STK Push sent' });
});

// Verify payment
router.get('/verify/:paymentId', protect, (req, res) => {
  res.json({ success: true, data: { status: 'completed' } });
});

// Request payout (worker)
router.post('/worker/request-payout', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, message: 'Payout requested' });
});

// Get commission statement
router.get('/worker/commission-statement', protect, authorize('worker'), (req, res) => {
  res.json({ success: true, data: [] });
});

module.exports = router;