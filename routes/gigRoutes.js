const express = require('express');
const router = express.Router();
const gigController = require('../controllers/gigController');
const bidController = require('../controllers/bidController');
const { auth } = require('../middleware/auth');

// ✅ A. Public routes (no authentication required)
router.get('/', gigController.getAllGigs); // Browse all open gigs with search

// ✅ B. Protected routes
router.use(auth);

// ✅ Gig Management (CRUD)
router.post('/', gigController.createGig); // POST /api/gigs
router.get('/my-gigs', gigController.getMyGigs); // GET /api/gigs/my-gigs

// ✅ Single gig operations
router.route('/:id')
    .get(gigController.getGig) // GET /api/gigs/:id
    .patch(gigController.updateGig) // PATCH /api/gigs/:id
    .delete(gigController.deleteGig); // DELETE /api/gigs/:id

// ✅ Bid routes
router.post('/:id/bids', bidController.submitBid); // POST /api/gigs/:id/bids

// ✅ Get bids for specific gig (owner only) - matches assignment
router.get('/:id/bids', bidController.getGigBids); // GET /api/gigs/:id/bids

// ✅ Hiring logic
router.patch('/:id/hire', bidController.hireFreelancer); // PATCH /api/gigs/:id/hire

module.exports = router;