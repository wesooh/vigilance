const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const User = require('../models/User');
const axios = require('axios');
const moment = require('moment');

// Initialize M-Pesa STK Push
exports.initiateMpesaPayment = async (req, res) => {
  try {
    const { bookingId, phoneNumber } = req.body;
    const clientId = req.user._id;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      clientId,
      paymentStatus: 'pending'
    });
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found or already paid' });
    }
    
    // Get M-Pesa access token
    const accessToken = await getMpesaAccessToken();
    
    // Format phone number
    const formattedPhone = phoneNumber.replace(/^0+/, '254');
    
    // Prepare STK Push request
    const timestamp = moment().format('YYYYMMDDHHmmss');
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');
    
    const stkPushRequest = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(booking.totalAmount),
      PartyA: formattedPhone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: booking.bookingId,
      TransactionDesc: `Payment for booking ${booking.bookingId}`
    };
    
    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      stkPushRequest,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Create payment record
    const payment = new Payment({
      bookingId: booking._id,
      clientId,
      workerId: booking.workerId,
      amount: booking.totalAmount,
      commission: booking.commissionAmount,
      workerPayout: booking.workerEarnings,
      paymentMethod: 'mpesa',
      status: 'pending',
      mpesaResponse: response.data
    });
    
    await payment.save();
    
    // Update booking with payment ID
    booking.paymentId = payment._id;
    await booking.save();
    
    res.status(200).json({
      success: true,
      message: 'STK Push sent successfully',
      data: {
        checkoutRequestID: response.data.CheckoutRequestID,
        merchantRequestID: response.data.MerchantRequestID,
        paymentId: payment._id
      }
    });
  } catch (error) {
    console.error('Initiate M-Pesa payment error:', error);
    res.status(500).json({ success: false, message: 'Payment initiation failed', error: error.message });
  }
};

// M-Pesa Callback URL
exports.mpesaCallback = async (req, res) => {
  try {
    const callbackData = req.body;
    
    console.log('M-Pesa Callback received:', JSON.stringify(callbackData, null, 2));
    
    const { Body } = callbackData;
    const { stkCallback } = Body;
    const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = stkCallback;
    
    // Find payment by CheckoutRequestID in mpesaResponse
    const payment = await Payment.findOne({
      'mpesaResponse.CheckoutRequestID': CheckoutRequestID
    });
    
    if (!payment) {
      console.error('Payment not found for CheckoutRequestID:', CheckoutRequestID);
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }
    
    if (ResultCode === 0) {
      // Payment successful
      const metadata = {};
      if (CallbackMetadata && CallbackMetadata.Item) {
        CallbackMetadata.Item.forEach(item => {
          metadata[item.Name] = item.Value;
        });
      }
      
      payment.status = 'completed';
      payment.transactionDetails = {
        mpesaReceiptNumber: metadata.MpesaReceiptNumber,
        transactionDate: metadata.TransactionDate,
        phoneNumber: metadata.PhoneNumber,
        resultCode: ResultCode,
        resultDesc: ResultDesc
      };
      payment.mpesaCode = metadata.MpesaReceiptNumber;
      
      await payment.save();
      
      // Update booking
      const booking = await Booking.findById(payment.bookingId);
      if (booking) {
        booking.paymentStatus = 'paid';
        await booking.save();
        
        // Update worker's total earnings
        const workerProfile = await WorkerProfile.findOne({ userId: booking.workerId });
        if (workerProfile) {
          workerProfile.totalEarnings += payment.workerPayout;
          await workerProfile.save();
        }
        
        // Emit payment confirmation via socket
        if (global.emitPaymentConfirmation) {
          global.emitPaymentConfirmation(payment._id, booking.clientId, payment.amount, 'completed');
        }
      }
    } else {
      // Payment failed
      payment.status = 'failed';
      payment.transactionDetails = {
        resultCode: ResultCode,
        resultDesc: ResultDesc
      };
      await payment.save();
      
      // Emit payment failure
      if (global.emitPaymentConfirmation) {
        global.emitPaymentConfirmation(payment._id, payment.clientId, payment.amount, 'failed');
      }
    }
    
    res.status(200).json({ success: true, message: 'Callback processed' });
  } catch (error) {
    console.error('M-Pesa callback error:', error);
    res.status(500).json({ success: false, message: 'Error processing callback' });
  }
};

// Get M-Pesa access token
async function getMpesaAccessToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');
  
  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );
  
  return response.data.access_token;
}

// Verify payment status
exports.verifyPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await Payment.findById(paymentId)
      .populate('bookingId', 'bookingId totalAmount serviceDate')
      .populate('clientId', 'firstName lastName email phoneNumber')
      .populate('workerId', 'firstName lastName email phoneNumber');
    
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }
    
    res.status(200).json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Request worker payout
exports.requestPayout = async (req, res) => {
  try {
    const { amount, phoneNumber } = req.body;
    const workerId = req.user._id;
    
    // Check available balance
    const workerProfile = await WorkerProfile.findOne({ userId: workerId });
    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker profile not found' });
    }
    
    const availableBalance = workerProfile.totalEarnings;
    
    if (amount > availableBalance) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    
    // Find completed payments not yet paid out
    const unpaidPayments = await Payment.find({
      workerId,
      status: 'completed',
      payoutStatus: 'pending'
    });
    
    if (unpaidPayments.length === 0) {
      return res.status(400).json({ success: false, message: 'No pending payouts available' });
    }
    
    // Process payout (integrate with M-Pesa B2C here)
    // For now, mark as processed
    for (const payment of unpaidPayments) {
      payment.payoutStatus = 'processed';
      payment.payoutDate = new Date();
      await payment.save();
    }
    
    // Update worker's total earnings (subtract paid amount)
    workerProfile.totalEarnings -= amount;
    await workerProfile.save();
    
    res.status(200).json({
      success: true,
      message: 'Payout request processed successfully',
      data: {
        amount,
        processedPayments: unpaidPayments.length,
        remainingBalance: workerProfile.totalEarnings
      }
    });
  } catch (error) {
    console.error('Request payout error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get worker commission statement
exports.getCommissionStatement = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    const workerId = req.user._id;
    
    let groupByFormat;
    if (period === 'daily') groupByFormat = '%Y-%m-%d';
    else if (period === 'weekly') groupByFormat = '%Y-%u';
    else groupByFormat = '%Y-%m';
    
    const payments = await Payment.aggregate([
      {
        $match: {
          workerId: workerId._id,
          status: 'completed',
          payoutStatus: 'processed'
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: groupByFormat, date: '$createdAt' }
          },
          totalEarnings: { $sum: '$workerPayout' },
          totalCommission: { $sum: '$commission' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': -1 }
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: payments
    });
  } catch (error) {
    console.error('Get commission statement error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};