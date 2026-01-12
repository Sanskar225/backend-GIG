const Gig = require('../models/Gig');
const Bid = require('../models/Bid');
const User = require('../models/User');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { createGigSchema } = require('../validators/gigValidator');
const mongoose = require('mongoose');

// ============================================
// ✅ GET ALL GIGS (Assignment Requirement)
// GET /api/gigs - Fetch all open gigs with search query
// ============================================
exports.getAllGigs = catchAsync(async (req, res, next) => {
    console.log('🔍 Fetching gigs with filters:', req.query);
    
    const { 
        query, 
        category, 
        minBudget, 
        maxBudget, 
        status = 'open', 
        page = 1, 
        limit = 20,
        sortBy = 'createdAt',
        sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = { status };

    // Text search (using MongoDB text index)
    if (query && query.trim()) {
        filter.$text = { $search: query };
        console.log(`   Searching for: "${query}"`);
    }

    // Category filter
    if (category && category !== 'all') {
        filter.category = category;
        console.log(`   Category: ${category}`);
    }

    // Budget filter
    if (minBudget || maxBudget) {
        filter.budget = {};
        if (minBudget) {
            filter.budget.$gte = Number(minBudget);
            console.log(`   Min budget: $${minBudget}`);
        }
        if (maxBudget) {
            filter.budget.$lte = Number(maxBudget);
            console.log(`   Max budget: $${maxBudget}`);
        }
    }

    // Skills filter
    if (req.query.skills) {
        const skills = Array.isArray(req.query.skills) 
            ? req.query.skills 
            : req.query.skills.split(',');
        filter.skillsRequired = { $in: skills };
        console.log(`   Skills: ${skills.join(', ')}`);
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with population
    const gigs = await Gig.find(filter)
        .populate('client', 'username profileImage rating')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

    // Get total count for pagination
    const total = await Gig.countDocuments(filter);

    // Get bid counts for each gig
    const gigsWithBidCounts = await Promise.all(
        gigs.map(async (gig) => {
            const bidCount = await Bid.countDocuments({ 
                gigId: gig._id, 
                status: 'pending' 
            });
            return {
                ...gig,
                bidCount,
                daysRemaining: Math.max(0, Math.ceil((new Date(gig.deadline) - new Date()) / (1000 * 60 * 60 * 24)))
            };
        })
    );

    console.log(`✅ Found ${gigs.length} gigs`);

    res.status(200).json({
        status: 'success',
        results: gigs.length,
        data: {
            gigs: gigsWithBidCounts
        },
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// ============================================
// ✅ GET SINGLE GIG
// GET /api/gigs/:id
// ============================================
exports.getGig = catchAsync(async (req, res, next) => {
    console.log('📄 Fetching gig:', req.params.id);
    
    const gig = await Gig.findById(req.params.id)
        .populate('client', 'username profileImage rating bio')
        .populate('freelancer', 'username profileImage rating skills')
        .lean();

    if (!gig) {
        console.log('❌ Gig not found:', req.params.id);
        return next(new AppError('Gig not found', 404));
    }

    // Get bid statistics
    const bidStats = await Bid.aggregate([
        { $match: { gigId: gig._id } },
        {
            $group: {
                _id: null,
                totalBids: { $sum: 1 },
                avgPrice: { $avg: '$price' },
                minPrice: { $min: '$price' },
                maxPrice: { $max: '$price' }
            }
        }
    ]);

    // Get pending bids count
    const pendingBids = await Bid.countDocuments({ 
        gigId: gig._id, 
        status: 'pending' 
    });

    // Increment view count
    await Gig.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });

    // Check permissions
    const canEdit = req.user && gig.client._id.toString() === req.user.id;
    const canBid = req.user && 
                   gig.status === 'open' && 
                   gig.client._id.toString() !== req.user.id &&
                   req.user.role !== 'client';

    // Check if user has already bid
    let userBid = null;
    if (req.user && canBid) {
        userBid = await Bid.findOne({
            gigId: gig._id,
            freelancerId: req.user.id
        });
    }

    const enhancedGig = {
        ...gig,
        bidStats: bidStats[0] || { totalBids: 0, avgPrice: 0, minPrice: 0, maxPrice: 0 },
        pendingBids,
        canEdit,
        canBid: canBid && !userBid,
        hasBid: !!userBid,
        userBid,
        daysRemaining: Math.max(0, Math.ceil((new Date(gig.deadline) - new Date()) / (1000 * 60 * 60 * 24))),
        isUrgent: Math.ceil((new Date(gig.deadline) - new Date()) / (1000 * 60 * 60 * 24)) <= 3
    };

    console.log(`✅ Gig fetched: ${gig.title}`);

    res.status(200).json({
        status: 'success',
        data: {
            gig: enhancedGig
        }
    });
});

// ============================================
// ✅ CREATE GIG (Assignment Requirement)
// POST /api/gigs - Create a new job post
// ============================================
exports.createGig = catchAsync(async (req, res, next) => {
    console.log('🆕 Creating new gig:', req.body);
    
    // Validate request body
    const { error } = createGigSchema.validate(req.body);
    if (error) {
        console.log('❌ Validation error:', error.details[0].message);
        return next(new AppError(error.details[0].message, 400));
    }

    const { title, description, category, budget, deadline, skillsRequired } = req.body;

    // Check deadline is in the future
    if (new Date(deadline) <= new Date()) {
        console.log('❌ Deadline must be in future');
        return next(new AppError('Deadline must be in the future', 400));
    }

    // Create gig data
    const gigData = {
        title,
        description,
        category,
        budget,
        deadline,
        skillsRequired: skillsRequired || [],
        client: req.user.id
    };

    // Create gig
    const gig = await Gig.create(gigData);
    
    // Populate client info
    await gig.populate('client', 'username profileImage rating');

    console.log(`✅ Gig created: ${gig.title} by ${req.user.username}`);

    res.status(201).json({
        status: 'success',
        message: 'Gig created successfully',
        data: {
            gig
        }
    });
});

// ============================================
// ✅ UPDATE GIG
// PATCH /api/gigs/:id
// ============================================
exports.updateGig = catchAsync(async (req, res, next) => {
    console.log('✏️ Updating gig:', req.params.id);
    
    const gig = await Gig.findById(req.params.id);
    
    if (!gig) {
        console.log('❌ Gig not found');
        return next(new AppError('Gig not found', 404));
    }

    // Check if user is the owner
    if (gig.client.toString() !== req.user.id) {
        console.log('❌ Not authorized to update gig');
        return next(new AppError('You do not have permission to update this gig', 403));
    }

    // Check if gig can be updated (only open gigs without freelancer)
    if (gig.status !== 'open') {
        console.log('❌ Cannot update non-open gig');
        return next(new AppError('Cannot update gig that is already assigned or in progress', 400));
    }

    if (gig.freelancer) {
        console.log('❌ Cannot update gig with assigned freelancer');
        return next(new AppError('Cannot update gig that already has an assigned freelancer', 400));
    }

    // Filter allowed fields
    const allowedFields = [
        'title', 'description', 'category', 'budget', 'deadline', 
        'skillsRequired', 'location', 'attachments'
    ];
    
    const updates = {};
    Object.keys(req.body).forEach(key => {
        if (allowedFields.includes(key)) {
            updates[key] = req.body[key];
        }
    });

    // Check deadline if being updated
    if (updates.deadline && new Date(updates.deadline) <= new Date()) {
        console.log('❌ Deadline must be in future');
        return next(new AppError('Deadline must be in the future', 400));
    }

    // Update gig
    Object.keys(updates).forEach(key => {
        gig[key] = updates[key];
    });

    await gig.save();
    
    // Populate client info
    await gig.populate('client', 'username profileImage rating');

    console.log(`✅ Gig updated: ${gig.title}`);

    res.status(200).json({
        status: 'success',
        message: 'Gig updated successfully',
        data: {
            gig
        }
    });
});

// ============================================
// ✅ DELETE GIG
// DELETE /api/gigs/:id
// ============================================
exports.deleteGig = catchAsync(async (req, res, next) => {
    console.log('🗑️ Deleting gig:', req.params.id);
    
    const gig = await Gig.findById(req.params.id);
    
    if (!gig) {
        console.log('❌ Gig not found');
        return next(new AppError('Gig not found', 404));
    }

    // Check if user is the owner
    if (gig.client.toString() !== req.user.id) {
        console.log('❌ Not authorized to delete gig');
        return next(new AppError('You do not have permission to delete this gig', 403));
    }

    // Check if gig can be deleted (only open gigs without freelancer and no bids)
    if (gig.status !== 'open') {
        console.log('❌ Cannot delete non-open gig');
        return next(new AppError('Cannot delete gig that is already assigned or in progress', 400));
    }

    if (gig.freelancer) {
        console.log('❌ Cannot delete gig with assigned freelancer');
        return next(new AppError('Cannot delete gig that already has an assigned freelancer', 400));
    }

    // Check if gig has bids
    const bidCount = await Bid.countDocuments({ gigId: gig._id });
    if (bidCount > 0) {
        console.log(`❌ Cannot delete gig with ${bidCount} bids`);
        return next(new AppError('Cannot delete gig that has bids. Please cancel bids first.', 400));
    }

    // Delete the gig
    await gig.deleteOne();

    console.log(`✅ Gig deleted: ${gig.title}`);

    res.status(200).json({
        status: 'success',
        message: 'Gig deleted successfully',
        data: null
    });
});

// ============================================
// ✅ GET MY GIGS
// GET /api/gigs/my-gigs
// ============================================
exports.getMyGigs = catchAsync(async (req, res, next) => {
    console.log('📋 Getting my gigs for user:', req.user.id);
    
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const query = { client: req.user.id };
    if (status && status !== 'all') {
        query.status = status;
    }

    const gigs = await Gig.find(query)
        .populate('freelancer', 'username profileImage rating')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

    // Get bid counts and statistics for each gig
    const gigsWithStats = await Promise.all(
        gigs.map(async (gig) => {
            const [bidCount, pendingBids, bidStats] = await Promise.all([
                Bid.countDocuments({ gigId: gig._id }),
                Bid.countDocuments({ gigId: gig._id, status: 'pending' }),
                Bid.aggregate([
                    { $match: { gigId: gig._id } },
                    {
                        $group: {
                            _id: null,
                            avgPrice: { $avg: '$price' },
                            minPrice: { $min: '$price' },
                            maxPrice: { $max: '$price' }
                        }
                    }
                ])
            ]);

            return {
                ...gig,
                bidCount,
                pendingBids,
                bidStats: bidStats[0] || { avgPrice: 0, minPrice: 0, maxPrice: 0 },
                canEdit: gig.status === 'open' && !gig.freelancer,
                daysRemaining: Math.max(0, Math.ceil((new Date(gig.deadline) - new Date()) / (1000 * 60 * 60 * 24))),
                isUrgent: Math.ceil((new Date(gig.deadline) - new Date()) / (1000 * 60 * 60 * 24)) <= 3
            };
        })
    );

    const total = await Gig.countDocuments(query);

    // Get statistics
    const stats = await Gig.aggregate([
        { $match: { client: req.user._id } },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalBudget: { $sum: '$budget' },
                avgBudget: { $avg: '$budget' }
            }
        }
    ]);

    const statsObj = {
        total: 0,
        open: 0,
        assigned: 0,
        'in-progress': 0,
        completed: 0,
        cancelled: 0,
        totalBudget: 0,
        avgBudget: 0
    };

    let totalBudgetSum = 0;
    let gigCount = 0;

    stats.forEach(stat => {
        statsObj.total += stat.count;
        statsObj[stat._id] = stat.count;
        if (stat.totalBudget) {
            totalBudgetSum += stat.totalBudget;
        }
        gigCount += stat.count;
    });

    statsObj.totalBudget = totalBudgetSum;
    statsObj.avgBudget = gigCount > 0 ? totalBudgetSum / gigCount : 0;

    console.log(`✅ Found ${gigs.length} gigs for user ${req.user.username}`);

    res.status(200).json({
        status: 'success',
        results: gigs.length,
        data: {
            gigs: gigsWithStats
        },
        statistics: statsObj,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// ============================================
// ✅ GET GIG STATISTICS
// GET /api/gigs/:id/stats
// ============================================
exports.getGigStats = catchAsync(async (req, res, next) => {
    console.log('📊 Getting gig statistics:', req.params.id);
    
    const gig = await Gig.findById(req.params.id);
    
    if (!gig) {
        return next(new AppError('Gig not found', 404));
    }

    // Check if user is the owner
    if (gig.client.toString() !== req.user.id) {
        return next(new AppError('You do not have permission to view these statistics', 403));
    }

    // Get bid statistics
    const bidStats = await Bid.aggregate([
        { $match: { gigId: gig._id } },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                avgPrice: { $avg: '$price' },
                minPrice: { $min: '$price' },
                maxPrice: { $max: '$price' },
                totalValue: { $sum: '$price' }
            }
        }
    ]);

    // Get timeline data
    const timeline = await Bid.aggregate([
        { $match: { gigId: gig._id } },
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$submittedAt" }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } },
        { $limit: 30 }
    ]);

    // Format statistics
    const stats = {
        totalBids: 0,
        pendingBids: 0,
        hiredBids: 0,
        rejectedBids: 0,
        avgBidPrice: 0,
        minBidPrice: 0,
        maxBidPrice: 0,
        totalBidValue: 0,
        bidToBudgetRatio: 0
    };

    bidStats.forEach(stat => {
        stats.totalBids += stat.count;
        stats[`${stat._id}Bids`] = stat.count;
        if (stat.avgPrice) stats.avgBidPrice = parseFloat(stat.avgPrice.toFixed(2));
        if (stat.minPrice) stats.minBidPrice = stat.minPrice;
        if (stat.maxPrice) stats.maxBidPrice = stat.maxPrice;
        if (stat.totalValue) stats.totalBidValue = stat.totalValue;
    });

    stats.bidToBudgetRatio = gig.budget > 0 ? (stats.avgBidPrice / gig.budget) * 100 : 0;

    console.log(`✅ Gig statistics retrieved for: ${gig.title}`);

    res.status(200).json({
        status: 'success',
        data: {
            gig: {
                _id: gig._id,
                title: gig.title,
                budget: gig.budget,
                status: gig.status,
                views: gig.views,
                createdAt: gig.createdAt,
                deadline: gig.deadline
            },
            statistics: stats,
            timeline: timeline,
            daysRemaining: Math.max(0, Math.ceil((new Date(gig.deadline) - new Date()) / (1000 * 60 * 60 * 24)))
        }
    });
});

// ============================================
// ✅ UPDATE GIG STATUS
// PATCH /api/gigs/:id/status
// ============================================
exports.updateGigStatus = catchAsync(async (req, res, next) => {
    console.log('🔄 Updating gig status:', req.params.id, req.body);
    
    const { status } = req.body;
    const validStatuses = ['in-progress', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
        return next(new AppError(`Status must be one of: ${validStatuses.join(', ')}`, 400));
    }

    const gig = await Gig.findById(req.params.id);
    
    if (!gig) {
        return next(new AppError('Gig not found', 404));
    }

    // Check permissions
    const isClient = gig.client.toString() === req.user.id;
    const isFreelancer = gig.freelancer && gig.freelancer.toString() === req.user.id;

    if (!isClient && !isFreelancer) {
        return next(new AppError('You do not have permission to update this gig status', 403));
    }

    // Check valid status transitions
    const validTransitions = {
        'assigned': ['in-progress'],
        'in-progress': ['completed'],
        'open': ['cancelled'],
        'assigned': ['cancelled']
    };

    if (!validTransitions[gig.status] || !validTransitions[gig.status].includes(status)) {
        return next(new AppError(`Cannot change status from ${gig.status} to ${status}`, 400));
    }

    // Update status
    gig.status = status;
    
    if (status === 'completed') {
        gig.completedAt = new Date();
    }

    await gig.save();

    console.log(`✅ Gig status updated to ${status}`);

    res.status(200).json({
        status: 'success',
        message: `Gig status updated to ${status}`,
        data: {
            gig
        }
    });
});

// ============================================
// ✅ SEARCH GIGS (Enhanced search)
// GET /api/gigs/search
// ============================================
exports.searchGigs = catchAsync(async (req, res, next) => {
    console.log('🔎 Advanced gig search:', req.query);
    
    const { 
        q, 
        category, 
        minBudget, 
        maxBudget, 
        skills,
        locationType,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        page = 1,
        limit = 20
    } = req.query;

    // Build search query
    const searchQuery = { status: 'open' };

    // Full-text search
    if (q && q.trim()) {
        searchQuery.$text = { $search: q };
    }

    // Category filter
    if (category && category !== 'all') {
        searchQuery.category = category;
    }

    // Budget filter
    if (minBudget || maxBudget) {
        searchQuery.budget = {};
        if (minBudget) searchQuery.budget.$gte = Number(minBudget);
        if (maxBudget) searchQuery.budget.$lte = Number(maxBudget);
    }

    // Skills filter
    if (skills) {
        const skillsArray = Array.isArray(skills) ? skills : skills.split(',');
        searchQuery.skillsRequired = { $in: skillsArray };
    }

    // Location filter
    if (locationType) {
        searchQuery['location.type'] = locationType;
    }

    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute search
    const gigs = await Gig.find(searchQuery)
        .populate('client', 'username profileImage rating')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

    const total = await Gig.countDocuments(searchQuery);

    // Get aggregation data for filters
    const filters = await Gig.aggregate([
        { $match: { status: 'open' } },
        {
            $facet: {
                categories: [
                    { $group: { _id: '$category', count: { $sum: 1 } } },
                    { $sort: { count: -1 } }
                ],
                budgetRanges: [
                    {
                        $bucket: {
                            groupBy: '$budget',
                            boundaries: [0, 500, 1000, 2000, 5000, 10000],
                            default: '10000+',
                            output: {
                                count: { $sum: 1 },
                                avgBudget: { $avg: '$budget' }
                            }
                        }
                    }
                ],
                popularSkills: [
                    { $unwind: '$skillsRequired' },
                    { $group: { _id: '$skillsRequired', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 10 }
                ]
            }
        }
    ]);

    console.log(`✅ Search found ${gigs.length} gigs`);

    res.status(200).json({
        status: 'success',
        results: gigs.length,
        data: {
            gigs,
            filters: filters[0] || {}
        },
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// ============================================
// ✅ GET FEATURED GIGS
// GET /api/gigs/featured
// ============================================
exports.getFeaturedGigs = catchAsync(async (req, res, next) => {
    console.log('⭐ Getting featured gigs');
    
    const gigs = await Gig.find({ 
        status: 'open',
        featured: true 
    })
    .populate('client', 'username profileImage rating')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

    console.log(`✅ Found ${gigs.length} featured gigs`);

    res.status(200).json({
        status: 'success',
        results: gigs.length,
        data: {
            gigs
        }
    });
});

// ============================================
// ✅ GET GIG CATEGORIES
// GET /api/gigs/categories
// ============================================
exports.getCategories = catchAsync(async (req, res, next) => {
    console.log('📂 Getting gig categories');
    
    const categories = await Gig.aggregate([
        { $match: { status: 'open' } },
        {
            $group: {
                _id: '$category',
                count: { $sum: 1 },
                avgBudget: { $avg: '$budget' },
                totalBudget: { $sum: '$budget' }
            }
        },
        { $sort: { count: -1 } }
    ]);

    console.log(`✅ Found ${categories.length} categories`);

    res.status(200).json({
        status: 'success',
        data: {
            categories
        }
    });
});

// ============================================
// ✅ MARK GIG AS FEATURED (Admin)
// PATCH /api/gigs/:id/feature
// ============================================
exports.markAsFeatured = catchAsync(async (req, res, next) => {
    console.log('⭐ Marking gig as featured:', req.params.id);
    
    const gig = await Gig.findById(req.params.id);
    
    if (!gig) {
        return next(new AppError('Gig not found', 404));
    }

    // Check if user is admin or gig owner
    if (req.user.role !== 'admin' && gig.client.toString() !== req.user.id) {
        return next(new AppError('You do not have permission to feature this gig', 403));
    }

    gig.featured = true;
    await gig.save();

    console.log(`✅ Gig marked as featured: ${gig.title}`);

    res.status(200).json({
        status: 'success',
        message: 'Gig marked as featured',
        data: {
            gig
        }
    });
});

// ============================================
// ✅ CANCEL GIG
// PATCH /api/gigs/:id/cancel
// ============================================
exports.cancelGig = catchAsync(async (req, res, next) => {
    console.log('❌ Cancelling gig:', req.params.id);
    
    const gig = await Gig.findById(req.params.id);
    
    if (!gig) {
        return next(new AppError('Gig not found', 404));
    }

    // Check if user is the owner
    if (gig.client.toString() !== req.user.id) {
        return next(new AppError('Only the gig owner can cancel this gig', 403));
    }

    // Check if gig can be cancelled
    if (gig.status !== 'open' && gig.status !== 'assigned') {
        return next(new AppError(`Cannot cancel gig with status: ${gig.status}`, 400));
    }

    // Update gig status
    gig.status = 'cancelled';
    gig.cancelledAt = new Date();
    await gig.save();

    // Reject all pending bids
    await Bid.updateMany(
        { gigId: gig._id, status: 'pending' },
        { 
            $set: { 
                status: 'rejected',
                rejectedAt: new Date()
            }
        }
    );

    console.log(`✅ Gig cancelled: ${gig.title}`);

    res.status(200).json({
        status: 'success',
        message: 'Gig cancelled successfully',
        data: {
            gig
        }
    });
});