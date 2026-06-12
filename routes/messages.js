// routes/messages.js
const router  = require("express").Router();
const Message = require("../models/Messages");
const Chat    = require("../models/Chat");
const { encrypt, decrypt } = require("../utils/encryption");
const Notification = require("../models/Notification");

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/messages/:chatId?page=1&limit=8
//
// Returns messages newest-first (for pagination prepend on frontend).
// page=1 → the LATEST 8 messages
// page=2 → the 8 before those, etc.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:chatId", async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.max(1, parseInt(req.query.limit) || 8);
        const skip  = (page - 1) * limit;

        // Sort descending → newest first, then skip/limit, then re-sort ascending
        // so the frontend just needs to reverse() once per page
        const messages = await Message.find({ chatId: req.params.chatId })
            .populate("sender", "username avatar")
            .sort({ createdAt: -1 })   // newest first for pagination
            .skip(skip)
            .limit(limit);

        // Decrypt
        const decrypted = messages.map(m => ({
            ...m.toObject(),
            text: (() => {
                try { return decrypt(m.text); }
                catch { return m.text; }
            })(),
        }));

        // Still newest-first; frontend reverses to get oldest-first display order
        res.status(200).json(decrypted);
    } catch (err) {
        console.error("GET messages error:", err);
        res.status(500).json({ message: "Failed to fetch messages" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/messages/
// Send a new message
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
    try {
        const io          = req.app.get("io");
        const onlineUsers = req.app.get("onlineUsers") || {};
        const { chatId, sender, text, type } = req.body;

        const encryptedText = encrypt(text);

        const message = new Message({
            chatId,
            sender,
            text: encryptedText,
            type: type || "",
            seenBy: [sender],   // sender has always "seen" their own message
        });

        // Update chat's lastMessage + lastRead for sender
        await Chat.findByIdAndUpdate(chatId, {
            lastMessage: message._id,
            $set: { "lastRead.$[elem].messageId": message._id },
        }, {
            arrayFilters: [{ "elem.userId": sender }],
        });

        const saved = await message.save();
        await saved.populate("sender", "username avatar");

        const responseMessage = {
            ...saved.toObject(),
            text: type === "private_room_invite" ? saved.text : decrypt(saved.text),
        };

        // ── Private room invite notification ──────────────────────────────
        if (type === "private_room_invite") {
            const roomCode   = text.match(/Room Code:\s*(\w+)/)?.[1];
            const gameType   = text.match(/GameType:\s*(.+)/)?.[1];
            const playerCount = text.match(/Total Players:\s*(\d+)/)?.[1];

            const chat     = await Chat.findById(chatId).populate("participants", "_id username");
            const receiver = chat.participants.find(u => u._id.toString() !== sender);

            if (receiver) {
                const notification = await Notification.create({
                    user: receiver._id,
                    title: "Private Room Invite 🎮",
                    body: `${saved.sender.username} invited you to a private room.`,
                    type: "PRIVATE_ROOM_INVITE",
                    data: { roomCode, gameType, playerCount, chatId },
                    read: false,
                });

                const receiverSocketId = onlineUsers[receiver._id.toString()];
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit("newNotification", notification);
                }
            }
        }

        res.status(201).json(responseMessage);
    } catch (err) {
        console.error("POST message error:", err);
        res.status(500).json({ message: "Failed to send message" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/messages/seen
// Mark a message as seen by a user
// Body: { messageId, userId, chatId }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/seen", async (req, res) => {
    try {
        const { messageId, userId, chatId } = req.body;
        if (!messageId || !userId) return res.status(400).json({ message: "Missing fields" });

        // $addToSet prevents duplicate userId entries in seenBy
        const updated = await Message.findByIdAndUpdate(
            messageId,
            { $addToSet: { seenBy: userId } },
            { new: true }
        );

        if (!updated) return res.status(404).json({ message: "Message not found" });

        // Update chat lastRead for this user
        if (chatId) {
            await Chat.findByIdAndUpdate(chatId, {
                $set: { "lastRead.$[elem].messageId": messageId },
            }, {
                arrayFilters: [{ "elem.userId": userId }],
            });
        }

        res.status(200).json({ success: true, seenBy: updated.seenBy });
    } catch (err) {
        console.error("POST seen error:", err);
        res.status(500).json({ message: "Failed to mark as seen" });
    }
});

module.exports = router;