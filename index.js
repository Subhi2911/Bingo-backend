require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const connectToMongo = require('./db');
// const http = require('http');
// const jwt = require('jsonwebtoken');
// const { Server } = require('socket.io');
// const Chat = require('./models/Chat');
// const { Types } = require('mongoose');

const app = express();
const port = 5000;

// Connect to MongoDB
connectToMongo();

// Middleware
app.use(cors({
  origin: ['http://localhost:8081',
    
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// API Routes
app.use('/api/auth', require('./routes/auth'));
// app.use('/api/chat', require('./routes/chat')(io));
// app.use('/api/message', require('./routes/message')(io));
// app.use('/api/notifications', require('./routes/notification'));
app.use('/api/emailverification', require('./routes/emailverification'));


// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
