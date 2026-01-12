const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    // Transaction Identification
    transactionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    referenceId: {
        type: String,
        index: true
    },
    
    // Parties Involved
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    gig: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gig'
    },
    proposal: {
        type: mongoose.Schema.Types.ObjectId
    },
    
    // Amount & Currency
    amount: {
        type: Number,
        required: true,
        min: 0.01
    },
    currency: {
        type: String,
        default: 'USD',
        enum: ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD']
    },
    fee: {
        type: Number,
        default: 0
    },
    tax: {
        type: Number,
        default: 0
    },
    netAmount: {
        type: Number,
        required: true
    },
    exchangeRate: Number,
    
    // Payment Details
    type: {
        type: String,
        enum: [
            'deposit', 
            'withdrawal', 
            'payment', 
            'refund', 
            'chargeback',
            'commission',
            'bonus',
            'tip'
        ],
        required: true
    },
    method: {
        type: String,
        enum: ['stripe', 'paypal', 'bank_transfer', 'wallet', 'card', 'crypto'],
        required: true
    },
    status: {
        type: String,
        enum: [
            'pending',
            'processing', 
            'completed',
            'failed',
            'cancelled',
            'refunded',
            'disputed',
            'on_hold'
        ],
        default: 'pending'
    },
    
    // Payment Provider Data
    providerId: String,
    providerData: mongoose.Schema.Types.Mixed,
    providerFees: Number,
    
    // Wallet Information
    senderWalletBalance: Number,
    receiverWalletBalance: Number,
    
    // Escrow Information (for gig payments)
    escrow: {
        type: Boolean,
        default: false
    },
    escrowStatus: {
        type: String,
        enum: ['held', 'released', 'refunded', 'disputed']
    },
    escrowReleaseDate: Date,
    escrowHeldUntil: Date,
    
    // Invoice/Receipt
    invoiceNumber: String,
    invoiceUrl: String,
    receiptUrl: String,
    
    // Dispute/Refund Information
    dispute: {
        reason: String,
        openedBy: mongoose.Schema.Types.ObjectId,
        openedAt: Date,
        resolvedAt: Date,
        resolution: String,
        notes: String
    },
    refund: {
        reason: String,
        initiatedBy: mongoose.Schema.Types.ObjectId,
        initiatedAt: Date,
        completedAt: Date,
        refundId: String
    },
    
    // Timeline
    initiatedAt: {
        type: Date,
        default: Date.now
    },
    processedAt: Date,
    completedAt: Date,
    failedAt: Date,
    cancelledAt: Date,
    
    // Metadata
    description: String,
    metadata: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    
    // Security
    verified: {
        type: Boolean,
        default: false
    },
    verificationCode: String,
    fraudScore: Number,
    
    // Audit Trail
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes
transactionSchema.index({ sender: 1, createdAt: -1 });
transactionSchema.index({ receiver: 1, createdAt: -1 });
transactionSchema.index({ gig: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ method: 1 });
transactionSchema.index({ 'providerData.payment_intent': 1 });
transactionSchema.index({ createdAt: -1 });

// Virtuals
transactionSchema.virtual('totalAmount').get(function() {
    return this.amount + this.fee + this.tax;
});

transactionSchema.virtual('isSuccessful').get(function() {
    return this.status === 'completed';
});

transactionSchema.virtual('isPending').get(function() {
    return this.status === 'pending' || this.status === 'processing';
});

// Pre-save middleware
transactionSchema.pre('save', function(next) {
    if (this.isModified('amount') || this.isModified('fee') || this.isModified('tax')) {
        this.netAmount = this.amount - this.fee - this.tax;
    }
    
    if (this.isNew && !this.transactionId) {
        this.transactionId = `TX${Date.now()}${Math.floor(Math.random() * 1000)}`;
    }
    
    if (this.isModified('status')) {
        const now = new Date();
        switch (this.status) {
            case 'processing':
                this.processedAt = now;
                break;
            case 'completed':
                this.completedAt = now;
                break;
            case 'failed':
                this.failedAt = now;
                break;
            case 'cancelled':
                this.cancelledAt = now;
                break;
        }
    }
    
    next();
});

// Static Methods
transactionSchema.statics.getUserTransactions = async function(userId, filters = {}) {
    const { page = 1, limit = 20, type, status, startDate, endDate } = filters;
    const skip = (page - 1) * limit;
    
    const query = {
        $or: [{ sender: userId }, { receiver: userId }],
        ...filters
    };
    
    if (type) query.type = type;
    if (status) query.status = status;
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    return this.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sender', 'username profileImage')
        .populate('receiver', 'username profileImage')
        .populate('gig', 'title')
        .lean();
};

transactionSchema.statics.getBalance = async function(userId) {
    const result = await this.aggregate([
        {
            $match: {
                $or: [{ sender: userId }, { receiver: userId }],
                status: 'completed'
            }
        },
        {
            $group: {
                _id: null,
                totalSent: {
                    $sum: {
                        $cond: [{ $eq: ['$sender', userId] }, '$amount', 0]
                    }
                },
                totalReceived: {
                    $sum: {
                        $cond: [{ $eq: ['$receiver', userId] }, '$amount', 0]
                    }
                },
                totalFees: {
                    $sum: {
                        $cond: [{ $eq: ['$sender', userId] }, '$fee', 0]
                    }
                }
            }
        }
    ]);
    
    return result[0] ? {
        totalSent: result[0].totalSent || 0,
        totalReceived: result[0].totalReceived || 0,
        totalFees: result[0].totalFees || 0,
        balance: (result[0].totalReceived || 0) - (result[0].totalSent || 0) - (result[0].totalFees || 0)
    } : { totalSent: 0, totalReceived: 0, totalFees: 0, balance: 0 };
};

transactionSchema.statics.createPayment = async function(paymentData) {
    const transaction = new this({
        ...paymentData,
        status: 'pending'
    });
    
    await transaction.save();
    
    // Create notification for receiver
    const Notification = mongoose.model('Notification');
    await Notification.createNotification(paymentData.receiver, {
        type: 'payment_received',
        title: 'Payment Received',
        message: `You have received a payment of $${paymentData.amount}`,
        data: {
            transactionId: transaction._id,
            amount: paymentData.amount
        },
        priority: 'high'
    });
    
    return transaction;
};

// Instance Methods
transactionSchema.methods.markAsCompleted = async function(providerData = {}) {
    this.status = 'completed';
    this.providerData = { ...this.providerData, ...providerData };
    this.completedAt = new Date();
    this.verified = true;
    
    await this.save();
    
    // Update user balances
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(this.receiver, {
        $inc: { balance: this.netAmount, earnings: this.netAmount }
    });
    
    return this;
};

transactionSchema.methods.initiateRefund = async function(reason, initiatedBy) {
    if (this.status !== 'completed') {
        throw new Error('Only completed transactions can be refunded');
    }
    
    this.status = 'refunded';
    this.refund = {
        reason,
        initiatedBy,
        initiatedAt: new Date(),
        refundId: `REF${Date.now()}`
    };
    
    await this.save();
    
    // Create refund transaction
    const refundTransaction = new this.constructor({
        sender: this.receiver,
        receiver: this.sender,
        amount: this.amount,
        type: 'refund',
        method: this.method,
        status: 'processing',
        description: `Refund for transaction ${this.transactionId}`,
        referenceId: this.transactionId
    });
    
    return refundTransaction.save();
};

module.exports = mongoose.model('Transaction', transactionSchema);
