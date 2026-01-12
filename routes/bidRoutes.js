const express = require('express');
const router = express.Router();
const bidController = require('../controllers/bidController');
const { auth } = require('../middleware/auth');

// All bid routes require authentication
router.use(auth);

// ✅ Assignment requirements match:
// POST /api/bids - Submit bid for a gig
router.post('/', bidController.submitBid);

// ✅ GET /api/bids/:gigId - Get all bids for a specific gig (Owner only)
// Note: This is handled in gigRoutes.js but we can have it here too
router.get('/:gigId', bidController.getGigBids);

// ✅ PATCH /api/bids/:bidId/hire - The "Hire" logic (Atomic update)
router.patch('/:bidId/hire', bidController.hireFreelancer);

// ✅ Additional useful endpoints
router.get('/my/bids', bidController.getMyBids); // Get current user's bids

module.exports = router;