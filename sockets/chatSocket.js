module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Chat room joining
    socket.on("joinChat", (chatId) => {
      socket.join(chatId);
      console.log(`Socket ${socket.id} joined chat ${chatId}`);
    });

    // Sending messages
    socket.on("sendMessage", (message) => {
      const { chatId } = message;
      socket.to(chatId).emit("receiveMessage", message); // broadcast to others
    });

    // Game room logic stays separate
    socket.on("join_room", (roomCode) => {
      socket.join(roomCode);
    });

    
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });
};
