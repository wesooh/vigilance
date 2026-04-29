const axios = require('axios');
const moment = require('moment');

class MpesaService {
  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.passkey = process.env.MPESA_PASSKEY;
    this.shortcode = process.env.MPESA_SHORTCODE;
    this.environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
    
    this.baseURL = this.environment === 'production' 
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
  }

  // Get OAuth token
  async getAccessToken() {
    try {
      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      
      const response = await axios.get(
        `${this.baseURL}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${auth}`
          }
        }
      );
      
      return response.data.access_token;
    } catch (error) {
      console.error('Error getting M-Pesa access token:', error.response?.data || error.message);
      throw new Error('Failed to get M-Pesa access token');
    }
  }

  // STK Push (Lipa Na M-Pesa Online)
  async stkPush(phoneNumber, amount, accountReference, transactionDesc) {
    try {
      const accessToken = await this.getAccessToken();
      const timestamp = moment().format('YYYYMMDDHHmmss');
      const password = Buffer.from(
        `${this.shortcode}${this.passkey}${timestamp}`
      ).toString('base64');
      
      // Format phone number to 254XXXXXXXXX
      const formattedPhone = phoneNumber.replace(/^0+/, '254');
      
      const requestData = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: this.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc || 'Payment for services'
      };
      
      const response = await axios.post(
        `${this.baseURL}/mpesa/stkpush/v1/processrequest`,
        requestData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        success: true,
        data: response.data,
        checkoutRequestId: response.data.CheckoutRequestID
      };
    } catch (error) {
      console.error('STK Push error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Query STK Push status
  async queryStatus(checkoutRequestId) {
    try {
      const accessToken = await this.getAccessToken();
      const timestamp = moment().format('YYYYMMDDHHmmss');
      const password = Buffer.from(
        `${this.shortcode}${this.passkey}${timestamp}`
      ).toString('base64');
      
      const requestData = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };
      
      const response = await axios.post(
        `${this.baseURL}/mpesa/stkpushquery/v1/query`,
        requestData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Query status error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // B2C Payment (for worker payouts)
  async b2cPayment(phoneNumber, amount, commandID = 'BusinessPayment') {
    try {
      const accessToken = await this.getAccessToken();
      
      const formattedPhone = phoneNumber.replace(/^0+/, '254');
      
      const requestData = {
        InitiatorName: process.env.MPESA_INITIATOR_NAME,
        SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
        CommandID: commandID,
        Amount: Math.round(amount),
        PartyA: this.shortcode,
        PartyB: formattedPhone,
        Remarks: 'Worker payout',
        QueueTimeOutURL: `${process.env.API_BASE_URL}/api/payments/b2c/timeout`,
        ResultURL: `${process.env.API_BASE_URL}/api/payments/b2c/result`,
        Occasion: 'Monthly payout'
      };
      
      const response = await axios.post(
        `${this.baseURL}/mpesa/b2c/v1/paymentrequest`,
        requestData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        success: true,
        data: response.data,
        conversationId: response.data.ConversationID
      };
    } catch (error) {
      console.error('B2C payment error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Validate phone number (Kenyan)
  validatePhoneNumber(phoneNumber) {
    const phoneRegex = /^(?:\+254|0)[7-9][0-9]{8}$/;
    return phoneRegex.test(phoneNumber);
  }

  // Format phone number for API
  formatPhoneNumber(phoneNumber) {
    // Remove any non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // If starts with 0, replace with 254
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    }
    
    // If doesn't start with 254, add it
    if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }
    
    return cleaned;
  }
}

module.exports = new MpesaService();