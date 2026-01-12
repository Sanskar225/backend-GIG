const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        required: true,
        enum: [
            'new_bid',           // New bid received on your gig
            'bid_accepted',      // Your bid was accepted
            'bid_rejected',      // Your bid was rejected
            'gig_assigned',      // You've been assigned to a gig
            'gig_completed',     // Gig marked as completed
            'message_received',  // New message
            'payment_received',  // Payment received
            'review_received',   // Review received
            'system_alert',      // System notification
            'gig_update'         // Gig status updated
        ]
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    message: {
        type: String,
        required: true,
        trim: true,
        maxlength: [500, 'Message cannot exceed 500 characters']
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },
    isArchived: {
        type: Boolean,
        default: false,
        index: true
    },
    readAt: {
        type: Date
    },
    archivedAt: {
        type: Date
    },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for performance
notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ user: 1, isArchived: 1 });
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ priority: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-expire

// ✅ STATIC METHODS

// Create a new notification
notificationSchema.statics.createNotification = async function(userId, notificationData) {
    const notification = await this.create({
        user: userId,
        type: notificationData.type || 'system_alert',
        title: notificationData.title || 'Notification',
        message: notificationData.message || '',
        data: notificationData.data || {},
        priority: notificationData.priority || 'medium',
        isRead: false,
        isArchived: false
    });
    
    return notification;
};

// Create multiple notifications for multiple users
notificationSchema.statics.createNotifications = async function(userIds, notificationData) {
    const notifications = userIds.map(userId => ({
        user: userId,
        type: notificationData.type || 'system_alert',
        title: notificationData.title || 'Notification',
        message: notificationData.message || '',
        data: notificationData.data || {},
        priority: notificationData.priority || 'medium',
        isRead: false,
        isArchived: false
    }));
    
    return this.insertMany(notifications);
};

// Mark notifications as read
notificationSchema.statics.markAsRead = async function(notificationIds, userId) {
    return this.updateMany(
        {
            _id: { $in: notificationIds },
            user: userId,
            isRead: false
        },
        {
            $set: {
                isRead: true,
                readAt: new Date()
            }
        }
    );
};

// Mark all notifications as read for a user
notificationSchema.statics.markAllAsRead = async function(userId) {
    return this.updateMany(
        {
            user: userId,
            isRead: false,
            isArchived: false
        },
        {
            $set: {
                isRead: true,
                readAt: new Date()
            }
        }
    );
};

// Archive notifications
notificationSchema.statics.archiveNotifications = async function(notificationIds, userId) {
    return this.updateMany(
        {
            _id: { $in: notificationIds },
            user: userId,
            isArchived: false
        },
        {
            $set: {
                isArchived: true,
                archivedAt: new Date()
            }
        }
    );
};

// Get user's notifications with pagination
notificationSchema.statics.getUserNotifications = async function(userId, options = {}) {
    const {
        page = 1,
        limit = 20,
        unreadOnly = false,
        type = null,
        priority = null,
        startDate = null,
        endDate = null
    } = options;
    
    const skip = (page - 1) * limit;
    
    const query = {
        user: userId,
        isArchived: false
    };
    
    if (unreadOnly) {
        query.isRead = false;
    }
    
    if (type) {
        query.type = type;
    }
    
    if (priority) {
        query.priority = priority;
    }
    
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const notifications = await this.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    
    const total = await this.countDocuments(query);
    const unreadCount = await this.countDocuments({
        user: userId,
        isRead: false,
        isArchived: false
    });
    
    return {
        notifications,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        },
        unreadCount
    };
};

// Get notification statistics for a user
notificationSchema.statics.getUserStats = async function(userId) {
    const stats = await this.aggregate([
        { $match: { user: mongoose.Types.ObjectId.createFromHexString(userId), isArchived: false } },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                unread: {
                    $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
                },
                byType: {
                    $push: {
                        type: '$type',
                        count: 1
                    }
                },
                byPriority: {
                    $push: {
                        priority: '$priority',
                        count: 1
                    }
                }
            }
        }
    ]);
    
    if (stats.length === 0) {
        return {
            total: 0,
            unread: 0,
            types: {},
            priorities: {}
        };
    }
    
    const stat = stats[0];
    
    // Process type counts
    const typeCounts = {};
    stat.byType.forEach(item => {
        typeCounts[item.type] = (typeCounts[item.type] || 0) + item.count;
    });
    
    // Process priority counts
    const priorityCounts = {};
    stat.byPriority.forEach(item => {
        priorityCounts[item.priority] = (priorityCounts[item.priority] || 0) + item.count;
    });
    
    return {
        total: stat.total,
        unread: stat.unread,
        types: typeCounts,
        priorities: priorityCounts
    };
};

// Clean up expired notifications
notificationSchema.statics.cleanupExpired = async function() {
    return this.deleteMany({
        expiresAt: { $lt: new Date() }
    });
};

// ✅ INSTANCE METHODS

// Mark this notification as read
notificationSchema.methods.markAsRead = async function() {
    this.isRead = true;
    this.readAt = new Date();
    return this.save();
};

// Archive this notification
notificationSchema.methods.archive = async function() {
    this.isArchived = true;
    this.archivedAt = new Date();
    return this.save();
};

// Check if notification is expired
notificationSchema.methods.isExpired = function() {
    return this.expiresAt && new Date() > this.expiresAt;
};

// Get notification age in days
notificationSchema.virtual('ageInDays').get(function() {
    const now = new Date();
    const created = this.createdAt;
    const diffTime = Math.abs(now - created);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Get formatted created date
notificationSchema.virtual('formattedDate').get(function() {
    const options = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return this.createdAt.toLocaleDateString('en-US', options);
});

// Check if notification is recent (within 24 hours)
notificationSchema.virtual('isRecent').get(function() {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
    return this.createdAt > twentyFourHoursAgo;
});

module.exports = mongoose.model('Notification', notificationSchema);