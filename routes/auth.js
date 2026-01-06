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
			password: secPass
		});

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

// Export the router (accepts io if needed for future use)
module.exports = router;


