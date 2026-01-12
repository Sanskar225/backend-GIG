const express = require('express');
const router = express.Router();

// Import all route files
const authRoutes = require('./authRoutes');
const gigRoutes = require('./gigRoutes');
const bidRoutes = require('./bidRoutes');
const notificationRoutes = require('./notificationRoutes');
const messageRoutes = require('./messageRoutes');

// Use routes
router.use('/auth', authRoutes);
router.use('/gigs', gigRoutes);
router.use('/bids', bidRoutes);
router.use('/notifications', notificationRoutes);
router.use('/messages', messageRoutes);

// API Documentation
router.get('/', (req, res) => {
    res.json({
        message: '🎯 GigFlow API v1.0',
        description: 'Complete Freelance Marketplace Backend',
        status: 'operational',
        timestamp: new Date().toISOString(),
        endpoints: {
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                getMe: 'GET /api/auth/me'
            },
            gigs: {
                getAll: 'GET /api/gigs (with search: ?query=)',
                create: 'POST /api/gigs',
                getSingle: 'GET /api/gigs/:id',
                update: 'PATCH /api/gigs/:id',
                delete: 'DELETE /api/gigs/:id'
            },
            bids: {
                submit: 'POST /api/bids',
                getGigBids: 'GET /api/bids/:gigId',
                hire: 'PATCH /api/bids/:bidId/hire',
                myBids: 'GET /api/bids/my/bids'
            },
            notifications: 'GET /api/notifications',
            messages: 'GET /api/messages'
        },
        features: {
            authentication: 'JWT with HttpOnly cookies',
            realTime: 'Socket.io for instant notifications',
            database: 'MongoDB with transactions',
            validation: 'Joi validation for all inputs'
        }
    });
});

module.exports = router;