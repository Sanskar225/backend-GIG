const Message = require('../models/Message');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { AppError, catchAsync } = require('../middleware/errorHandler');

// Get user's conversations
exports.getConversations = catchAsync(async (req, res, next) => {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Get distinct conversation rooms where user participated
    const rooms = await Message.distinct('roomId', {
        $or: [
            { sender: req.user.id },
            { receiver: req.user.id },
            { participants: req.user.id }
        ]
    });

    // Get latest message from each room
    const conversations = await Promise.all(
        rooms.slice(skip, skip + parseInt(limit)).map(async (roomId) => {
            const lastMessage = await Message.findOne({ roomId })
                .sort({ createdAt: -1 })
                .populate('sender', 'username profileImage')
                .lean();

            // Get participants in the room
            const participants = await Message.distinct('sender', { roomId });
            const otherParticipants = participants.filter(p => p.toString() !== req.user.id.toString());
            
            // Get user details for other participants
            const otherUsers = await User.find({ _id: { $in: otherParticipants } })
                .select('username profileImage role')
                .lean();

            // Get unread count
            const unreadCount = await Message.countDocuments({
                roomId,
                sender: { $ne: req.user.id },
                isRead: false,
                deleted: false
            });

            return {
                roomId,
                lastMessage,
                participants: otherUsers,
                unreadCount,
                updatedAt: lastMessage?.createdAt || new Date()
            };
        })
    );

    // Sort by last message date
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.status(200).json({
        status: 'success',
        results: conversations.length,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: rooms.length,
            pages: Math.ceil(rooms.length / limit)
        },
        data: {
            conversations
        }
    });
});

// Create new conversation
exports.createConversation = catchAsync(async (req, res, next) => {
    const { participantIds, gigId, initialMessage } = req.body;
    
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
        return next(new AppError('Please provide at least one participant', 400));
    }

    // Check if conversation already exists
    const allParticipants = [...participantIds, req.user.id];
    const existingConversations = await Message.distinct('roomId', {
        participants: { $all: allParticipants, $size: allParticipants.length }
    });

    if (existingConversations.length > 0) {
        return res.status(200).json({
            status: 'success',
            message: 'Conversation already exists',
            data: {
                roomId: existingConversations[0]
            }
        });
    }

    // Create room ID
    const roomId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create initial message if provided
    if (initialMessage) {
        const message = new Message({
            roomId,
            sender: req.user.id,
            participants: allParticipants,
            content: initialMessage,
            roomType: participantIds.length > 1 ? 'group' : 'direct'
        });

        if (gigId) {
            message.data = { gigId };
            message.roomType = 'gig';
        }

        await message.save();
    }

    res.status(201).json({
        status: 'success',
        message: 'Conversation created',
        data: {
            roomId,
            participants: allParticipants
        }
    });
});

// Get conversation messages
exports.getConversation = catchAsync(async (req, res, next) => {
    const { roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    // Check if user is part of conversation
    const canAccess = await Message.findOne({
        roomId,
        $or: [
            { sender: req.user.id },
            { receiver: req.user.id },
            { participants: req.user.id }
        ]
    });

    if (!canAccess) {
        return next(new AppError('You do not have access to this conversation', 403));
    }

    // Get messages
    const messages = await Message.find({ 
        roomId, 
        deleted: false 
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate('sender', 'username profileImage')
    .populate('replyTo', 'content sender')
    .lean();

    // Reverse to get chronological order
    messages.reverse();

    // Get participants
    const participants = await Message.distinct('sender', { roomId });
    const participantDetails = await User.find({ _id: { $in: participants } })
        .select('username profileImage role')
        .lean();

    // Mark messages as read
    await Message.markAsRead(roomId, req.user.id);

    res.status(200).json({
        status: 'success',
        results: messages.length,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            hasMore: messages.length === parseInt(limit)
        },
        data: {
            roomId,
            messages,
            participants: participantDetails
        }
    });
});

// Send message
exports.sendMessage = catchAsync(async (req, res, next) => {
    const { roomId } = req.params;
    const { content, type = 'text', attachments = [], replyTo } = req.body;

    if (!content && (!attachments || attachments.length === 0)) {
        return next(new AppError('Message content or attachments are required', 400));
    }

    // Check if user is part of conversation
    const canAccess = await Message.findOne({
        roomId,
        $or: [
            { sender: req.user.id },
            { receiver: req.user.id },
            { participants: req.user.id }
        ]
    });

    if (!canAccess) {
        return next(new AppError('You do not have access to this conversation', 403));
    }

    // Create message
    const message = new Message({
        roomId,
        sender: req.user.id,
        content,
        type,
        attachments,
        replyTo
    });

    await message.save();
    await message.populate('sender', 'username profileImage');

    // ⭐⭐⭐ EMIT REAL-TIME MESSAGE VIA SOCKET ⭐⭐⭐
    // This will be handled by socketHandler.js

    res.status(201).json({
        status: 'success',
        data: {
            message
        }
    });
});

// Update message
exports.updateMessage = catchAsync(async (req, res, next) => {
    const { roomId, messageId } = req.params;
    const { content } = req.body;

    if (!content) {
        return next(new AppError('Content is required', 400));
    }

    const message = await Message.findOne({
        _id: messageId,
        roomId,
        sender: req.user.id,
        deleted: false
    });

    if (!message) {
        return next(new AppError('Message not found or you cannot edit it', 404));
    }

    // Check if message can be edited (within 15 minutes)
    const editWindow = 15 * 60 * 1000; // 15 minutes in milliseconds
    if (Date.now() - message.createdAt > editWindow) {
        return next(new AppError('Message can only be edited within 15 minutes of sending', 400));
    }

    message.content = content;
    message.edited = true;
    message.editedAt = new Date();
    await message.save();

    await message.populate('sender', 'username profileImage');

    res.status(200).json({
        status: 'success',
        data: {
            message
        }
    });
});

// Delete message
exports.deleteMessage = catchAsync(async (req, res, next) => {
    const { roomId, messageId } = req.params;

    const message = await Message.findOne({
        _id: messageId,
        roomId,
        $or: [
            { sender: req.user.id },
            { receiver: req.user.id }
        ]
    });

    if (!message) {
        return next(new AppError('Message not found or you cannot delete it', 404));
    }

    // Soft delete
    message.deleted = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user.id;
    await message.save();

    res.status(200).json({
        status: 'success',
        message: 'Message deleted'
    });
});

// Mark message as read
exports.markAsRead = catchAsync(async (req, res, next) => {
    const { roomId, messageId } = req.params;

    const message = await Message.findOne({
        _id: messageId,
        roomId,
        sender: { $ne: req.user.id }
    });

    if (!message) {
        return next(new AppError('Message not found', 404));
    }

    message.isRead = true;
    message.readBy.push({
        userId: req.user.id,
        readAt: new Date()
    });
    await message.save();

    res.status(200).json({
        status: 'success',
        message: 'Message marked as read'
    });
});

// Add reaction to message
exports.addReaction = catchAsync(async (req, res, next) => {
    const { roomId, messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
        return next(new AppError('Emoji is required', 400));
    }

    const message = await Message.findOne({
        _id: messageId,
        roomId
    });

    if (!message) {
        return next(new AppError('Message not found', 404));
    }

    // Check if user already reacted with this emoji
    const existingReaction = message.reactions.find(
        r => r.userId.toString() === req.user.id && r.emoji === emoji
    );

    if (existingReaction) {
        // Remove reaction
        message.reactions = message.reactions.filter(
            r => !(r.userId.toString() === req.user.id && r.emoji === emoji)
        );
    } else {
        // Add reaction
        message.reactions.push({
            userId: req.user.id,
            emoji,
            reactedAt: new Date()
        });
    }

    await message.save();

    res.status(200).json({
        status: 'success',
        data: {
            reactions: message.reactions
        }
    });
});

// Search messages
exports.searchMessages = catchAsync(async (req, res, next) => {
    const { query, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    if (!query || query.trim().length < 2) {
        return next(new AppError('Search query must be at least 2 characters', 400));
    }

    const messages = await Message.find({
        $or: [
            { sender: req.user.id },
            { receiver: req.user.id },
            { participants: req.user.id }
        ],
        content: { $regex: query, $options: 'i' },
        deleted: false
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate('sender', 'username profileImage')
    .lean();

    res.status(200).json({
        status: 'success',
        results: messages.length,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit)
        },
        data: {
            messages
        }
    });
});

// Get unread message count
exports.getUnreadCount = catchAsync(async (req, res, next) => {
    const unreadCount = await Message.countDocuments({
        $or: [
            { receiver: req.user.id },
            { participants: req.user.id }
        ],
        sender: { $ne: req.user.id },
        isRead: false,
        deleted: false
    });

    res.status(200).json({
        status: 'success',
        data: {
            unreadCount
        }
    });
});

// Delete conversation
exports.deleteConversation = catchAsync(async (req, res, next) => {
    const { roomId } = req.params;

    // Mark all messages in conversation as deleted for this user
    await Message.updateMany(
        {
            roomId,
            $or: [
                { sender: req.user.id },
                { receiver: req.user.id }
            ]
        },
        {
            deleted: true,
            deletedAt: new Date(),
            deletedBy: req.user.id
        }
    );

    res.status(200).json({
        status: 'success',
        message: 'Conversation deleted'
    });
});
