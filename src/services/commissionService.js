const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const WorkerProfile = require('../models/WorkerProfile');

const COMMISSION_RATE = 0.25; // 25%

// Calculate commission for a booking
exports.calculateCommission = (amount) => {
  const commission = amount * COMMISSION_RATE;
  const workerEarnings = amount - commission;
  
  return {
    totalAmount: amount,
    commission,
    workerEarnings,
    commissionRate: COMMISSION_RATE,
    commissionPercentage: `${COMMISSION_RATE * 100}%`
  };
};

// Process commission for completed booking
exports.processCommission = async (bookingId) => {
  try {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      throw new Error('Booking not found');
    }
    
    if (booking.status !== 'completed') {
      throw new Error('Booking is not completed');
    }
    
    const commission = calculateCommission(booking.totalAmount);
    
    // Update payment record
    const payment = await Payment.findOne({ bookingId });
    if (payment) {
      payment.commission = commission.commission;
      payment.workerPayout = commission.workerEarnings;
      await payment.save();
    }
    
    // Update worker's total earnings
    const workerProfile = await WorkerProfile.findOne({ userId: booking.workerId });
    if (workerProfile) {
      workerProfile.totalEarnings += commission.workerEarnings;
      workerProfile.totalJobsCompleted += 1;
      await workerProfile.save();
    }
    
    return commission;
  } catch (error) {
    console.error('Process commission error:', error);
    throw error;
  }
};

// Get company commission report
exports.getCompanyCommissionReport = async (startDate, endDate) => {
  try {
    const query = {
      status: 'completed',
      createdAt: {}
    };
    
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
    
    const payments = await Payment.find(query);
    
    const totalCommission = payments.reduce((sum, p) => sum + p.commission, 0);
    const totalTransactions = payments.length;
    const averageCommission = totalTransactions > 0 ? totalCommission / totalTransactions : 0;
    
    // Group by day
    const dailyReport = {};
    payments.forEach(payment => {
      const date = payment.createdAt.toISOString().split('T')[0];
      if (!dailyReport[date]) {
        dailyReport[date] = {
          date,
          commission: 0,
          transactions: 0
        };
      }
      dailyReport[date].commission += payment.commission;
      dailyReport[date].transactions += 1;
    });
    
    return {
      period: { startDate, endDate },
      summary: {
        totalCommission,
        totalTransactions,
        averageCommission,
        totalAmount: payments.reduce((sum, p) => sum + p.amount, 0)
      },
      dailyBreakdown: Object.values(dailyReport)
    };
  } catch (error) {
    console.error('Get company commission report error:', error);
    throw error;
  }
};

// Calculate worker's commission deduction for a period
exports.getWorkerCommissionDeduction = async (workerId, startDate, endDate) => {
  try {
    const query = {
      workerId,
      status: 'completed',
      createdAt: {}
    };
    
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
    
    const payments = await Payment.find(query);
    
    const totalEarned = payments.reduce((sum, p) => sum + p.workerPayout, 0);
    const totalCommissionDeducted = payments.reduce((sum, p) => sum + p.commission, 0);
    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    
    return {
      workerId,
      period: { startDate, endDate },
      summary: {
        totalEarned,
        totalCommissionDeducted,
        totalAmount,
        transactionCount: payments.length,
        effectiveRate: totalAmount > 0 ? (totalCommissionDeducted / totalAmount) * 100 : 0
      },
      transactions: payments
    };
  } catch (error) {
    console.error('Get worker commission deduction error:', error);
    throw error;
  }
};

// Verify commission calculation
exports.verifyCommissionCalculation = (amount, expectedCommission) => {
  const calculated = calculateCommission(amount);
  const isValid = Math.abs(calculated.commission - expectedCommission) < 0.01; // Allow small rounding error
  
  return {
    isValid,
    calculated: calculated.commission,
    provided: expectedCommission,
    difference: calculated.commission - expectedCommission
  };
};