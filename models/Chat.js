const mongoose = require('mongoose');

const ChatSchema = mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    chatName: {
        type: String,
        default: 'User',
    },
    isGroup: {
        type: Boolean,
        default: false,
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message"
    },

    lastRead: [
        {
            userId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            },
            messageId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Message"
            }
        }
    ],
    avatar: {
        type: String,
        default: 'user', // optional default
    },
    seen: {
        type: Boolean,
        default: false,
    }
}, { timestamps: true });

module.exports = mongoose.model('Chat', ChatSchema);