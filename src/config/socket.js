const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const Notification = require('../models/Notification');

const userSockets = new Map(); // userId -> socketId
const adminSockets = new Map(); // adminId -> socketId

const setupSocket = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);

    // User joins with their ID
    socket.on('join', async (data) => {
      const { userId, role } = data;
      socket.userId = userId;
      socket.role = role;
      
      if (role === 'admin') {
        adminSockets.set(userId, socket.id);
        socket.join('admin_room');
        console.log(`👑 Admin ${userId} joined admin room`);
      } else {
        userSockets.set(userId, socket.id);
        console.log(`👤 User ${userId} (${role}) connected`);
        
        // Mark user as online in database
        await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
        
        // Join user's personal room for direct messages
        socket.join(`user_${userId}`);
      }
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
      try {
        const { conversationId, senderId, receiverId, content, messageType = 'text' } = data;
        
        // Create message in database
        const message = new Message({
          conversationId,
          senderId,
          receiverId,
          messageType,
          content,
          deliveredAt: new Date()
        });
        
        await message.save();
        
        // Update conversation's last message
        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: {
            text: content,
            senderId,
            timestamp: new Date()
          },
          updatedAt: new Date()
        });
        
        // Update unread count for receiver
        await Conversation.findByIdAndUpdate(conversationId, {
          $inc: { 'participants.$[elem].unreadCount': 1 }
        }, {
          arrayFilters: [{ 'elem.userId': receiverId }]
        });
        
        // Emit to receiver if online
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('new_message', {
            message: {
              _id: message._id,
              conversationId,
              senderId,
              content,
              messageType,
              createdAt: message.createdAt
            }
          });
          
          // Update message as delivered
          await Message.findByIdAndUpdate(message._id, { deliveredAt: new Date() });
        }
        
        // Emit delivery receipt to sender
        const senderSocketId = userSockets.get(senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('message_delivered', {
            messageId: message._id,
            conversationId,
            delivered: !!receiverSocketId
          });
        }
        
        // Notify admin if message contains flagged words (for monitoring)
        const flaggedWords = ['scam', 'fraud', 'illegal', 'harassment'];
        const hasFlagged = flaggedWords.some(word => content.toLowerCase().includes(word));
        
        if (hasFlagged) {
          io.to('admin_room').emit('flagged_message', {
            messageId: message._id,
            conversationId,
            senderId,
            content,
            timestamp: new Date()
          });
        }
        
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicator
    socket.on('typing', async (data) => {
      const { conversationId, userId, isTyping, receiverId } = data;
      
      const receiverSocketId = userSockets.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('user_typing', {
          conversationId,
          userId,
          isTyping
        });
      }
    });

    // Handle marking messages as read
    socket.on('mark_read', async (data) => {
      try {
        const { conversationId, userId, messageIds } = data;
        
        await Message.updateMany(
          { _id: { $in: messageIds }, receiverId: userId },
          { isRead: true, readAt: new Date() }
        );
        
        // Reset unread count for user in conversation
        await Conversation.findByIdAndUpdate(conversationId, {
          $set: { 'participants.$[elem].unreadCount': 0 }
        }, {
          arrayFilters: [{ 'elem.userId': userId }]
        });
        
        // Notify sender that messages were read
        const conversation = await Conversation.findById(conversationId);
        const otherParticipant = conversation.participants.find(p => p.userId.toString() !== userId);
        
        if (otherParticipant) {
          const senderSocketId = userSockets.get(otherParticipant.userId.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit('message_read', {
              conversationId,
              messageIds,
              readBy: userId,
              readAt: new Date()
            });
          }
        }
        
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
      
      if (socket.userId) {
        userSockets.delete(socket.userId);
        
        // Mark user as offline
        await User.findByIdAndUpdate(socket.userId, { 
          isOnline: false, 
          lastSeen: new Date() 
        });
        
        // Notify all conversations that user is offline
        io.emit('user_status_change', {
          userId: socket.userId,
          status: 'offline',
          lastSeen: new Date()
        });
      }
      
      if (socket.role === 'admin') {
        for (const [adminId, socketId] of adminSockets.entries()) {
          if (socketId === socket.id) {
            adminSockets.delete(adminId);
            break;
          }
        }
      }
    });
  });
  
  // Function to emit booking updates
  global.emitBookingUpdate = (bookingId, workerId, clientId, status) => {
    const workerSocketId = userSockets.get(workerId);
    const clientSocketId = userSockets.get(clientId);
    
    if (workerSocketId) {
      io.to(workerSocketId).emit('booking_status_update', { bookingId, status });
    }
    
    if (clientSocketId) {
      io.to(clientSocketId).emit('booking_status_update', { bookingId, status });
    }
    
    // Also notify admin room
    io.to('admin_room').emit('booking_update', { bookingId, workerId, clientId, status });
  };
  
  // Function to emit payment confirmation
  global.emitPaymentConfirmation = (paymentId, userId, amount, status) => {
    const userSocketId = userSockets.get(userId);
    if (userSocketId) {
      io.to(userSocketId).emit('payment_confirmation', { paymentId, amount, status });
    }
    
    io.to('admin_room').emit('payment_notification', { paymentId, userId, amount, status });
  };
};

module.exports = { setupSocket, userSockets, adminSockets };