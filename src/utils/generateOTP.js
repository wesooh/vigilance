const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const generateBookingId = () => {
  const prefix = 'VHC';
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `${prefix}${timestamp}${random}`;
};

const generatePaymentId = () => {
  const prefix = 'PAY';
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `${prefix}${timestamp}${random}`;
};

module.exports = { generateOTP, generateBookingId, generatePaymentId };