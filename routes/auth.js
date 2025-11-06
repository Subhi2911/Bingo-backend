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

// Export the router (accepts io if needed for future use)
module.exports = router;


