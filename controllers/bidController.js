const Bid = require('../models/Bid');
const Gig = require('../models/Gig');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const mongoose = require('mongoose');

// ✅ POST /api/bids - Submit bid for a gig (Assignment requirement)
exports.submitBid = catchAsync(async (req, res, next) => {
    const { gigId, message, price, estimatedTime } = req.body;

    // Validate required fields
    if (!gigId || !message || !price || !estimatedTime) {
        return next(new AppError('Please provide gigId, message, price, and estimatedTime', 400));
    }

    // Validate price
    if (price <= 0) {
        return next(new AppError('Price must be greater than 0', 400));
    }

    // Validate estimated time
    if (estimatedTime <= 0) {
        return next(new AppError('Estimated time must be greater than 0', 400));
    }

    // Find the gig
    const gig = await Gig.findById(gigId);
    if (!gig) {
        return next(new AppError('Gig not found', 404));
    }

    // Check if gig is open
    if (gig.status !== 'open') {
        return next(new AppError('This gig is not accepting bids', 400));
    }

    // Check if user is the gig owner
    if (gig.client.toString() === req.user.id) {
        return next(new AppError('You cannot bid on your own gig', 400));
    }

    // Check if user already submitted a bid
    const existingBid = await Bid.findOne({
        gigId,
        freelancerId: req.user.id
    });

    if (existingBid) {
        return next(new AppError('You have already submitted a bid for this gig', 400));
    }

    // Check if bid price is within reasonable range (optional)
    const maxPrice = gig.budget * 2; // Allow bids up to 2x the budget
    if (price > maxPrice) {
        return next(new AppError(`Bid price cannot exceed $${maxPrice} for this gig`, 400));
    }

    // Create bid
    const bid = await Bid.create({
        gigId,
        freelancerId: req.user.id,
        message,
        price,
        estimatedTime,
        status: 'pending'
    });

    // Populate freelancer details
    await bid.populate('freelancerId', 'username profileImage rating skills');

    // Get socket handler for real-time notification
    const socketHandler = req.app.get('socketHandler');
    if (socketHandler) {
        // Send real-time notification to gig owner
        socketHandler.sendProposalNotification(
            gig._id,
            req.user.id,
            gig.client
        );
    }

    // Save notification to database
    await Notification.create({
        user: gig.client,
        type: 'new_bid',
        title: 'New Bid Received',
        message: `${req.user.username} submitted a bid for your gig "${gig.title}"`,
        data: {
            gigId: gig._id,
            bidId: bid._id,
            freelancerId: req.user.id,
            price: price
        },
        isRead: false
    });

    res.status(201).json({
        status: 'success',
        message: 'Bid submitted successfully',
        data: {
            bid
        }
    });
});

// ✅ GET /api/bids/:gigId - Get all bids for a specific gig (Owner only - Assignment requirement)
exports.getGigBids = catchAsync(async (req, res, next) => {
    const { gigId } = req.params;

    // Find the gig
    const gig = await Gig.findById(gigId);
    if (!gig) {
        return next(new AppError('Gig not found', 404));
    }

    // Check if user is the gig owner
    if (gig.client.toString() !== req.user.id) {
        return next(new AppError('You are not authorized to view these bids', 403));
    }

    // Get all bids for this gig with freelancer details
    const bids = await Bid.find({ gigId })
        .populate('freelancerId', 'username profileImage rating skills bio completedGigs')
        .sort({ submittedAt: -1 });

    // Get bid statistics
    const bidStats = {
        total: bids.length,
        pending: bids.filter(bid => bid.status === 'pending').length,
        hired: bids.filter(bid => bid.status === 'hired').length,
        rejected: bids.filter(bid => bid.status === 'rejected').length,
        averagePrice: bids.length > 0 ? 
            (bids.reduce((sum, bid) => sum + bid.price, 0) / bids.length).toFixed(2) : 0
    };

    res.status(200).json({
        status: 'success',
        results: bids.length,
        data: {
            bids,
            gig: {
                _id: gig._id,
                title: gig.title,
                description: gig.description,
                budget: gig.budget,
                status: gig.status,
                client: gig.client
            },
            statistics: bidStats
        }
    });
});

// ✅ PATCH /api/bids/:bidId/hire - The "Hire" logic with Transactional Integrity (Assignment requirement)
exports.hireFreelancer = catchAsync(async (req, res, next) => {
    const { bidId } = req.params;

    // Start MongoDB session for transaction
    const session = await mongoose.startSession();
    
    try {
        let hiredBid;
        let hiredGig;

        await session.withTransaction(async () => {
            // Get socket handler for real-time notifications
            const socketHandler = req.app.get('socketHandler');

            // Find the bid with session
            const bid = await Bid.findById(bidId).session(session);
            if (!bid) {
                throw new AppError('Bid not found', 404);
            }

            // Find the gig with session
            const gig = await Gig.findById(bid.gigId).session(session);
            if (!gig) {
                throw new AppError('Gig not found', 404);
            }

            // Check if user is the gig owner
            if (gig.client.toString() !== req.user.id) {
                throw new AppError('Only the gig owner can hire freelancers', 403);
            }

            // ⭐⭐⭐ CRITICAL: Check if gig is still open (atomic check) ⭐⭐⭐
            if (gig.status !== 'open') {
                throw new AppError('This gig is no longer accepting hires', 400);
            }

            // Check if bid is pending
            if (bid.status !== 'pending') {
                throw new AppError('This bid is no longer available', 400);
            }

            // ⭐⭐⭐ ATOMIC OPERATIONS ⭐⭐⭐
            // 1. Update gig status to assigned
            gig.status = 'assigned';
            gig.freelancer = bid.freelancerId;
            await gig.save({ session });

            // 2. Mark selected bid as hired
            bid.status = 'hired';
            bid.hiredAt = new Date();
            await bid.save({ session });

            // 3. Mark all other bids for this gig as rejected (atomic)
            await Bid.updateMany(
                {
                    gigId: bid.gigId,
                    _id: { $ne: bid._id },
                    status: 'pending'
                },
                {
                    $set: {
                        status: 'rejected',
                        rejectedAt: new Date()
                    }
                },
                { session }
            );

            // Store for response
            hiredBid = bid;
            hiredGig = gig;

            // ⭐⭐⭐ REAL-TIME NOTIFICATION (will be sent after transaction commit) ⭐⭐⭐
            if (socketHandler) {
                // Store data for notification after transaction
                req.hireData = {
                    gigId: gig._id,
                    freelancerId: bid.freelancerId,
                    clientId: req.user.id,
                    gigTitle: gig.title,
                    clientName: req.user.username
                };
            }
        });

        // ✅ Transaction successfully committed
        
        // Populate data for response
        await hiredBid.populate('freelancerId', 'username profileImage rating');
        await hiredGig.populate('freelancer', 'username profileImage');

        // ⭐⭐⭐ SEND REAL-TIME NOTIFICATION (Bonus 2) ⭐⭐⭐
        const socketHandler = req.app.get('socketHandler');
        if (socketHandler && req.hireData) {
            await socketHandler.sendHireNotification(
                req.hireData.gigId,
                req.hireData.freelancerId,
                req.hireData.clientId
            );
        }

        // Create database notification for freelancer
        await Notification.create({
            user: hiredBid.freelancerId,
            type: 'hired',
            title: '🎉 You\'ve Been Hired!',
            message: `Congratulations! You have been hired for "${hiredGig.title}"`,
            data: {
                gigId: hiredGig._id,
                gigTitle: hiredGig.title,
                clientId: req.user.id,
                bidId: hiredBid._id,
                price: hiredBid.price
            },
            isRead: false
        });

        // Send success response
        res.status(200).json({
            status: 'success',
            message: 'Freelancer hired successfully!',
            data: {
                gig: hiredGig,
                bid: hiredBid,
                notification: {
                    message: 'Real-time notification sent to freelancer',
                    type: 'hire_confirmation'
                }
            }
        });

    } catch (error) {
        // Abort transaction on error
        await session.abortTransaction();
        next(error);
    } finally {
        // End session
        session.endSession();
    }
});

// ✅ GET /api/bids/my/bids - Get current user's bids (Additional useful endpoint)
// ✅ GET /api/bids/my/bids - Get current user's bids (Additional useful endpoint)
exports.getMyBids = catchAsync(async (req, res, next) => {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // ✅ FIX: Convert req.user.id to ObjectId
    const freelancerObjectId = new mongoose.Types.ObjectId(req.user.id);

    // Build query
    const query = { freelancerId: freelancerObjectId };
    if (status && ['pending', 'hired', 'rejected'].includes(status)) {
        query.status = status;
    }

    // Get user's bids with pagination
    const bids = await Bid.find(query)
        .populate({
            path: 'gigId',
            select: 'title description budget status client category',
            populate: {
                path: 'client',
                select: 'username profileImage rating'
            }
        })
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    // Get total count
    const total = await Bid.countDocuments(query);

    // Calculate statistics
    const allBids = await Bid.find({ freelancerId: freelancerObjectId });
    const stats = {
        total: allBids.length,
        pending: allBids.filter(b => b.status === 'pending').length,
        hired: allBids.filter(b => b.status === 'hired').length,
        rejected: allBids.filter(b => b.status === 'rejected').length,
        successRate: allBids.length > 0
            ? ((allBids.filter(b => b.status === 'hired').length / allBids.length) * 100).toFixed(1)
            : 0,
        totalEarned: allBids
            .filter(b => b.status === 'hired')
            .reduce((sum, bid) => sum + bid.price, 0)
    };

    res.status(200).json({
        status: 'success',
        results: bids.length,
        data: {
            bids,
            statistics: stats
        },
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
        }
    });
});


// ✅ GET /api/bids/:id - Get single bid
exports.getBid = catchAsync(async (req, res, next) => {
    const { id } = req.params;

    const bid = await Bid.findById(id)
        .populate('freelancerId', 'username profileImage rating skills bio')
        .populate({
            path: 'gigId',
            select: 'title description budget status client category',
            populate: {
                path: 'client',
                select: 'username profileImage rating'
            }
        });

    if (!bid) {
        return next(new AppError('Bid not found', 404));
    }

    // Check permissions
    const gig = await Gig.findById(bid.gigId);
    if (req.user.id !== bid.freelancerId.toString() && req.user.id !== gig.client.toString()) {
        return next(new AppError('You are not authorized to view this bid', 403));
    }

    res.status(200).json({
        status: 'success',
        data: {
            bid
        }
    });
});

// ✅ PATCH /api/bids/:id - Update bid (only pending bids can be updated)
exports.updateBid = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const { message, price, estimatedTime } = req.body;

    // Find the bid
    const bid = await Bid.findById(id);
    if (!bid) {
        return next(new AppError('Bid not found', 404));
    }

    // Check if user is the bid owner
    if (bid.freelancerId.toString() !== req.user.id) {
        return next(new AppError('You can only update your own bids', 403));
    }

    // Check if bid can be modified (only pending bids)
    if (bid.status !== 'pending') {
        return next(new AppError('Only pending bids can be updated', 400));
    }

    // Check if gig is still open
    const gig = await Gig.findById(bid.gigId);
    if (gig.status !== 'open') {
        return next(new AppError('Cannot update bid for a closed gig', 400));
    }

    // Update bid fields
    if (message !== undefined) bid.message = message;
    if (price !== undefined) bid.price = price;
    if (estimatedTime !== undefined) bid.estimatedTime = estimatedTime;

    await bid.save();

    // Populate updated bid
    await bid.populate('freelancerId', 'username profileImage rating');

    res.status(200).json({
        status: 'success',
        message: 'Bid updated successfully',
        data: {
            bid
        }
    });
});

// ✅ DELETE /api/bids/:id - Delete/withdraw bid
exports.deleteBid = catchAsync(async (req, res, next) => {
    const { id } = req.params;

    // Find the bid
    const bid = await Bid.findById(id);
    if (!bid) {
        return next(new AppError('Bid not found', 404));
    }

    // Check if user is the bid owner
    if (bid.freelancerId.toString() !== req.user.id) {
        return next(new AppError('You can only delete your own bids', 403));
    }

    // Check if bid can be deleted (only pending bids)
    if (bid.status !== 'pending') {
        return next(new AppError('Only pending bids can be deleted', 400));
    }

    // Check if gig is still open
    const gig = await Gig.findById(bid.gigId);
    if (gig.status !== 'open') {
        return next(new AppError('Cannot delete bid for a closed gig', 400));
    }

    // Delete the bid
    await Bid.findByIdAndDelete(id);

    res.status(200).json({
        status: 'success',
        message: 'Bid deleted successfully',
        data: null
    });
});

// ✅ GET /api/bids/gig/:gigId/check - Check if user has already bid on a gig
exports.checkUserBid = catchAsync(async (req, res, next) => {
    const { gigId } = req.params;

    const bid = await Bid.findOne({
        gigId,
        freelancerId: req.user.id
    });

    res.status(200).json({
        status: 'success',
        data: {
            hasBid: !!bid,
            bid: bid || null
        }
    });
});
