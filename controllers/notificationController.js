const Notification = require('../models/Notification');
const { AppError, catchAsync } = require('../middleware/errorHandler');

// Get user notifications
exports.getNotifications = catchAsync(async (req, res, next) => {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const skip = (page - 1) * limit;

    const filter = { user: req.user.id, isArchived: false };
    if (unreadOnly === 'true') {
        filter.isRead = false;
    }

    const notifications = await Notification.find(filter)
        .populate('data.userId', 'username profileImage')
        .populate('data.gigId', 'title')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ 
        user: req.user.id, 
        isRead: false, 
        isArchived: false 
    });

    res.status(200).json({
        status: 'success',
        results: notifications.length,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
        },
        unreadCount,
        data: {
            notifications
        }
    });
});

// Mark notifications as read
exports.markAsRead = catchAsync(async (req, res, next) => {
    const { notificationIds } = req.body;

    if (!notificationIds || !Array.isArray(notificationIds)) {
        return next(new AppError('Please provide an array of notification IDs', 400));
    }

    await Notification.markAsRead(notificationIds, req.user.id);

    const unreadCount = await Notification.countDocuments({ 
        user: req.user.id, 
        isRead: false, 
        isArchived: false 
    });

    res.status(200).json({
        status: 'success',
        message: 'Notifications marked as read',
        unreadCount
    });
});

// Mark all notifications as read
exports.markAllAsRead = catchAsync(async (req, res, next) => {
    const notifications = await Notification.find({ 
        user: req.user.id, 
        isRead: false,
        isArchived: false 
    });

    const notificationIds = notifications.map(n => n._id);
    
    if (notificationIds.length > 0) {
        await Notification.markAsRead(notificationIds, req.user.id);
    }

    res.status(200).json({
        status: 'success',
        message: 'All notifications marked as read'
    });
});

// Archive notification
exports.archiveNotification = catchAsync(async (req, res, next) => {
    const notification = await Notification.findOneAndUpdate(
        { 
            _id: req.params.id, 
            user: req.user.id 
        },
        { 
            isArchived: true,
            archivedAt: new Date()
        },
        { new: true }
    );

    if (!notification) {
        return next(new AppError('Notification not found', 404));
    }

    res.status(200).json({
        status: 'success',
        message: 'Notification archived'
    });
});

// Get notification preferences
exports.getPreferences = catchAsync(async (req, res, next) => {
    // This would typically come from user model
    const preferences = {
        email: true,
        push: true,
        proposals: true,
        messages: true,
        gigUpdates: true
    };

    res.status(200).json({
        status: 'success',
        data: {
            preferences
        }
    });
});

// Update notification preferences
exports.updatePreferences = catchAsync(async (req, res, next) => {
    const { preferences } = req.body;

    // Update user's notification preferences
    // This would typically update the User model
    // For now, we'll just return success

    res.status(200).json({
        status: 'success',
        message: 'Notification preferences updated'
    });
});

// Clear all notifications
exports.clearAll = catchAsync(async (req, res, next) => {
    await Notification.updateMany(
        { user: req.user.id },
        { isArchived: true, archivedAt: new Date() }
    );

    res.status(200).json({
        status: 'success',
        message: 'All notifications cleared'
    });
});
