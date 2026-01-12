const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        // 1. Get token from header
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        // 2. Check if token exists
        if (!token) {
            return res.status(401).json({
                status: 'error',
                message: 'Please authenticate. No token provided.'
            });
        }

        // 3. Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');

        // 4. Find user
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'User not found.'
            });
        }

        // 5. Attach user to request
        req.user = user;
        next();

    } catch (error) {
        console.error('Auth middleware error:', error.message);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid token. Please authenticate again.'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                status: 'error',
                message: 'Token expired. Please login again.'
            });
        }

        return res.status(401).json({
            status: 'error',
            message: 'Please authenticate.'
        });
    }
};

module.exports = { auth };