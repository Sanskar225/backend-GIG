const mongoose = require('mongoose');

const gigSchema = new mongoose.Schema({
    // Basic Information
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        minlength: [10, 'Title must be at least 10 characters'],
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    
    description: {
        type: String,
        required: [true, 'Description is required'],
        minlength: [100, 'Description must be at least 100 characters'],
        maxlength: [5000, 'Description cannot exceed 5000 characters'],
        trim: true
    },
    
    // Category and Type
    category: {
        type: String,
        required: [true, 'Category is required'],
        enum: ['web-development', 'mobile-development', 'design', 'writing', 'marketing', 'data-science', 'other'],
        index: true
    },
    
    // Budget Information
    budget: {
        type: Number,
        required: [true, 'Budget is required'],
        min: [1, 'Budget must be at least $1'],
        max: [1000000, 'Budget cannot exceed $1,000,000']
    },
    
    budgetType: {
        type: String,
        enum: ['fixed', 'hourly'],
        default: 'fixed'
    },
    
    // Timeline
    deadline: {
        type: Date,
        required: [true, 'Deadline is required'],
        validate: {
            validator: function(value) {
                return value > new Date();
            },
            message: 'Deadline must be in the future'
        }
    },
    
    // People Involved
    client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    
    freelancer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    
    // Status (matches assignment requirements: open or assigned)
    status: {
        type: String,
        enum: ['open', 'assigned', 'in-progress', 'completed', 'cancelled'],
        default: 'open',
        index: true
    },
    
    // Requirements
    skillsRequired: [{
        type: String,
        trim: true
    }],
    
    // Location (optional)
    location: {
        type: {
            type: String,
            enum: ['remote', 'onsite', 'hybrid'],
            default: 'remote'
        },
        country: String,
        city: String
    },
    
    // Additional Details
    attachments: [{
        fileName: String,
        fileUrl: String,
        fileType: String,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    
    // Metadata
    views: {
        type: Number,
        default: 0
    },
    
    featured: {
        type: Boolean,
        default: false
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    assignedAt: {
        type: Date
    },
    
    completedAt: {
        type: Date
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ✅ INDEXES FOR PERFORMANCE
gigSchema.index({ title: 'text', description: 'text' });
gigSchema.index({ client: 1, status: 1 });
gigSchema.index({ freelancer: 1 });
gigSchema.index({ status: 1, createdAt: -1 });
gigSchema.index({ category: 1, status: 1 });
gigSchema.index({ budget: 1 });
gigSchema.index({ deadline: 1 });

// ✅ VIRTUAL POPULATIONS (for separate Bid model)
gigSchema.virtual('bids', {
    ref: 'Bid',
    localField: '_id',
    foreignField: 'gigId',
    justOne: false
});

gigSchema.virtual('clientInfo', {
    ref: 'User',
    localField: 'client',
    foreignField: '_id',
    justOne: true
});

gigSchema.virtual('freelancerInfo', {
    ref: 'User',
    localField: 'freelancer',
    foreignField: '_id',
    justOne: true
});

// ✅ MIDDLEWARE
// Update updatedAt timestamp
gigSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    
    // Set assignedAt when status changes to assigned
    if (this.isModified('status') && this.status === 'assigned' && !this.assignedAt) {
        this.assignedAt = new Date();
    }
    
    // Set completedAt when status changes to completed
    if (this.isModified('status') && this.status === 'completed' && !this.completedAt) {
        this.completedAt = new Date();
    }
    
    next();
});

// ✅ STATIC METHODS

// Get all open gigs with search and filters
gigSchema.statics.getOpenGigs = async function(filters = {}) {
    const {
        query = '',
        category = null,
        minBudget = 0,
        maxBudget = 1000000,
        skills = [],
        locationType = null,
        page = 1,
        limit = 20,
        sortBy = 'createdAt',
        sortOrder = -1
    } = filters;
    
    const skip = (page - 1) * limit;
    
    // Base query for open gigs
    const queryObj = { status: 'open' };
    
    // Text search
    if (query) {
        queryObj.$text = { $search: query };
    }
    
    // Category filter
    if (category) {
        queryObj.category = category;
    }
    
    // Budget filter
    if (minBudget || maxBudget) {
        queryObj.budget = {};
        if (minBudget) queryObj.budget.$gte = Number(minBudget);
        if (maxBudget) queryObj.budget.$lte = Number(maxBudget);
    }
    
    // Skills filter
    if (skills.length > 0) {
        queryObj.skillsRequired = { $in: skills };
    }
    
    // Location filter
    if (locationType) {
        queryObj['location.type'] = locationType;
    }
    
    const sort = {};
    sort[sortBy] = sortOrder;
    
    const gigs = await this.find(queryObj)
        .populate('client', 'username profileImage rating')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();
    
    const total = await this.countDocuments(queryObj);
    
    return {
        gigs,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        }
    };
};

// Get user's gigs (as client or freelancer)
gigSchema.statics.getUserGigs = async function(userId, role = 'client', options = {}) {
    const { 
        status = null, 
        page = 1, 
        limit = 20 
    } = options;
    
    const skip = (page - 1) * limit;
    
    const query = role === 'client' 
        ? { client: userId }
        : { freelancer: userId };
    
    if (status) {
        query.status = status;
    }
    
    const gigs = await this.find(query)
        .populate('client', 'username profileImage rating')
        .populate('freelancer', 'username profileImage rating')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    
    const total = await this.countDocuments(query);
    
    return {
        gigs,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        }
    };
};

// Get gig statistics
gigSchema.statics.getGigStats = async function(userId = null) {
    const matchStage = userId ? { $match: { client: mongoose.Types.ObjectId.createFromHexString(userId) } } : { $match: {} };
    
    const stats = await this.aggregate([
        matchStage,
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
                assigned: { $sum: { $cond: [{ $eq: ['$status', 'assigned'] }, 1, 0] } },
                inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0] } },
                completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                totalBudget: { $sum: '$budget' },
                avgBudget: { $avg: '$budget' }
            }
        }
    ]);
    
    if (stats.length === 0) {
        return {
            total: 0,
            open: 0,
            assigned: 0,
            inProgress: 0,
            completed: 0,
            cancelled: 0,
            totalBudget: 0,
            avgBudget: 0
        };
    }
    
    return stats[0];
};

// Assign freelancer to gig (used in hiring logic)
gigSchema.statics.assignFreelancer = async function(gigId, freelancerId) {
    const gig = await this.findById(gigId);
    
    if (!gig) {
        throw new Error('Gig not found');
    }
    
    if (gig.status !== 'open') {
        throw new Error('Gig is not open for assignment');
    }
    
    gig.status = 'assigned';
    gig.freelancer = freelancerId;
    gig.assignedAt = new Date();
    
    return gig.save();
};

// ✅ INSTANCE METHODS

// Check if gig is open for bids
gigSchema.methods.isOpen = function() {
    return this.status === 'open';
};

// Check if gig can be edited
gigSchema.methods.canBeEdited = function() {
    return this.status === 'open' && !this.freelancer;
};

// Check if gig can be deleted
gigSchema.methods.canBeDeleted = function() {
    return this.status === 'open' && !this.freelancer;
};

// Get days remaining until deadline
gigSchema.methods.getDaysRemaining = function() {
    const now = new Date();
    const deadline = this.deadline;
    const diffTime = Math.abs(deadline - now);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Check if gig is urgent (less than 3 days remaining)
gigSchema.virtual('isUrgent').get(function() {
    return this.getDaysRemaining() <= 3;
});

// Get formatted budget
gigSchema.virtual('formattedBudget').get(function() {
    return `$${this.budget.toLocaleString()}`;
});

// Get formatted deadline
gigSchema.virtual('formattedDeadline').get(function() {
    const options = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    };
    return this.deadline.toLocaleDateString('en-US', options);
});

// Increment view count
gigSchema.methods.incrementViews = async function() {
    this.views += 1;
    return this.save();
};

// Mark as featured
gigSchema.methods.markAsFeatured = async function() {
    this.featured = true;
    return this.save();
};

module.exports = mongoose.model('Gig', gigSchema);