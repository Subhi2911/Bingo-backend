module.exports = (io) => {

    io.on("connection", (socket) => {
        console.log("User connected:", socket.id);

        // join room
        socket.on("join_room", (roomCode) => {
            socket.join(roomCode);
        });

        // selecting number
        socket.on("number_selected", ({ number, roomCode }) => {
            io.to(roomCode).emit("update_selected", number);
        });

        socket.on("disconnect", () => {
            console.log("User disconnected:", socket.id);
        });
    });

};
