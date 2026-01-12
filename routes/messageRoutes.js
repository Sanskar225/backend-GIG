const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

router.use(auth);

// Simple message routes
router.get('/conversations', (req, res) => {
    res.status(200).json({
        status: 'success',
        data: {
            conversations: []
        }
    });
});

module.exports = router;
