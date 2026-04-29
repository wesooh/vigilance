// Helper functions for socket events

const emitToUser = (io, userSockets, userId, event, data) => {
  const socketId = userSockets.get(userId);
  if (socketId) {
    io.to(socketId).emit(event, data);
    return true;
  }
  return false;
};

const emitToMultipleUsers = (io, userSockets, userIds, event, data) => {
  let sent = 0;
  for (const userId of userIds) {
    const socketId = userSockets.get(userId);
    if (socketId) {
      io.to(socketId).emit(event, data);
      sent++;
    }
  }
  return sent;
};

const emitToAdmins = (io, adminSockets, event, data) => {
  for (const [adminId, socketId] of adminSockets.entries()) {
    io.to(socketId).emit(event, data);
  }
};

module.exports = { emitToUser, emitToMultipleUsers, emitToAdmins };