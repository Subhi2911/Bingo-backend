const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
    code: String,
    players: [String], // user IDs
    status: { type: String, default: "waiting" },
    turn: Number,
    selected: [Number]
});

module.exports = mongoose.model("Room", roomSchema);