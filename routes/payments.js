// ──────────────────────────────────────────────────────────────────────────────
// routes/payments.js - COMPLETE - Razorpay + Receipts Integration
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const fetchuser = require('../middleware/fetchuser');
const User = require('../models/User');
const Payment = require('../models/Payment');

// ── Initialize Razorpay ───────────────────────────────────────────────────────
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Item rewards mapping ──────────────────────────────────────────────────────
const ITEM_REWARDS = {
    3: { coins: 500, xp: 0, name: 'Coin Pack' },
    4: { coins: 2000, xp: 0, name: 'Mega Coins' },
    6: { coins: 0, xp: 50, name: 'Double XP' },
    9: { coins: 0, xp: 0, name: 'Free Boards', boardsAdd: 1 },
};

// ════════════════════════════════════════════════════════════════════════════
// PAYMENT PROCESSING ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/payments/create-order
 * Create a Razorpay order
 */
router.post('/create-order', fetchuser, async (req, res) => {
    try {
        const { itemId, itemName, amount } = req.body;
        const userId = req.user.id;

        if (!itemId || !itemName || !amount) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        if (!ITEM_REWARDS[itemId]) {
            return res.status(400).json({ message: 'Invalid item ID' });
        }

        if (amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        // Create Razorpay order
        const order = await razorpay.orders.create({
            amount: amount * 100,
            currency: 'INR',
            receipt: `receipt_${userId}_${itemId}_${Date.now()}`,
            notes: {
                userId: userId.toString(),
                itemId: itemId.toString(),
                itemName,
            },
        });

        // Save order to database
        const payment = new Payment({
            userId,
            itemId,
            itemName,
            amount,
            razorpayOrderId: order.id,
            status: 'pending',
        });
        await payment.save();

        res.status(200).json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
        });
    } catch (error) {
        console.error('[Payment] Create order error:', error);
        res.status(500).json({ message: error.message || 'Failed to create order' });
    }
});

/**
 * POST /api/payments/verify-payment
 * Verify Razorpay payment signature and grant rewards
 */
router.post('/verify-payment', fetchuser, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, itemId } = req.body;
        const userId = req.user.id;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ message: 'Missing payment details' });
        }

        // Verify signature
        const hash = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        if (hash !== razorpay_signature) {
            console.error('[Payment] Signature verification failed');
            return res.status(400).json({ message: 'Payment verification failed - invalid signature' });
        }

        const reward = ITEM_REWARDS[itemId];
        if (!reward) {
            return res.status(400).json({ message: 'Invalid item' });
        }

        const paymentRecord = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
        if (!paymentRecord) {
            console.error('[Payment] Payment record not found');
            return res.status(400).json({ message: 'Payment not found' });
        }

        // Check if already processed
        if (paymentRecord.status === 'completed') {
            const user = await User.findById(userId);
            return res.status(200).json({
                success: true,
                message: 'Payment already processed',
                updatedUser: {
                    money: user.money,
                    xp: user.xp,
                    totalBoards: user.totalBoards,
                },
            });
        }

        // Build update data
        const updateData = { $inc: {} };

        if (reward.coins > 0) {
            updateData.$inc.money = reward.coins;
        }
        if (reward.xp > 0) {
            updateData.$inc.xp = reward.xp;
        }
        if (reward.boardsAdd && reward.boardsAdd > 0) {
            updateData.$inc.totalBoards = reward.boardsAdd;
        }


        // Update user
        const user = await User.findByIdAndUpdate(userId, updateData, { new: true });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Update payment record
        await Payment.findByIdAndUpdate(paymentRecord._id, {
            status: 'completed',
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
            completedAt: new Date(),
        });


        res.status(200).json({
            success: true,
            message: 'Payment verified and processed',
            updatedUser: {
                money: user.money,
                xp: user.xp,
                totalBoards: user.totalBoards,
            },
        });
    } catch (error) {
        console.error('[Payment] Verify payment error:', error);
        res.status(500).json({ message: error.message || 'Payment verification failed' });
    }
});

/**
 * POST /api/payments/webhook
 * Razorpay webhook handler
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = req.body.toString();

        const hash = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (hash !== signature) {
            console.error('[Webhook] Invalid signature');
            return res.status(400).json({ message: 'Invalid signature' });
        }

        const event = JSON.parse(body);

        if (event.event === 'payment.authorized') {
            const paymentData = event.payload.payment.entity;
            const orderId = paymentData.order_id;

            const payment = await Payment.findOne({ razorpayOrderId: orderId });
            if (payment) {
                payment.status = 'authorized';
                payment.paymentId = paymentData.id;
                await payment.save();
            }
        }

        if (event.event === 'payment.failed') {
            const paymentData = event.payload.payment.entity;
            const orderId = paymentData.order_id;

            const payment = await Payment.findOne({ razorpayOrderId: orderId });
            if (payment) {
                payment.status = 'failed';
                payment.reason = paymentData.error_reason;
                await payment.save();
            }
        }

        res.status(200).json({ received: true });
    } catch (error) {
        console.error('[Webhook] Error:', error);
        res.status(500).json({ message: 'Webhook processing failed' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// RECEIPT / HISTORY ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/payments/history
 * Get user's payment history with pagination
 */
router.get('/history', fetchuser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20, status } = req.query;

        const query = { userId };
        if (status) {
            query.status = status;
        }

        const payments = await Payment.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        const total = await Payment.countDocuments(query);


        res.status(200).json({
            success: true,
            payments,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('[Receipts] History error:', error);
        res.status(500).json({ message: 'Failed to fetch receipts' });
    }
});

/**
 * GET /api/payments/:receiptId
 * Get single receipt details
 */
router.get('/:receiptId', fetchuser, async (req, res) => {
    try {
        const { receiptId } = req.params;
        const userId = req.user.id;

        const payment = await Payment.findOne({
            _id: receiptId,
            userId,
        }).lean();

        if (!payment) {
            return res.status(404).json({ message: 'Receipt not found' });
        }


        res.status(200).json({
            success: true,
            receipt: payment,
        });
    } catch (error) {
        console.error('[Receipts] Get receipt error:', error);
        res.status(500).json({ message: 'Failed to fetch receipt' });
    }
});

/**
 * GET /api/payments/stats/summary
 * Get payment statistics
 */
router.get('/stats/summary', fetchuser, async (req, res) => {
    try {
        const userId = req.user.id;
        const payments = await Payment.find({ userId }).lean();

        const stats = {
            totalTransactions: payments.length,
            totalSpent: 0,
            completedTransactions: 0,
            failedTransactions: 0,
            pendingTransactions: 0,
            itemsCounts: {},
        };

        payments.forEach(payment => {
            if (payment.status === 'completed') {
                stats.totalSpent += payment.amount || 0;
                stats.completedTransactions += 1;
            } else if (payment.status === 'failed') {
                stats.failedTransactions += 1;
            } else if (payment.status === 'pending') {
                stats.pendingTransactions += 1;
            }

            const itemName = payment.itemName || 'Unknown';
            stats.itemsCounts[itemName] = (stats.itemsCounts[itemName] || 0) + 1;
        });


        res.status(200).json({
            success: true,
            stats,
        });
    } catch (error) {
        console.error('[Receipts] Stats error:', error);
        res.status(500).json({ message: 'Failed to fetch stats' });
    }
});

/**
 * GET /api/payments/download/:receiptId
 * Download receipt as text file
 */
router.get('/download/:receiptId', fetchuser, async (req, res) => {
    try {
        const { receiptId } = req.params;
        const userId = req.user.id;

        const payment = await Payment.findOne({
            _id: receiptId,
            userId,
        }).lean();

        if (!payment) {
            return res.status(404).json({ message: 'Receipt not found' });
        }

        const receiptText = formatReceiptText(payment);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="receipt_${payment.razorpayOrderId}.txt"`
        );
        res.send(receiptText);

    } catch (error) {
        console.error('[Receipts] Download error:', error);
        res.status(500).json({ message: 'Failed to download receipt' });
    }
});

/**
 * GET /api/payments/export/csv
 * Export all receipts as CSV
 */
router.get('/export/csv', fetchuser, async (req, res) => {
    try {
        const userId = req.user.id;
        const payments = await Payment.find({ userId }).sort({ createdAt: -1 }).lean();

        const headers = ['Date', 'Item Name', 'Amount', 'Status', 'Order ID', 'Payment ID'];
        const rows = payments.map(p => [
            new Date(p.createdAt).toLocaleString('en-IN'),
            p.itemName || '',
            p.amount || '',
            p.status || '',
            p.razorpayOrderId || '',
            p.paymentId || '',
        ]);

        const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="bingoing_receipts_${Date.now()}.csv"`
        );
        res.send(csv);
    } catch (error) {
        console.error('[Receipts] Export error:', error);
        res.status(500).json({ message: 'Failed to export receipts' });
    }
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

function formatReceiptText(payment) {
    const date = new Date(payment.createdAt).toLocaleString('en-IN');
    const completedDate = payment.completedAt
        ? new Date(payment.completedAt).toLocaleString('en-IN')
        : 'N/A';

    return `
════════════════════════════════════════════════════════════
                    BINGOING TRANSACTION RECEIPT
════════════════════════════════════════════════════════════

STATUS: ${payment.status.toUpperCase()}
DATE: ${date}

────────────────────────────────────────────────────────────
ITEM DETAILS
────────────────────────────────────────────────────────────
Item Name: ${payment.itemName || 'N/A'}
Item ID: ${payment.itemId || 'N/A'}

────────────────────────────────────────────────────────────
PAYMENT DETAILS
────────────────────────────────────────────────────────────
Amount: ₹${payment.amount || 'N/A'}
Currency: ${payment.currency || 'INR'}
Payment Method: Razorpay

────────────────────────────────────────────────────────────
TRANSACTION IDS
────────────────────────────────────────────────────────────
Order ID: ${payment.razorpayOrderId || 'N/A'}
Payment ID: ${payment.paymentId || 'N/A'}
Signature: ${payment.signature ? payment.signature.slice(0, 30) + '...' : 'N/A'}

────────────────────────────────────────────────────────────
TIMESTAMPS
────────────────────────────────────────────────────────────
Created: ${date}
Completed: ${completedDate}

${payment.status === 'failed' ? `\nError: ${payment.reason || 'N/A'}\n` : ''}
════════════════════════════════════════════════════════════
This receipt is your proof of purchase. Keep it safe.
════════════════════════════════════════════════════════════
`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Extended Stats Endpoint - Add to routes/payments.js
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payments/stats/detailed
 * Get detailed payment statistics with optional time filtering
 * Query params: ?timeRange=all|month|week&groupBy=day|item|status
 */
router.get('/stats/detailed', fetchuser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { timeRange = 'all', groupBy = 'item' } = req.query;

        // Calculate date range
        const now = new Date();
        let startDate = new Date('2000-01-01');

        if (timeRange === 'month') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (timeRange === 'week') {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }

        // Fetch payments for date range
        const payments = await Payment.find({
            userId,
            createdAt: { $gte: startDate },
        }).lean();

        const stats = {
            timeRange,
            totalTransactions: payments.length,
            totalSpent: 0,
            totalCompleted: 0,
            totalFailed: 0,
            totalPending: 0,
            successRate: 0,
            averageTransaction: 0,
            byStatus: {
                completed: { count: 0, amount: 0 },
                pending: { count: 0, amount: 0 },
                failed: { count: 0, amount: 0 },
            },
            byItem: {},
            byDay: {},
            topItems: [],
            dateRange: {
                start: startDate.toISOString(),
                end: now.toISOString(),
            },
        };

        // Process payments
        payments.forEach(payment => {
            const amount = payment.amount || 0;

            // Total
            stats.totalSpent += amount;

            // By status
            if (payment.status === 'completed') {
                stats.totalCompleted += 1;
                stats.byStatus.completed.count += 1;
                stats.byStatus.completed.amount += amount;
            } else if (payment.status === 'pending') {
                stats.totalPending += 1;
                stats.byStatus.pending.count += 1;
                stats.byStatus.pending.amount += amount;
            } else if (payment.status === 'failed') {
                stats.totalFailed += 1;
                stats.byStatus.failed.count += 1;
                stats.byStatus.failed.amount += amount;
            }

            // By item
            const itemName = payment.itemName || 'Unknown';
            if (!stats.byItem[itemName]) {
                stats.byItem[itemName] = { count: 0, amount: 0, status: {} };
            }
            stats.byItem[itemName].count += 1;
            stats.byItem[itemName].amount += amount;
            stats.byItem[itemName].status[payment.status] =
                (stats.byItem[itemName].status[payment.status] || 0) + 1;

            // By day
            const day = new Date(payment.createdAt).toLocaleDateString('en-IN');
            if (!stats.byDay[day]) {
                stats.byDay[day] = { count: 0, amount: 0 };
            }
            stats.byDay[day].count += 1;
            stats.byDay[day].amount += amount;
        });

        // Calculate derived stats
        stats.successRate =
            stats.totalTransactions > 0
                ? Math.round((stats.totalCompleted / stats.totalTransactions) * 100)
                : 0;

        stats.averageTransaction =
            stats.totalCompleted > 0
                ? Math.round(stats.byStatus.completed.amount / stats.totalCompleted)
                : 0;

        // Get top items
        stats.topItems = Object.entries(stats.byItem)
            .map(([name, data]) => ({
                name,
                count: data.count,
                amount: data.amount,
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5);


        res.status(200).json({
            success: true,
            stats,
        });
    } catch (error) {
        console.error('[Stats] Detailed error:', error);
        res.status(500).json({ message: 'Failed to fetch detailed stats' });
    }
});

/**
 * GET /api/payments/stats/trend
 * Get payment trends over time (for charts)
 * Query params: ?period=day|week|month (default: day)
 */
router.get('/stats/trend', fetchuser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { period = 'day', days = 30 } = req.query;

        // Fetch recent payments
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        const payments = await Payment.find({
            userId,
            createdAt: { $gte: startDate },
        }).lean();

        const trend = {};

        // Group by period
        payments.forEach(payment => {
            let key;
            const date = new Date(payment.createdAt);

            if (period === 'day') {
                key = date.toLocaleDateString('en-IN');
            } else if (period === 'week') {
                const week = Math.ceil(date.getDate() / 7);
                key = `Week ${week}`;
            } else if (period === 'month') {
                key = date.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
            }

            if (!trend[key]) {
                trend[key] = {
                    date: key,
                    count: 0,
                    amount: 0,
                    completed: 0,
                    failed: 0,
                    pending: 0,
                };
            }

            trend[key].count += 1;
            trend[key].amount += payment.amount || 0;

            if (payment.status === 'completed') {
                trend[key].completed += 1;
            } else if (payment.status === 'failed') {
                trend[key].failed += 1;
            } else if (payment.status === 'pending') {
                trend[key].pending += 1;
            }
        });

        const trendArray = Object.values(trend).sort((a, b) => {
            return new Date(a.date) - new Date(b.date);
        });


        res.status(200).json({
            success: true,
            period,
            days: parseInt(days),
            trend: trendArray,
        });
    } catch (error) {
        console.error('[Stats] Trend error:', error);
        res.status(500).json({ message: 'Failed to fetch trend data' });
    }
});

/**
 * GET /api/payments/stats/comparison
 * Compare current period with previous period
 */
router.get('/stats/comparison', fetchuser, async (req, res) => {
    try {
        const userId = req.user.id;

        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

        // This month
        const thisMonthPayments = await Payment.find({
            userId,
            createdAt: { $gte: thisMonthStart, $lte: now },
            status: 'completed',
        }).lean();

        const thisMonth = {
            count: thisMonthPayments.length,
            amount: thisMonthPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
        };

        // Last month
        const lastMonthPayments = await Payment.find({
            userId,
            createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd },
            status: 'completed',
        }).lean();

        const lastMonth = {
            count: lastMonthPayments.length,
            amount: lastMonthPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
        };

        // Calculate growth
        const countGrowth =
            lastMonth.count > 0
                ? Math.round(
                    ((thisMonth.count - lastMonth.count) / lastMonth.count) *
                    100
                )
                : thisMonth.count > 0
                    ? 100
                    : 0;

        const amountGrowth =
            lastMonth.amount > 0
                ? Math.round(
                    ((thisMonth.amount - lastMonth.amount) / lastMonth.amount) *
                    100
                )
                : thisMonth.amount > 0
                    ? 100
                    : 0;


        res.status(200).json({
            success: true,
            thisMonth,
            lastMonth,
            growth: {
                count: countGrowth,
                amount: amountGrowth,
            },
        });
    } catch (error) {
        console.error('[Stats] Comparison error:', error);
        res.status(500).json({ message: 'Failed to fetch comparison data' });
    }
});

module.exports = router;