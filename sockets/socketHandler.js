const Notification = require('../models/Notification');
const User = require('../models/User');
const Message = require('../models/Message');
const Gig = require('../models/Gig');

class SocketHandler {
    constructor(io) {
        this.io = io;
        this.connectedUsers = new Map(); // userId -> socketId
        this.userRooms = new Map(); // userId -> [roomIds]
        
        this.initializeMiddleware();
        this.initializeEvents();
    }

    // Initialize socket middleware for authentication
    initializeMiddleware() {
        const jwt = require('jsonwebtoken');
        
        this.io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth.token || 
                             socket.handshake.headers.authorization?.split(' ')[1];
                
                if (!token) {
                    return next(new Error('Authentication error: No token provided'));
                }

                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id).select('isActive');
                
                if (!user || !user.isActive) {
                    return next(new Error('Authentication error: User not found or inactive'));
                }

                socket.userId = decoded.id;
                socket.userRole = decoded.role;
                next();
            } catch (error) {
                next(new Error('Authentication error: Invalid token'));
            }
        });
    }

    // Initialize socket event handlers
    initializeEvents() {
        this.io.on('connection', (socket) => {
            console.log(`User connected: ${socket.userId}`);

            // Store user connection
            this.connectedUsers.set(socket.userId, socket.id);
            
            // Join user to personal room for notifications
            socket.join(`user:${socket.userId}`);

            // Handle user joining specific rooms
            socket.on('join-room', (roomId) => {
                socket.join(roomId);
                if (!this.userRooms.has(socket.userId)) {
                    this.userRooms.set(socket.userId, new Set());
                }
                this.userRooms.get(socket.userId).add(roomId);
                console.log(`User ${socket.userId} joined room ${roomId}`);
            });

            // Handle user leaving rooms
            socket.on('leave-room', (roomId) => {
                socket.leave(roomId);
                if (this.userRooms.has(socket.userId)) {
                    this.userRooms.get(socket.userId).delete(roomId);
                }
                console.log(`User ${socket.userId} left room ${roomId}`);
            });

            // â­â­â­ REAL-TIME NOTIFICATION: Freelancer hired â­â­â­
            socket.on('listen-for-hires', async () => {
                // User is now listening for hire notifications
                console.log(`User ${socket.userId} listening for hire notifications`);
            });

            // Handle chat messages
            socket.on('send-message', async (data) => {
                try {
                    const { roomId, content, type = 'text', attachments = [] } = data;
                    
                    // Save message to database
                    const message = new Message({
                        roomId,
                        sender: socket.userId,
                        content,
                        type,
                        attachments
                    });
                    
                    await message.save();
                    
                    // Populate sender info
                    await message.populate('sender', 'username profileImage');
                    
                    // Emit to all users in the room except sender
                    socket.to(roomId).emit('receive-message', {
                        message,
                        roomId
                    });
                    
                    // Also send to sender for confirmation
                    socket.emit('message-sent', {
                        message,
                        roomId,
                        status: 'delivered'
                    });

                    // Create notification for receiver(s)
                    await this.createMessageNotification(roomId, socket.userId, content);

                } catch (error) {
                    console.error('Error sending message:', error);
                    socket.emit('message-error', {
                        error: 'Failed to send message'
                    });
                }
            });

            // Handle typing indicators
            socket.on('typing-start', (data) => {
                const { roomId } = data;
                socket.to(roomId).emit('user-typing', {
                    userId: socket.userId,
                    roomId,
                    isTyping: true
                });
            });

            socket.on('typing-stop', (data) => {
                const { roomId } = data;
                socket.to(roomId).emit('user-typing', {
                    userId: socket.userId,
                    roomId,
                    isTyping: false
                });
            });

            // Handle message read receipts
            socket.on('mark-message-read', async (data) => {
                try {
                    const { messageId, roomId } = data;
                    
                    await Message.markAsRead(roomId, socket.userId);
                    
                    // Notify sender that message was read
                    const message = await Message.findById(messageId);
                    if (message && message.sender.toString() !== socket.userId) {
                        this.io.to(`user:${message.sender}`).emit('message-read', {
                            messageId,
                            roomId,
                            readBy: socket.userId,
                            readAt: new Date()
                        });
                    }
                } catch (error) {
                    console.error('Error marking message as read:', error);
                }
            });

            // Handle online status
            socket.on('update-status', (status) => {
                socket.broadcast.emit('user-status', {
                    userId: socket.userId,
                    status,
                    lastSeen: new Date()
                });
            });

            // Handle disconnection
            socket.on('disconnect', () => {
                console.log(`User disconnected: ${socket.userId}`);
                this.connectedUsers.delete(socket.userId);
                
                if (this.userRooms.has(socket.userId)) {
                    this.userRooms.delete(socket.userId);
                }
                
                // Broadcast user offline status
                socket.broadcast.emit('user-status', {
                    userId: socket.userId,
                    status: 'offline',
                    lastSeen: new Date()
                });
            });
        });
    }

    // â­â­â­ CRITICAL: Send real-time hire notification â­â­â­
    async sendHireNotification(gigId, freelancerId, clientId) {
        try {
            const gig = await Gig.findById(gigId).populate('client', 'username');
            const client = await User.findById(clientId).select('username');
            
            if (!gig || !client) {
                console.error('Gig or client not found for notification');
                return;
            }

            const notificationData = {
                type: 'proposal_accepted',
                title: 'í¾‰ You\'ve Been Hired! í¾‰',
                message: `Congratulations! You have been hired by ${client.username} for the gig "${gig.title}"`,
                data: {
                    gigId: gig._id,
                    gigTitle: gig.title,
                    clientId: client._id,
                    clientName: client.username,
                    timestamp: new Date()
                },
                priority: 'high'
            };

            // 1. Save to database
            const notification = await Notification.createNotification(
                freelancerId,
                notificationData
            );

            // 2. Send real-time notification via socket
            const freelancerSocketId = this.connectedUsers.get(freelancerId.toString());
            
            if (freelancerSocketId) {
                this.io.to(freelancerSocketId).emit('notification', {
                    type: 'hire',
                    data: {
                        ...notificationData,
                        notificationId: notification._id,
                        isRealTime: true
                    }
                });
                
                console.log(`í³¢ Real-time hire notification sent to freelancer ${freelancerId}`);
            } else {
                console.log(`Freelancer ${freelancerId} is offline. Notification saved to database.`);
            }

            // 3. Also send to freelancer's personal room
            this.io.to(`user:${freelancerId}`).emit('new-notification', {
                ...notificationData,
                notificationId: notification._id
            });

        } catch (error) {
            console.error('Error sending hire notification:', error);
        }
    }

    // Send real-time proposal notification to client
    async sendProposalNotification(gigId, freelancerId, clientId) {
        try {
            const gig = await Gig.findById(gigId);
            const freelancer = await User.findById(freelancerId).select('username');
            
            if (!gig || !freelancer) {
                console.error('Gig or freelancer not found for notification');
                return;
            }

            const notificationData = {
                type: 'proposal_received',
                title: 'New Proposal Received',
                message: `${freelancer.username} submitted a proposal for your gig "${gig.title}"`,
                data: {
                    gigId: gig._id,
                    gigTitle: gig.title,
                    freelancerId: freelancer._id,
                    freelancerName: freelancer.username,
                    timestamp: new Date()
                },
                priority: 'medium'
            };

            // Send real-time notification
            const clientSocketId = this.connectedUsers.get(clientId.toString());
            
            if (clientSocketId) {
                this.io.to(clientSocketId).emit('notification', {
                    type: 'proposal',
                    data: notificationData
                });
            }

            // Also send to client's personal room
            this.io.to(`user:${clientId}`).emit('new-notification', notificationData);

        } catch (error) {
            console.error('Error sending proposal notification:', error);
        }
    }

    // Create notification for new messages
    async createMessageNotification(roomId, senderId, messageContent) {
        try {
            // Get conversation participants
            const messages = await Message.find({ roomId }).distinct('sender');
            const participants = messages.filter(id => id.toString() !== senderId.toString());
            
            for (const participantId of participants) {
                const participantSocketId = this.connectedUsers.get(participantId.toString());
                
                if (participantSocketId) {
                    // User is online, send real-time notification
                    this.io.to(participantSocketId).emit('new-message', {
                        roomId,
                        senderId,
                        message: messageContent.substring(0, 100) + (messageContent.length > 100 ? '...' : ''),
                        timestamp: new Date()
                    });
                }
                
                // Also save to database for offline users
                await Notification.createNotification(participantId, {
                    type: 'message_received',
                    title: 'New Message',
                    message: `You have a new message in conversation ${roomId}`,
                    data: {
                        roomId,
                        senderId
                    },
                    priority: 'medium'
                });
            }
        } catch (error) {
            console.error('Error creating message notification:', error);
        }
    }

    // Get online users
    getOnlineUsers() {
        return Array.from(this.connectedUsers.keys());
    }

    // Check if user is online
    isUserOnline(userId) {
        return this.connectedUsers.has(userId);
    }

    // Get user's socket ID
    getUserSocketId(userId) {
        return this.connectedUsers.get(userId);
    }

    // Send notification to specific user
    sendToUser(userId, event, data) {
        const socketId = this.connectedUsers.get(userId);
        if (socketId) {
            this.io.to(socketId).emit(event, data);
            return true;
        }
        return false;
    }

    // Broadcast to all users except sender
    broadcastToAll(event, data, excludeUserId = null) {
        if (excludeUserId) {
            const excludeSocketId = this.connectedUsers.get(excludeUserId);
            if (excludeSocketId) {
                this.io.except(excludeSocketId).emit(event, data);
            } else {
                this.io.emit(event, data);
            }
        } else {
            this.io.emit(event, data);
        }
    }

    // Send to specific room
    sendToRoom(roomId, event, data) {
        this.io.to(roomId).emit(event, data);
    }

    // Get all rooms a user is in
    getUserRooms(userId) {
        return this.userRooms.has(userId) ? 
            Array.from(this.userRooms.get(userId)) : [];
    }
}

module.exports = SocketHandler;
