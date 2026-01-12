const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

router.use(auth);

// Simple notification routes
router.get('/', (req, res) => {
    res.status(200).json({
        status: 'success',
        data: {
            notifications: []
        }
    });
});

module.exports = router;
