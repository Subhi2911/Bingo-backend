const router = require("express").Router();
const Message = require("../models/Messages");
const Chat = require("../models/Chat");
const { encrypt, decrypt } = require("../utils/encryption");


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
        console.log('huhu')
        const { chatId, sender, text } = req.body;
        console.log(req.body);
        const encryptedText = encrypt(text);

        const message = new Message({
            chatId,
            sender: sender,
            text: encryptedText,
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
            text: decrypt(saved.text),
        };
        console.log("Message sent:", responseMessage);
        res.status(201).json(responseMessage);

        //console.log(res);
    } catch (err) {
        res.status(500).json(err);
        console.log(err);
    }
});


module.exports = router;
