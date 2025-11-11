const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
    code: String,
    players: [
        {
            id: String,
            username: String,
            avatar: String
        }
    ],
    status: { type: String, default: "waiting" },
    turn: Number,
    selected: [Number]
});

module.exports = mongoose.model("Room", roomSchema);