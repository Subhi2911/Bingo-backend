const express  = require('express');
const router   = express.Router();
const fetchuser     = require('../middleware/fetchuser');
const User     = require('../models/User');
const checkFrozen = require('../middleware/checkFrozen');

// ─── Valid skin IDs (whitelist to prevent junk data) ─────────────────────────
const VALID_BOARDS = ['classic', 'ocean', 'forest', 'galaxy', 'candy', 'lava'];
const VALID_DAUBS  = ['star', 'flame', 'ice', 'crown', 'thunder', 'skull'];

const BOARD_PRICES = { classic: 0, ocean: 300, forest: 400, galaxy: 600, candy: 500, lava: 800 };
const DAUB_PRICES  = { star: 0, flame: 200, ice: 250, crown: 350, thunder: 450, skull: 700 };

// ─── POST /api/shop/buy-skin ──────────────────────────────────────────────────
// Purchase a board skin or daub style using user.money (game coins)
router.post('/buy-skin', fetchuser, checkFrozen, async (req, res) => {
    try {
        const { skinId, skinType } = req.body;

        // ── Validate skinType ─────────────────────────────────────────────────
        if (!['board', 'daub'].includes(skinType)) {
            return res.status(400).json({ message: 'Invalid skin type' });
        }

        // ── Validate skinId against whitelist ─────────────────────────────────
        const validIds = skinType === 'board' ? VALID_BOARDS : VALID_DAUBS;
        if (!validIds.includes(skinId)) {
            return res.status(400).json({ message: 'Invalid skin ID' });
        }

        // ── Get price from server (never trust client-sent price) ─────────────
        const prices    = skinType === 'board' ? BOARD_PRICES : DAUB_PRICES;
        const price     = prices[skinId];

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // ── Check already owned ───────────────────────────────────────────────
        const ownedField = skinType === 'board' ? 'ownedBoards' : 'ownedDaubs';
        const alreadyOwned = (user[ownedField] || []).includes(skinId);
        if (alreadyOwned) {
            return res.status(400).json({ message: 'Already owned' });
        }

        // ── Check sufficient coins ────────────────────────────────────────────
        if (user.money < price) {
            return res.status(400).json({ message: 'Not enough coins' });
        }

        // ── Apply purchase ────────────────────────────────────────────────────
        user.money -= price;
        user[ownedField] = [...new Set([...(user[ownedField] || []), skinId])];
        await user.save();

        return res.json({
            message: 'Purchase successful',
            user: {
                money:       user.money,
                ownedBoards: user.ownedBoards,
                ownedDaubs:  user.ownedDaubs,
            },
        });

    } catch (err) {
        console.error('buy-skin error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// ─── GET /api/shop/my-skins ───────────────────────────────────────────────────
// Fetch owned skins on app load (so AsyncStorage stays in sync with DB)
router.get('/my-skins', fetchuser, checkFrozen, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('money ownedBoards ownedDaubs');
        if (!user) return res.status(404).json({ message: 'User not found' });

        return res.json({
            money:       user.money,
            ownedBoards: user.ownedBoards || ['classic'],
            ownedDaubs:  user.ownedDaubs  || ['star'],
        });
    } catch (err) {
        console.error('my-skins error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// ─── POST /api/shop/buy-real ──────────────────────────────────────────────────
// Called after successful Razorpay/payment gateway verification
// Grants the reward to the user server-side
// router.post('/buy-real', fetchuser, checkFrozen, async (req, res) => {
//     try {
//         const { itemId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

//         // ── Verify Razorpay signature ─────────────────────────────────────────
//         const crypto = require('crypto');
//         const secret = process.env.RAZORPAY_KEY_SECRET;
//         const expectedSig = crypto
//             .createHmac('sha256', secret)
//             .update(`${razorpayOrderId}|${razorpayPaymentId}`)
//             .digest('hex');

//         if (expectedSig !== razorpaySignature) {
//             return res.status(400).json({ message: 'Payment verification failed' });
//         }

//         // ── Item catalogue (server-side source of truth) ──────────────────────
//         const REAL_ITEMS = {
//             1: { name: 'Coin Pack',     reward: { type: 'coins', value: 500  } },
//             2: { name: 'Mega Coins',    reward: { type: 'coins', value: 2000 } },
//             3: { name: 'Free Daubs',    reward: { type: 'daubs', value: 5    } },
//             4: { name: 'Double XP',     reward: { type: 'xpBoost', value: 1  } },
//             5: { name: 'Instant Claim', reward: { type: 'instantClaim', value: 1 } },
//             6: { name: 'Theme Pack',    reward: { type: 'coins', value: 1000 } },
//         };

//         const item = REAL_ITEMS[itemId];
//         if (!item) return res.status(400).json({ message: 'Invalid item' });

//         const user = await User.findById(req.user.id);
//         if (!user) return res.status(404).json({ message: 'User not found' });

//         // ── Grant reward ──────────────────────────────────────────────────────
//         const { type, value } = item.reward;

//         if (type === 'coins') {
//             user.money = (user.money || 0) + value;

//         } else if (type === 'daubs') {
//             user.extraDaubs = (user.extraDaubs || 0) + value;

//         } else if (type === 'xpBoost') {
//             user.xpBoosts = (user.xpBoosts || 0) + value;

//         } else if (type === 'instantClaim') {
//             user.instantClaims = (user.instantClaims || 0) + value;
//         }

//         // ── Log the transaction ───────────────────────────────────────────────
//         user.purchaseHistory = [
//             ...(user.purchaseHistory || []),
//             {
//                 itemId,
//                 itemName:   item.name,
//                 paymentId:  razorpayPaymentId,
//                 purchasedAt: new Date(),
//             },
//         ];

//         await user.save();

//         return res.json({
//             message: `${item.name} purchased successfully`,
//             user: {
//                 money:         user.money,
//                 extraDaubs:    user.extraDaubs,
//                 xpBoosts:      user.xpBoosts,
//                 instantClaims: user.instantClaims,
//             },
//         });

//     } catch (err) {
//         console.error('buy-real error:', err);
//         res.status(500).json({ message: 'Server error' });
//     }
// });

// ─── POST /api/shop/create-order ─────────────────────────────────────────────
// Creates a Razorpay order — frontend opens payment modal with this
// router.post('/create-order', fetchuser, checkFrozen, async (req, res) => {
//     try {
//         const { itemId } = req.body;

//         const PRICES = { 1: 49, 2: 149, 3: 99, 4: 129, 5: 199, 6: 299 };
//         const amount = PRICES[itemId];
//         if (!amount) return res.status(400).json({ message: 'Invalid item' });

//         const Razorpay = require('razorpay');
//         const razorpay = new Razorpay({
//             key_id:     process.env.RAZORPAY_KEY_ID,
//             key_secret: process.env.RAZORPAY_KEY_SECRET,
//         });

//         const order = await razorpay.orders.create({
//             amount:   amount * 100,   // paise
//             currency: 'INR',
//             receipt:  `receipt_${req.user.id}_${itemId}_${Date.now()}`,
//         });

//         return res.json({ orderId: order.id, amount: order.amount, currency: order.currency });

//     } catch (err) {
//         console.error('create-order error:', err);
//         res.status(500).json({ message: 'Server error' });
//     }
// });

module.exports = router;