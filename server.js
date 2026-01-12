const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

// Import custom modules
const { globalErrorHandler, notFoundHandler } = require('./middleware/errorHandler');
const SocketHandler = require('./sockets/socketHandler');

// Initialize Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = socketIo(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true,
        methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Initialize Socket Handler
const socketHandler = new SocketHandler(io);

// Make io accessible in routes
app.set('io', io);
app.set('socketHandler', socketHandler);

// ========== MIDDLEWARE ORDER IS CRITICAL ==========

// 1. Security middleware FIRST
app.use(helmet());
app.use(compression());

// 2. Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use('/api', limiter);

// 3. Body parsers - THIS MUST COME BEFORE ROUTES!
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// 4. CORS configuration
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 5. Request logging middleware
app.use((req, res, next) => {
    console.log(`${req.method} ${req.originalUrl} - ${new Date().toISOString()}`);
    console.log('Request Body:', req.body); // Add this for debugging
    console.log('Content-Type:', req.headers['content-type']);
    next();
});

// ========== ROUTES COME AFTER PARSERS ==========

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        environment: process.env.NODE_ENV,
        socketConnections: io.engine.clientsCount
    });
});

// Import routes
const authRoutes = require('./routes/authRoutes');
const gigRoutes = require('./routes/gigRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const messageRoutes = require('./routes/messageRoutes');
const bidRoutes = require('./routes/bidRoutes');

// 6. API routes - MUST COME AFTER BODY PARSERS!
app.use('/api/auth', authRoutes);
app.use('/api/gigs', gigRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/bids', bidRoutes);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'GigFlow Backend API',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            gigs: '/api/gigs',
            notifications: '/api/notifications',
            messages: '/api/messages',
            bids: '/api/bids'
        },
        features: {
            realTime: 'Socket.io enabled',
            authentication: 'JWT with HttpOnly cookies',
            database: 'MongoDB with Mongoose'
        }
    });
});

// 404 handler
app.all('*', notFoundHandler);

// Global error handler
app.use(globalErrorHandler);

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gigflow', {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`
    ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
    ┃                    GIGFLOW BACKEND                    ┃
    ┃                   Server is running!                  ┃
    ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
    ┃  🌐 API URL:      http://localhost:${PORT}              ┃
    ┃  📊 Health Check: http://localhost:${PORT}/health        ┃
    ┃  📡 Socket.io:    ws://localhost:${PORT}                ┃
    ┃  🗄️  Database:     ${process.env.MONGODB_URI ? 'Connected' : 'Local'}  ┃
    ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
    `);
});

// Graceful shutdown
const gracefulShutdown = () => {
    console.log('🔄 SIGTERM received. Shutting down gracefully...');
    
    // Close Socket.io connections
    io.close(() => {
        console.log('📡 Socket.io connections closed.');
    });
    
    // Close MongoDB connection
    mongoose.connection.close(false, () => {
        console.log('🗄️  MongoDB connection closed.');
        server.close(() => {
            console.log('🚪 HTTP server closed.');
            process.exit(0);
        });
    });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Export for testing
module.exports = { app, server, io };