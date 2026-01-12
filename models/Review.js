const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    // Review Context
    gig: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gig',
        required: true,
        index: true
    },
    proposal: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    
    // Parties Involved
    reviewer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reviewee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    role: {
        type: String,
        enum: ['client', 'freelancer'],
        required: true
    },
    
    // Ratings (1-5 stars)
    ratings: {
        quality: {
            type: Number,
            min: 1,
            max: 5,
            required: true
        },
        communication: {
            type: Number,
            min: 1,
            max: 5,
            required: true
        },
        professionalism: {
            type: Number,
            min: 1,
            max: 5,
            required: true
        },
        adherenceToSchedule: {
            type: Number,
            min: 1,
            max: 5
        },
        expertise: {
            type: Number,
            min: 1,
            max: 5
        }
    },
    overallRating: {
        type: Number,
        min: 1,
        max: 5,
        required: true
    },
    
    // Review Content
    title: {
        type: String,
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    comment: {
        type: String,
        required: [true, 'Comment is required'],
        minlength: [20, 'Comment must be at least 20 characters'],
        maxlength: [2000, 'Comment cannot exceed 2000 characters']
    },
    positiveFeedback: [String],
    areasForImprovement: [String],
    
    // Recommendation
    wouldRecommend: {
        type: Boolean,
        default: true
    },
    wouldHireAgain: {
        type: Boolean,
        default: true
    },
    
    // Response
    response: {
        comment: String,
        respondedAt: Date
    },
    
    // Verification
    verifiedPurchase: {
        type: Boolean,
        default: true
    },
    helpful: {
        count: {
            type: Number,
            default: 0
        },
        users: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }]
    },
    reported: {
        type: Boolean,
        default: false
    },
    reportReason: String,
    
    // Status
    status: {
        type: String,
        enum: ['pending', 'published', 'hidden', 'removed'],
        default: 'published'
    },
    moderationNotes: String,
    
    // Metadata
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    publishedAt: Date
}, {
    timestamps: true
});

// Indexes
reviewSchema.index({ reviewee: 1, createdAt: -1 });
reviewSchema.index({ reviewer: 1, createdAt: -1 });
reviewSchema.index({ overallRating: -1 });
reviewSchema.index({ gig: 1, role: 1 });
reviewSchema.index({ 'ratings.quality': -1 });
reviewSchema.index({ status: 1 });

// Pre-save middleware
reviewSchema.pre('save', function(next) {
    if (this.isModified('ratings')) {
        const ratings = Object.values(this.ratings).filter(r => r);
        this.overallRating = ratings.length > 0 
            ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length 
            : 0;
    }
    
    if (this.isNew && this.status === 'published') {
        this.publishedAt = new Date();
    }
    
    next();
});

// Static Methods
reviewSchema.statics.getUserReviews = async function(userId, role = null, filters = {}) {
    const { page = 1, limit = 10, minRating, maxRating } = filters;
    const skip = (page - 1) * limit;
    
    const query = { reviewee: userId, status: 'published' };
    if (role) query.role = role;
    if (minRating) query.overallRating = { $gte: minRating };
    if (maxRating) query.overallRating = { ...query.overallRating, $lte: maxRating };
    
    return this.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reviewer', 'username profileImage title')
        .populate('gig', 'title')
        .lean();
};

reviewSchema.statics.getAverageRating = async function(userId) {
    const result = await this.aggregate([
        { $match: { reviewee: userId, status: 'published' } },
        {
            $group: {
                _id: null,
                averageRating: { $avg: '$overallRating' },
                totalReviews: { $sum: 1 },
                qualityAvg: { $avg: '$ratings.quality' },
                communicationAvg: { $avg: '$ratings.communication' },
                professionalismAvg: { $avg: '$ratings.professionalism' }
            }
        }
    ]);
    
    return result[0] || {
        averageRating: 0,
        totalReviews: 0,
        qualityAvg: 0,
        communicationAvg: 0,
        professionalismAvg: 0
    };
};

reviewSchema.statics.markHelpful = async function(reviewId, userId) {
    const review = await this.findById(reviewId);
    if (!review) throw new Error('Review not found');
    
    const alreadyMarked = review.helpful.users.some(id => id.toString() === userId.toString());
    if (alreadyMarked) {
        throw new Error('You have already marked this review as helpful');
    }
    
    review.helpful.count += 1;
    review.helpful.users.push(userId);
    
    return review.save();
};

// Instance Methods
reviewSchema.methods.toggleVisibility = async function() {
    this.status = this.status === 'published' ? 'hidden' : 'published';
    if (this.status === 'published' && !this.publishedAt) {
        this.publishedAt = new Date();
    }
    return this.save();
};

reviewSchema.methods.addResponse = async function(comment) {
    this.response = {
        comment,
        respondedAt: new Date()
    };
    return this.save();
};

module.exports = mongoose.model('Review', ReviewSchema);
