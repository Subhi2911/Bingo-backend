const router = require("express").Router();
const Message = require("../models/Messages");
const Chat = require("../models/Chat");
const { encrypt, decrypt } = require("../utils/encryption");
const Notification = require("../models/Notification");



// get messages of a chat
router.get("/:chatId", async (req, res) => {
    try {
        const messages = await Message.find({ chatId: req.params.chatId })
            .populate("sender", "username avatar")
            .sort({ createdAt: 1 });
        // Decrypt messages before sending to frontend
        for (let i = 0; i < messages.length; i++) {
            messages[i].text = decrypt(messages[i].text);
        }

        res.status(200).json(messages); // [] if none
    } catch (err) {
        res.status(500).json(err);
    }
});



// SEND MESSAGE
router.post("/", async (req, res) => {
    try {
        const io = req.app.get("io");
        const onlineUsers = req.app.get("onlineUsers") || {};
        console.log('huhu')
        const { chatId, sender, text, type } = req.body;
        console.log(req.body);
        const encryptedText = encrypt(text);

        const message = new Message({
            chatId,
            sender: sender,
            text: encryptedText,
            type: type || ''
        });
        await Chat.findByIdAndUpdate(chatId, {
            lastMessage: message._id,
            $set: {
                "lastRead.$[elem].messageId": message._id
            }
        }, {
            arrayFilters: [{ "elem.userId": sender }]
        });

        const saved = await message.save();
        await saved.populate("sender", "username avatar");

        // decrypt before sending to frontend
        const responseMessage = {
            ...saved.toObject(),
            text: type === 'private_room_invite' ? saved.text : decrypt(saved.text),
        };
        let roomCode, gameType, playerCount;


        if (type === "private_room_invite") {
            const codeMatch = text.match(/Room Code:\s*(\w+)/);
            const gameMatch = text.match(/GameType:\s*(.+)/);
            const playerMatch = text.match(/Total Players:\s*(\d+)/);


            roomCode = codeMatch?.[1];
            gameType = gameMatch?.[1];
            playerCount = playerMatch?.[1];
        }
        const chat = await Chat.findById(chatId).populate("participants", "_id username");
        const receiver = chat.participants.find(
            (u) => u._id.toString() !== sender
        );
        if (type === "private_room_invite") {
            const notification = await Notification.create({
                user: receiver._id,
                title: type === 'private_room_invite' ? `Private Room Invite 🎮` : `New message from ${saved.sender.username}`,
                body: `${saved.sender.username} invited you to a private room.`,
                type: "PRIVATE_ROOM_INVITE",
                data: {
                    roomCode,
                    gameType,
                    playerCount,
                    chatId,
                },
                read: false

            });

            // Emit to online user only (optional, for live update in drawer)
            const receiverSocketId = onlineUsers[receiver._id];
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("newNotification", notification);
                console.log("✅ Notification emitted to online user", receiver._id);
            } else {
                console.log("⚠️ User offline, notification saved in DB:", receiver._id);
            }
        }
        console.log("Message sent:", responseMessage);
        res.status(201).json(responseMessage);

        //console.log(res);
    } catch (err) {
        res.status(500).json(err);
        console.log(err);
    }
});


module.exports = router;
