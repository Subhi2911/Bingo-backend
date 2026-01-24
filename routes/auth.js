const express = require("express");
//const User = require('../models/User');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetchuser = require('../middleware/fetchuser');
const User = require("../models/User");
// const Notification = require("../models/Notification");
// const Chat = require("../models/Chat");

const { getMe } = require("../controllers/auth.controller");

const sendEmail = require("../utils/sendEmail");
let success = false;

//const Notification = require("../models/Notification");
require('dotenv').config({ path: '.env.local' });
const JWT_SECRET = process.env.JWT_SECRET;

// ROUTE 1: Create a user using POST "/api/auth/register"
function generatePlayerId() {
	return Math.random().toString(36).substring(2, 8).toUpperCase();
}
router.post('/register', [
	body('username', 'Enter a valid name').isLength({ min: 3 }),
	body('email', 'Enter a valid email').isEmail(),
	body('password', 'Password must be at least 8 characters').isLength({ min: 8 }),
], async (req, res) => {
	success = false;
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ success, errors: errors.array() });
	}

	try {
		let user = await User.findOne({ email: req.body.email });
		let user_name = await User.findOne({ username: req.body.username });

		if (user) {
			return res.status(400).json({ success, error: "User with this email already exists." });
		}
		if (user_name) {
			return res.status(400).json({ success, error: "User with this username already exists." });
		}

		const salt = await bcrypt.genSalt(10);
		const secPass = await bcrypt.hash(req.body.password, salt);

		user = await User.create({
			username: req.body.username,
			email: req.body.email,
			password: secPass,
			playerId: generatePlayerId()
		});
		//user.playerId = generatePlayerId();

		const data = {
			user: {
				id: user.id
			}
		};

		const authToken = jwt.sign(data, JWT_SECRET);
		success = true;

		res.json({ success, authToken, user });
	} catch (error) {
		console.error(error.message);
		res.status(500).json({ error: "Internal server error", success: false });
	}
});

router.post('/getuser', fetchuser, async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId).select("-password");
		res.send(user);
	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});

router.post('/login', [
	body('email', 'Enter a valid email').isEmail(),
	body('password', 'Password must be at least 8 characters').isLength({ min: 8 }),
], async (req, res) => {
	success = false;
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		const success = false;
		return res.status(400).json({ success, errors: errors.array() });
	}

	const { email, password } = req.body;

	try {
		let user = await User.findOne({ email });
		if (!user) {
			const success = false;
			return res.status(400).json({ success, error: "Invalid credentials" });
		}

		const passwordCompare = await bcrypt.compare(password, user.password);
		if (!passwordCompare) {
			const success = false;
			return res.status(400).json({ success, error: "Invalid credentials" });
		}

		const data = {
			user: {
				id: user.id
			}
		};

		const authToken = jwt.sign(data, JWT_SECRET);
		const success = true;
		res.json({ success, authToken });


	} catch (error) {
		console.error(success, error.message);
		res.status(500).send("Internal server error");
	}
});

// Password Reset Routes
// Step 1: Send OTP
router.post('/forgot-password', async (req, res) => {
	success = false;
	const { email } = req.body;
	const user = await User.findOne({ email });
	if (!user) return res.status(404).json({ error: "User not found", success: success });
	try {
		const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
		const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

		user.otp = otp;
		user.otpExpiry = otpExpiry;
		await user.save();

		await sendEmail(user.email, "Your OTP Code", `Your OTP is: ${otp}`);
		success = true;

		res.json({ message: "OTP sent to your email", success: success });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Internal Server Error', success: success });
	}


});

// Step 2: Verify OTP
router.post('/verify-otp', async (req, res) => {
	success = false;
	const { email, otp } = req.body;
	try {
		const user = await User.findOne({ email });
		if (!user) return res.status(404).json({ error: "User not found" });
		if (user.otp !== otp || user.otpExpiry < Date.now()) {
			return res.status(400).json({ error: "Invalid or expired OTP" });
		}

		user.otpVerified = true;
		await user.save();
		success = true;
		res.json({ message: "OTP verified", success: success });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Internal Server Error', success: success });
	}


});

// Step 3: Reset Password
router.put('/reset-password', async (req, res) => {
	success = false;
	const { email, newPassword } = req.body;
	try {
		const user = await User.findOne({ email });
		if (!user) return res.status(404).json({ error: "User not found" });
		if (!user.otpVerified) {
			return res.status(400).json({ error: "OTP not verified" });
		}

		const hashedPassword = await bcrypt.hash(newPassword, 10);
		user.password = hashedPassword;
		user.otp = null;
		user.otpExpiry = null;
		user.otpVerified = false; // reset flag
		await user.save();

		success = true;
		res.json({ message: "Password changed successfully!", success: success });

	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Internal Server Error', success: success });
	}
});


router.get("/me", fetchuser, getMe);

//get other user info
router.get("/user/:id", async (req, res) => {
	try {
		const userId = req.params.id;
		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}
		console.log("Fetched user:", user);
		res.json(user);
	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});

//sending request
router.post("/send-request/:id", fetchuser, async (req, res) => {
	try {
		let success = false;
		const toUserId = req.params.id;
		console.log("To User ID:", toUserId);
		const fromUserId = req.user.id;
		if (toUserId === fromUserId) {
			return res.status(400).json({ error: "Cannot send friend request to yourself" });
		}
		const toUser = await User.findById(toUserId);
		const fromUser = await User.findById(fromUserId);
		if (!toUser || !fromUser) {
			return res.status(404).json({ error: "User not found" });
		}
		if (toUser.pendingRequests.includes(fromUserId) || fromUser.sentRequests.includes(toUserId)) {
			return res.status(400).json({ error: "Friend request already sent" });
		}
		toUser.pendingRequests.push(fromUserId);
		fromUser.sentRequests.push(toUserId);
		await toUser.save();
		await fromUser.save();
		success = true;
		res.json({ success, message: "Friend request sent" });
	} catch (error) {
		console.log(error.message);
		res.status(500).send("Internal server error");
	}
});

//accepting request
router.post("/accept-request/:id", fetchuser, async (req, res) => {
	try {
		const fromUserId = req.params.id;
		const toUserId = req.user.id;
		const fromUser = await User.findById(fromUserId);
		const toUser = await User.findById(toUserId);

		if (!fromUser || !toUser) {
			return res.status(404).json({ error: "User not found" });
		}
		if (!toUser.pendingRequests.includes(fromUserId)) {
			return res.status(400).json({ error: "No pending friend request from this user" });
		}
		fromUser.pendingRequests = fromUser.pendingRequests.filter(id => id.toString() !== toUserId);
		toUser.sentRequests = toUser.sentRequests.filter(id => id.toString() !== fromUserId);
		toUser.friends.push(fromUserId);
		fromUser.friends.push(toUserId);
		await toUser.save();
		await fromUser.save();
		const safeUser = await User.findById(fromUserId).select(
			'avatar username bio wins money level xp rank friends'
		);
		console.log(res);

		res.json({ safeUser, message: "Friend request accepted" });
	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});

//rejecting request
router.post("/reject-request/:id", fetchuser, async (req, res) => {
	try {
		const fromUserId = req.params.id;
		const toUserId = req.user.id;
		const fromUser = await User.findById(fromUserId);
		const toUser = await User.findById(toUserId);
		if (!fromUser || !toUser) {
			return res.status(404).json({ error: "User not found" });
		}
		if (!fromUser.pendingRequests.includes(toUserId)) {
			return res.status(400).json({ error: "No pending friend request from this user" });
		}
		fromUser.pendingRequests = fromUser.pendingRequests.filter(id => id.toString() !== toUserId);
		toUser.sentRequests = toUser.sentRequests.filter(id => id.toString() !== fromUserId);
		await toUser.save();
		await fromUser.save();
		res.json(fromUser);
	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});

//getFreinds
router.get("/friends", fetchuser, async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId).populate('friends', 'avatar  username  email  date  bio  pendingRequests  sentRequests  wins  money  level  xp  rank');
		res.json(user.friends);

	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});
//getPendingRequests
router.get("/pending-requests", fetchuser, async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId).populate('pendingRequests', 'avatar  username  email  date  bio  friends  sentRequests  wins  money  level  xp   rank');
		res.json(user.pendingRequests);
		console.log("Pending Requests:", user.pendingRequests);
	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});

//remove friend
router.post("/remove-friend/:id", fetchuser, async (req, res) => {
	try {
		const removeUserId = req.params.id;
		const userId = req.user.id;
		const removeUser = await User.findById(removeUserId);
		const user = await User.findById(userId);
		if (!removeUser || !user) {
			return res.status(404).json({ error: "User not found" });
		}
		user.friends = user.friends.filter(id => id.toString() !== removeUserId);
		removeUser.friends = removeUser.friends.filter(id => id.toString() !== userId);
		await user.save();
		await removeUser.save();
		res.json({ message: "Friend removed successfully" });
	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});

// GET /api/auth/search-user?q=TEXT
router.get("/search-user", fetchuser, async (req, res) => {
	try {
		const q = req.query.q;

		if (!q || q.trim().length < 2) {
			return res.json([]);
		}

		const users = await User.find({
			$or: [
				{ playerId: { $regex: q, $options: "i" } },
				{ username: { $regex: q, $options: "i" } }
			]
		})
			.select("username playerId avatar level xp rank")
			.limit(10);

		res.json(users);
	} catch (err) {
		console.error(err.message);
		res.status(500).json({ error: "Server error" });
	}
});
// routes/avatar.js
router.post("/select", fetchuser, async (req, res) => {
	try {
		const { avatar } = req.body;

		if (!avatar) {
			return res.status(400).json({ error: "Avatar is required" });
		}

		const user = await User.findById(req.user.id);

		// ❌ already selected
		if (user.avatarLocked) {
			return res.status(403).json({ error: "Avatar already selected" });
		}

		user.avatar = avatar;
		user.avatarLocked = true;   // lock forever
		await user.save();

		res.json({
			success: true,
			avatar: user.avatar,
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "Server error" });
	}
});


// Export the router (accepts io if needed for future use)
module.exports = router;


