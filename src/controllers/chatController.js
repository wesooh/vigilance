const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const Booking = require('../models/Booking');

// Get all conversations for a user
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const conversations = await Conversation.find({
      'participants.userId': userId,
      isActive: true
    })
      .populate('participants.userId', 'firstName lastName profilePicture role')
      .populate('bookingId', 'bookingId status serviceDate')
      .sort({ updatedAt: -1 });
    
    // Format conversations
    const formattedConversations = conversations.map(conv => {
      const otherParticipant = conv.participants.find(p => p.userId._id.toString() !== userId.toString());
      const currentUser = conv.participants.find(p => p.userId._id.toString() === userId.toString());
      
      return {
        conversationId: conv._id,
        withUser: {
          id: otherParticipant.userId._id,
          name: `${otherParticipant.userId.firstName} ${otherParticipant.userId.lastName}`,
          profilePicture: otherParticipant.userId.profilePicture,
          role: otherParticipant.userId.role
        },
        booking: conv.bookingId ? {
          id: conv.bookingId._id,
          code: conv.bookingId.bookingId,
          status: conv.bookingId.status,
          date: conv.bookingId.serviceDate
        } : null,
        lastMessage: conv.lastMessage,
        unreadCount: currentUser.unreadCount,
        updatedAt: conv.updatedAt
      };
    });
    
    res.status(200).json({
      success: true,
      data: formattedConversations
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get messages for a conversation
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user._id;
    
    // Verify user is part of conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      'participants.userId': userId
    });
    
    if (!conversation) {
      return res.status(403).json({ success: false, message: 'Access denied to this conversation' });
    }
    
    const messages = await Message.find({
      conversationId,
      isDeleted: false,
      deletedFor: { $ne: userId }
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Message.countDocuments({
      conversationId,
      isDeleted: false,
      deletedFor: { $ne: userId }
    });
    
    // Mark messages as read
    const unreadMessages = messages.filter(m => 
      m.receiverId.toString() === userId.toString() && !m.isRead
    );
    
    if (unreadMessages.length > 0) {
      await Message.updateMany(
        { _id: { $in: unreadMessages.map(m => m._id) } },
        { isRead: true, readAt: new Date() }
      );
      
      // Reset unread count in conversation
      await Conversation.updateOne(
        { _id: conversationId, 'participants.userId': userId },
        { $set: { 'participants.$.unreadCount': 0, 'participants.$.lastReadAt': new Date() } }
      );
    }
    
    res.status(200).json({
      success: true,
      data: messages.reverse(),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Send a message (HTTP fallback, but Socket.io is preferred)
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, receiverId, content, messageType = 'text', attachmentUrl } = req.body;
    const senderId = req.user._id;
    
    let conversation = null;
    
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
      }
    } else {
      // Create new conversation
      conversation = new Conversation({
        participants: [
          { userId: senderId, role: req.user.role, unreadCount: 0 },
          { userId: receiverId, role: 'client', unreadCount: 0 }
        ],
        isActive: true
      });
      await conversation.save();
    }
    
    // Create message
    const message = new Message({
      conversationId: conversation._id,
      senderId,
      receiverId,
      messageType,
      content,
      attachmentUrl,
      deliveredAt: new Date()
    });
    
    await message.save();
    
    // Update conversation's last message
    conversation.lastMessage = {
      text: content,
      senderId,
      timestamp: new Date()
    };
    conversation.updatedAt = new Date();
    
    // Increment unread count for receiver
    const receiverIndex = conversation.participants.findIndex(
      p => p.userId.toString() === receiverId.toString()
    );
    if (receiverIndex !== -1) {
      conversation.participants[receiverIndex].unreadCount += 1;
    }
    
    await conversation.save();
    
    // Populate sender info
    await message.populate('senderId', 'firstName lastName profilePicture');
    
    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        message,
        conversationId: conversation._id
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Delete message (for user)
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;
    
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    // Add user to deletedFor array
    if (!message.deletedFor.includes(userId)) {
      message.deletedFor.push(userId);
      await message.save();
    }
    
    res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get unread messages count
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const conversations = await Conversation.find({
      'participants.userId': userId
    });
    
    let totalUnread = 0;
    conversations.forEach(conv => {
      const userParticipant = conv.participants.find(p => p.userId.toString() === userId.toString());
      if (userParticipant) {
        totalUnread += userParticipant.unreadCount;
      }
    });
    
    res.status(200).json({
      success: true,
      data: { unreadCount: totalUnread }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Start conversation with worker (for client)
exports.startConversation = async (req, res) => {
  try {
    const { workerId, bookingId } = req.body;
    const clientId = req.user._id;
    
    // Check if conversation already exists
    let conversation = await Conversation.findOne({
      'participants.userId': { $all: [clientId, workerId] }
    });
    
    if (!conversation) {
      conversation = new Conversation({
        participants: [
          { userId: clientId, role: 'client', unreadCount: 0 },
          { userId: workerId, role: 'worker', unreadCount: 0 }
        ],
        bookingId: bookingId || null,
        isActive: true
      });
      await conversation.save();
    }
    
    res.status(201).json({
      success: true,
      data: {
        conversationId: conversation._id,
        isNew: !conversation.lastMessage
      }
    });
  } catch (error) {
    console.error('Start conversation error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};