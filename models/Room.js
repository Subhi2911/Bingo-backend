const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
    {
        code: String,
        players: [
            {
                userId: {
                    type: mongoose.Schema.Types.ObjectId,
                    required: true
                },
                username: String,
                avatar: String
            }
        ],
        status: { type: String, default: "waiting" },
        turn: Number,
        selected: [Number],
        gameType: { type: String, default: 'Classic' },
        winner: {
            userId: {
                type: mongoose.Schema.Types.ObjectId,
                required: false
            },
            username: String,
            avatar: String
        }
    },
    { timestamps: true }
);


module.exports = mongoose.model("Room", roomSchema);