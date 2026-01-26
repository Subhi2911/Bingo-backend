const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
    },

    body: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: [
        "PRIVATE_ROOM_INVITE",
        "FRIEND_REQUEST",
        "GROUP_ADD"
      ],
      required: true,
    },

    data: {
      type: Object, // roomCode, gameType, playerCount etc
      default: {},
    },

    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", NotificationSchema);