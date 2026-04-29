const Notification = require('../models/Notification');
const User = require('../models/User');
const { userSockets } = require('../config/socket');

class NotificationService {
  // Create and send notification
  async sendNotification(userId, type, title, message, data = {}, priority = 'medium') {
    try {
      const notification = new Notification({
        userId,
        type,
        title,
        message,
        data,
        priority,
        isSent: true,
        sentAt: new Date()
      });
      
      await notification.save();
      
      // Send real-time notification via socket if user is online
      const socketId = userSockets.get(userId.toString());
      if (socketId) {
        const io = require('socket.io').of('/');
        io.to(socketId).emit('new_notification', {
          id: notification._id,
          type,
          title,
          message,
          data,
          createdAt: notification.createdAt
        });
      }
      
      return notification;
    } catch (error) {
      console.error('Error sending notification:', error);
      return null;
    }
  }

  // Send bulk notifications
  async sendBulkNotification(userIds, type, title, message, data = {}, priority = 'medium') {
    try {
      const notifications = [];
      
      for (const userId of userIds) {
        const notification = new Notification({
          userId,
          type,
          title,
          message,
          data,
          priority,
          isSent: true,
          sentAt: new Date()
        });
        notifications.push(notification);
      }
      
      await Notification.insertMany(notifications);
      
      // Send real-time notifications to online users
      const io = require('socket.io').of('/');
      for (const userId of userIds) {
        const socketId = userSockets.get(userId.toString());
        if (socketId) {
          io.to(socketId).emit('new_notification', {
            type,
            title,
            message,
            data
          });
        }
      }
      
      return { success: true, count: notifications.length };
    } catch (error) {
      console.error('Error sending bulk notifications:', error);
      return { success: false, error: error.message };
    }
  }

  // Get user notifications
  async getUserNotifications(userId, page = 1, limit = 20, unreadOnly = false) {
    try {
      const query = { userId };
      if (unreadOnly) query.isRead = false;
      
      const notifications = await Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);
      
      const total = await Notification.countDocuments(query);
      const unreadCount = await Notification.countDocuments({ userId, isRead: false });
      
      return {
        success: true,
        data: notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error getting user notifications:', error);
      return { success: false, error: error.message };
    }
  }

  // Mark notification as read
  async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { isRead: true, readAt: new Date() },
        { new: true }
      );
      
      return { success: true, data: notification };
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return { success: false, error: error.message };
    }
  }

  // Mark all notifications as read
  async markAllAsRead(userId) {
    try {
      await Notification.updateMany(
        { userId, isRead: false },
        { isRead: true, readAt: new Date() }
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      return { success: false, error: error.message };
    }
  }

  // Delete notification
  async deleteNotification(notificationId, userId) {
    try {
      await Notification.findOneAndDelete({ _id: notificationId, userId });
      return { success: true };
    } catch (error) {
      console.error('Error deleting notification:', error);
      return { success: false, error: error.message };
    }
  }

  // Send booking confirmation notification
  async sendBookingConfirmation(booking) {
    await this.sendNotification(
      booking.clientId,
      'booking',
      'Booking Confirmed',
      `Your booking #${booking.bookingId} has been confirmed. Worker will arrive on ${booking.serviceDate.toLocaleDateString()}`,
      { bookingId: booking._id, bookingCode: booking.bookingId },
      'high'
    );
    
    await this.sendNotification(
      booking.workerId,
      'booking',
      'New Booking',
      `You have a new booking #${booking.bookingId} on ${booking.serviceDate.toLocaleDateString()}`,
      { bookingId: booking._id, bookingCode: booking.bookingId },
      'high'
    );
  }

  // Send payment confirmation notification
  async sendPaymentConfirmation(payment, user) {
    await this.sendNotification(
      user._id,
      'payment',
      'Payment Confirmed',
      `Your payment of KES ${payment.amount} for booking has been confirmed.`,
      { paymentId: payment._id, amount: payment.amount },
      'high'
    );
  }

  // Send worker payout notification
  async sendPayoutNotification(workerId, amount) {
    await this.sendNotification(
      workerId,
      'payment',
      'Payout Processed',
      `KES ${amount} has been sent to your M-Pesa account.`,
      { amount },
      'high'
    );
  }

  // Send training enrollment notification
  async sendTrainingEnrollment(workerId, courseName) {
    await this.sendNotification(
      workerId,
      'training',
      'Training Enrollment',
      `You have been enrolled in ${courseName}. The company will cover all costs.`,
      { courseName },
      'high'
    );
  }

  // Send verification notification
  async sendVerificationNotification(userId, isApproved, reason = null) {
    if (isApproved) {
      await this.sendNotification(
        userId,
        'verification',
        'Account Verified',
        'Your account has been verified and approved. You can now start using the platform.',
        {},
        'high'
      );
    } else {
      await this.sendNotification(
        userId,
        'verification',
        'Verification Failed',
        `Your account verification failed. Reason: ${reason || 'Please contact support'}`,
        {},
        'high'
      );
    }
  }

  // Send dispute resolution notification
  async sendDisputeResolution(booking, resolution) {
    await this.sendNotification(
      booking.clientId,
      'system',
      'Dispute Resolved',
      `The dispute for booking #${booking.bookingId} has been resolved. Resolution: ${resolution}`,
      { bookingId: booking._id },
      'high'
    );
    
    await this.sendNotification(
      booking.workerId,
      'system',
      'Dispute Resolved',
      `The dispute for booking #${booking.bookingId} has been resolved. Resolution: ${resolution}`,
      { bookingId: booking._id },
      'high'
    );
  }

  // Send reminder notification
  async sendReminder(userId, type, title, message, minutesBefore = 60) {
    const reminderTime = new Date(Date.now() + minutesBefore * 60 * 1000);
    
    // Schedule reminder (implement with node-cron or bull queue)
    setTimeout(async () => {
      await this.sendNotification(userId, type, title, message, {}, 'medium');
    }, minutesBefore * 60 * 1000);
    
    return { success: true, scheduledFor: reminderTime };
  }
}

module.exports = new NotificationService();