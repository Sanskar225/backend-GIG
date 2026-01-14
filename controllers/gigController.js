const Gig = require('../models/Gig');
const Bid = require('../models/Bid');
const User = require('../models/User');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { createGigSchema } = require('../validators/gigValidator');
const mongoose = require('mongoose');

// ============================================
// GET ALL GIGS
// ============================================
exports.getAllGigs = catchAsync(async (req, res) => {
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

    const filter = { status };

    if (query?.trim()) filter.$text = { $search: query };
    if (category && category !== 'all') filter.category = category;

    if (minBudget || maxBudget) {
        filter.budget = {};
        if (minBudget) filter.budget.$gte = Number(minBudget);
        if (maxBudget) filter.budget.$lte = Number(maxBudget);
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const gigs = await Gig.find(filter)
        .populate('client', 'username profileImage rating')
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .lean();

    const total = await Gig.countDocuments(filter);

    const gigsWithBidCounts = await Promise.all(
        gigs.map(async (gig) => {
            const bidCount = await Bid.countDocuments({ gigId: gig._id });
            return { ...gig, bidCount };
        })
    );

    res.status(200).json({
        status: 'success',
        data: { gigs: gigsWithBidCounts },
        pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// ============================================
// GET SINGLE GIG
// ============================================
exports.getGig = catchAsync(async (req, res, next) => {
    const gig = await Gig.findById(req.params.id)
        .populate('client', 'username profileImage rating bio')
        .populate('freelancer', 'username profileImage rating skills')
        .lean();

    if (!gig) return next(new AppError('Gig not found', 404));

    const pendingBids = await Bid.countDocuments({
        gigId: gig._id,
        status: 'pending'
    });

    res.status(200).json({
        status: 'success',
        data: {
            gig: {
                ...gig,
                pendingBids
            }
        }
    });
});

// ============================================
// CREATE GIG
// ============================================
exports.createGig = catchAsync(async (req, res, next) => {
    const { error } = createGigSchema.validate(req.body);
    if (error) return next(new AppError(error.details[0].message, 400));

    const gig = await Gig.create({
        ...req.body,
        client: req.user.id
    });

    await gig.populate('client', 'username profileImage rating');

    res.status(201).json({
        status: 'success',
        data: { gig }
    });
});

// ============================================
// UPDATE GIG
// ============================================
exports.updateGig = catchAsync(async (req, res, next) => {
    const gig = await Gig.findById(req.params.id);
    if (!gig) return next(new AppError('Gig not found', 404));

    if (gig.client.toString() !== req.user.id)
        return next(new AppError('Not authorized', 403));

    if (gig.status !== 'open')
        return next(new AppError('Cannot update non-open gig', 400));

    Object.assign(gig, req.body);
    await gig.save();

    res.status(200).json({
        status: 'success',
        data: { gig }
    });
});

// ============================================
// 🔥 DELETE GIG (FAST FIX APPLIED)
// ============================================
exports.deleteGig = catchAsync(async (req, res, next) => {
    const gig = await Gig.findById(req.params.id);
    if (!gig) return next(new AppError('Gig not found', 404));

    if (gig.client.toString() !== req.user.id)
        return next(new AppError('Not authorized', 403));

    // 🔥 FAST FIX: delete all bids first
    await Bid.deleteMany({ gigId: gig._id });

    // delete gig
    await gig.deleteOne();

    res.status(200).json({
        status: 'success',
        message: 'Gig deleted successfully'
    });
});

// ============================================
// GET MY GIGS
// ============================================
exports.getMyGigs = catchAsync(async (req, res) => {
    const gigs = await Gig.find({ client: req.user.id })
        .populate('freelancer', 'username profileImage rating')
        .sort({ createdAt: -1 });

    res.status(200).json({
        status: 'success',
        data: { gigs }
    });
});

// ============================================
// CANCEL GIG
// ============================================
exports.cancelGig = catchAsync(async (req, res, next) => {
    const gig = await Gig.findById(req.params.id);
    if (!gig) return next(new AppError('Gig not found', 404));

    if (gig.client.toString() !== req.user.id)
        return next(new AppError('Not authorized', 403));

    gig.status = 'cancelled';
    await gig.save();

    await Bid.updateMany(
        { gigId: gig._id, status: 'pending' },
        { status: 'rejected' }
    );

    res.status(200).json({
        status: 'success',
        message: 'Gig cancelled successfully'
    });
});
