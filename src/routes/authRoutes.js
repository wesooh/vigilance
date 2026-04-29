const express = require('express');
const router = express.Router();

// Simple test route first
router.get('/test', (req, res) => {
    res.json({ success: true, message: 'Auth route working' });
});

// Register client
router.post('/register/client', async (req, res) => {
    res.json({ success: true, message: 'Register client endpoint' });
});

// Register worker
router.post('/register/worker', async (req, res) => {
    res.json({ success: true, message: 'Register worker endpoint' });
});

// Login
router.post('/login', async (req, res) => {
    res.json({ success: true, message: 'Login endpoint' });
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
    res.json({ success: true, message: 'OTP verified' });
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
    res.json({ success: true, message: 'OTP resent' });
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
    res.json({ success: true, message: 'Reset email sent' });
});

// Reset password
router.post('/reset-password', async (req, res) => {
    res.json({ success: true, message: 'Password reset' });
});

// Get profile (protected - mock for now)
router.get('/me', async (req, res) => {
    res.json({ success: true, data: { id: 1, name: 'Test User' } });
});

// Update profile
router.put('/update-profile', async (req, res) => {
    res.json({ success: true, message: 'Profile updated' });
});

// Logout
router.post('/logout', async (req, res) => {
    res.json({ success: true, message: 'Logged out' });
});

module.exports = router;