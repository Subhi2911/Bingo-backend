const router = require("express").Router();
const Chat = require("../models/Chat");
const { encrypt, decrypt } = require("../utils/encryption");

//get user chats
router.get("/user/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        let chats = await Chat.find({ participants: userId })
            .populate('participants', 'username avatar bio')
            .populate({
                path: "lastMessage",
                populate: {
                    path: "sender",
                    select: "username"
                }
            }).lean();
        chats = chats.map(chat => {
            if (chat.lastMessage?.text) {
                chat.lastMessage.text = decrypt(chat.lastMessage.text);
            }
            return chat;
        });
        res.status(200).json(chats);
    } catch (err) {
        res.status(500).json(err);
    }
});

//create chat

router.post("/findOrCreate", async (req, res) => {
    try {
        const { userId1, userId2, chatName } = req.body; // current user & the other user

        // 1. Check if a chat between them already exists
        let chat = await Chat.findOne({
            isGroup: false,
            participants: { $all: [userId1, userId2], $size: 2 },

        });

        // 2. If chat doesn't exist, create it
        if (!chat) {
            chat = new Chat({
                participants: [userId1, userId2],
                isGroup: false,
                chatName: chatName || 'User',
            });
            await chat.save();
        }

        res.status(200).json(chat); // return chat info
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

//get chat by chatId
router.get("/:chatId", async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const chat = await Chat.findById(chatId)
            .populate("participants", "username avatar")
            .populate({
                path: "lastMessage",
                populate: {
                    path: "sender",
                    select: "username"
                }
            })
            .sort({ updatedAt: -1 });
        res.status(200).json(chat);
    } catch (err) {
        res.status(500).json(err);
    }
});

module.exports = router;