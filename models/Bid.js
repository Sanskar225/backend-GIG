const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
    // ✅ gigId: Reference to the gig being bid on
    gigId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gig',
        required: [true, 'Gig ID is required'],
        index: true
    },
    
    // ✅ freelancerId: Reference to the user submitting the bid
    freelancerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Freelancer ID is required'],
        index: true
    },
    
    // ✅ message: Bid proposal message/cover letter
    message: {
        type: String,
        required: [true, 'Message is required'],
        minlength: [20, 'Message must be at least 20 characters'],
        maxlength: [1000, 'Message cannot exceed 1000 characters'],
        trim: true
    },
    
    // ✅ price: Bid amount
    price: {
        type: Number,
        required: [true, 'Price is required'],
        min: [1, 'Price must be at least $1'],
        validate: {
            validator: function(value) {
                return value > 0;
            },
            message: 'Price must be greater than 0'
        }
    },
    
    // ✅ estimatedTime: Time to complete the gig (in days)
    estimatedTime: {
        type: Number,
        required: [true, 'Estimated time is required'],
        min: [1, 'Estimated time must be at least 1 day'],
        max: [365, 'Estimated time cannot exceed 1 year']
    },
    
    // ✅ status: Bid status (matches assignment requirements)
    status: {
        type: String,
        enum: ['pending', 'hired', 'rejected'],
        default: 'pending',
        index: true
    },
    
    // Timestamps for tracking
    submittedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    
    hiredAt: {
        type: Date
    },
    
    rejectedAt: {
        type: Date
    },
    
    // Optional: Attachments/files
    attachments: [{
        fileName: String,
        fileUrl: String,
        fileType: String,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    
    // Optional: Revision requests
    revisions: {
        requested: {
            type: Boolean,
            default: false
        },
        count: {
            type: Number,
            default: 0
        },
        lastRequestedAt: Date
    },
    
    // Metadata
    ipAddress: String,
    userAgent: String,
    
    // Soft delete flag
    isDeleted: {
        type: Boolean,
        default: false,
        select: false
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ✅ COMPOUND INDEXES FOR PERFORMANCE
// Ensure one bid per freelancer per gig
bidSchema.index({ gigId: 1, freelancerId: 1 }, { unique: true });

// Index for querying bids by gig and status
bidSchema.index({ gigId: 1, status: 1 });

// Index for querying user's bids
bidSchema.index({ freelancerId: 1, status: 1 });

// Index for sorting by submission date
bidSchema.index({ submittedAt: -1 });

// ✅ VIRTUAL POPULATIONS
bidSchema.virtual('freelancer', {
    ref: 'User',
    localField: 'freelancerId',
    foreignField: '_id',
    justOne: true
});

bidSchema.virtual('gig', {
    ref: 'Gig',
    localField: 'gigId',
    foreignField: '_id',
    justOne: true
});

// ✅ MIDDLEWARE
// Filter out deleted bids by default
bidSchema.pre(/^find/, function(next) {
    if (this.getFilter().isDeleted === undefined) {
        this.where({ isDeleted: false });
    }
    next();
});

// Update timestamps on status changes
bidSchema.pre('save', function(next) {
    if (this.isModified('status')) {
        const now = new Date();
        if (this.status === 'hired' && !this.hiredAt) {
            this.hiredAt = now;
        } else if (this.status === 'rejected' && !this.rejectedAt) {
            this.rejectedAt = now;
        }
    }
    next();
});

// ✅ STATIC METHODS
// Get bids for a specific gig with filters
bidSchema.statics.getBidsForGig = async function(gigId, options = {}) {
    const { 
        status = null, 
        page = 1, 
        limit = 20, 
        sortBy = 'submittedAt',
        sortOrder = -1 
    } = options;
    
    const skip = (page - 1) * limit;
    const query = { gigId };
    
    if (status) {
        query.status = status;
    }
    
    const sort = {};
    sort[sortBy] = sortOrder;
    
    return this.find(query)
        .populate('freelancerId', 'username profileImage rating skills bio completedGigs')
        .sort(sort)
        .skip(skip)
        .limit(limit);
};

// Get user's bids
bidSchema.statics.getUserBids = async function(userId, options = {}) {
    const { 
        status = null, 
        page = 1, 
        limit = 20, 
        sortBy = 'submittedAt',
        sortOrder = -1 
    } = options;
    
    const skip = (page - 1) * limit;
    const query = { freelancerId: userId };
    
    if (status) {
        query.status = status;
    }
    
    const sort = {};
    sort[sortBy] = sortOrder;
    
    return this.find(query)
        .populate({
            path: 'gigId',
            select: 'title description budget status client category deadline',
            populate: {
                path: 'client',
                select: 'username profileImage rating'
            }
        })
        .sort(sort)
        .skip(skip)
        .limit(limit);
};

// Get bid statistics for a user
bidSchema.statics.getUserBidStats = async function(userId) {
    const stats = await this.aggregate([
        { $match: { freelancerId: mongoose.Types.ObjectId.createFromHexString(userId) } },
        {
            $group: {
                _id: null,
                totalBids: { $sum: 1 },
                pendingBids: {
                    $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                },
                hiredBids: {
                    $sum: { $cond: [{ $eq: ['$status', 'hired'] }, 1, 0] }
                },
                rejectedBids: {
                    $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
                },
                totalEarned: {
                    $sum: { $cond: [{ $eq: ['$status', 'hired'] }, '$price', 0] }
                },
                avgBidPrice: { $avg: '$price' }
            }
        }
    ]);
    
    if (stats.length === 0) {
        return {
            totalBids: 0,
            pendingBids: 0,
            hiredBids: 0,
            rejectedBids: 0,
            totalEarned: 0,
            avgBidPrice: 0,
            successRate: 0
        };
    }
    
    const stat = stats[0];
    return {
        totalBids: stat.totalBids || 0,
        pendingBids: stat.pendingBids || 0,
        hiredBids: stat.hiredBids || 0,
        rejectedBids: stat.rejectedBids || 0,
        totalEarned: stat.totalEarned || 0,
        avgBidPrice: stat.avgBidPrice ? parseFloat(stat.avgBidPrice.toFixed(2)) : 0,
        successRate: stat.totalBids > 0 ? 
            parseFloat(((stat.hiredBids / stat.totalBids) * 100).toFixed(1)) : 0
    };
};

// Get active bids count for a gig
bidSchema.statics.getActiveBidCount = async function(gigId) {
    return this.countDocuments({ 
        gigId, 
        status: 'pending' 
    });
};

// ✅ INSTANCE METHODS
// Check if bid can be modified
bidSchema.methods.canBeModified = function() {
    return this.status === 'pending';
};

// Check if bid can be withdrawn
bidSchema.methods.canBeWithdrawn = function() {
    return this.status === 'pending';
};

// Soft delete bid
bidSchema.methods.softDelete = async function() {
    this.isDeleted = true;
    return this.save();
};

// Hire this bid (called from controller during transaction)
bidSchema.methods.markAsHired = async function() {
    this.status = 'hired';
    this.hiredAt = new Date();
    return this.save();
};

// Reject this bid
bidSchema.methods.markAsRejected = async function() {
    this.status = 'rejected';
    this.rejectedAt = new Date();
    return this.save();
};

// Add attachment to bid
bidSchema.methods.addAttachment = async function(attachment) {
    this.attachments.push(attachment);
    return this.save();
};

// Request revision
bidSchema.methods.requestRevision = async function() {
    this.revisions.requested = true;
    this.revisions.count += 1;
    this.revisions.lastRequestedAt = new Date();
    return this.save();
};

// Calculate days since submission
bidSchema.virtual('daysSinceSubmission').get(function() {
    const now = new Date();
    const submissionDate = this.submittedAt;
    const diffTime = Math.abs(now - submissionDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Check if bid is still active (within 30 days for pending bids)
bidSchema.virtual('isActive').get(function() {
    if (this.status !== 'pending') return false;
    return this.daysSinceSubmission <= 30;
});

// Get formatted price
bidSchema.virtual('formattedPrice').get(function() {
    return `$${this.price.toFixed(2)}`;
});

// Get estimated completion date
bidSchema.virtual('estimatedCompletionDate').get(function() {
    if (!this.submittedAt || !this.estimatedTime) return null;
    const completionDate = new Date(this.submittedAt);
    completionDate.setDate(completionDate.getDate() + this.estimatedTime);
    return completionDate;
});

module.exports = mongoose.model('Bid', bidSchema);