const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Send OTP email
const sendOTPEmail = async (email, otp, name, isPasswordReset = false) => {
  try {
    const subject = isPasswordReset ? 'Password Reset OTP - VH Colliance' : 'Verify Your Email - VH Colliance';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
          .otp-code { font-size: 32px; font-weight: bold; color: #4CAF50; padding: 20px; text-align: center; letter-spacing: 5px; }
          .button { background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; display: inline-block; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #777; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>VH Colliance</h1>
          </div>
          <h2>Hello ${name},</h2>
          <p>${isPasswordReset ? 'You requested to reset your password.' : 'Thank you for registering with VH Colliance!'}</p>
          <p>Your verification code is:</p>
          <div class="otp-code">${otp}</div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <div class="footer">
            <p>&copy; 2024 VH Colliance. All rights reserved.</p>
            <p>Connecting you with trusted workers</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    await transporter.sendMail({
      from: `"VH Colliance" <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: subject,
      html: html
    });
    
    console.log(`OTP email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

// Send booking confirmation email
const sendBookingConfirmation = async (email, name, bookingDetails) => {
  try {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
          .details { background: #f9f9f9; padding: 20px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #777; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Booking Confirmation</h1>
          </div>
          <h2>Hello ${name},</h2>
          <p>Your booking has been confirmed!</p>
          <div class="details">
            <p><strong>Booking ID:</strong> ${bookingDetails.bookingId}</p>
            <p><strong>Service:</strong> ${bookingDetails.serviceCategory}</p>
            <p><strong>Date:</strong> ${bookingDetails.serviceDate}</p>
            <p><strong>Amount:</strong> KES ${bookingDetails.totalAmount}</p>
          </div>
          <p>Track your booking in the app for real-time updates.</p>
          <div class="footer">
            <p>&copy; 2024 VH Colliance. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    await transporter.sendMail({
      from: `"VH Colliance" <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: 'Booking Confirmation - VH Colliance',
      html: html
    });
    
    return true;
  } catch (error) {
    console.error('Error sending booking email:', error);
    return false;
  }
};

module.exports = { sendOTPEmail, sendBookingConfirmation };