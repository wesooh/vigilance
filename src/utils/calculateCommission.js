const COMMISSION_RATE = 0.25; // 25%

const calculateCommission = (amount) => {
  const commission = amount * COMMISSION_RATE;
  const workerEarnings = amount - commission;
  
  return {
    totalAmount: amount,
    commission,
    workerEarnings,
    commissionRate: COMMISSION_RATE
  };
};

const calculateWorkerRate = (daily, weekly, monthly) => {
  return {
    daily,
    weekly: weekly || daily * 6,
    monthly: monthly || daily * 24,
    hourly: daily / 8
  };
};

module.exports = { calculateCommission, calculateWorkerRate, COMMISSION_RATE };