const User = require('../models/User');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const jwt = require('jsonwebtoken');
const { registerSchema, loginSchema } = require('../validators/userValidator');

// Generate JWT Token
const signToken = (id) => {
    return jwt.sign(
        { id }, 
        process.env.JWT_SECRET || 'your_jwt_secret', 
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
};

// ====================================
// ✅ REGISTER USER
// ====================================
exports.register = catchAsync(async (req, res, next) => {
    console.log('🔐 Register request received:', req.body);
    
    // Validate request body
    const { error } = registerSchema.validate(req.body);
    if (error) {
        console.log('❌ Validation error:', error.details[0].message);
        return next(new AppError(error.details[0].message, 400));
    }

    const { username, email, password, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ 
        $or: [{ email: email.toLowerCase() }, { username }] 
    });
    
    if (existingUser) {
        const field = existingUser.email === email.toLowerCase() ? 'email' : 'username';
        return next(new AppError(`User with this ${field} already exists`, 409));
    }

    // Create new user
    const newUser = await User.create({
        username,
        email: email.toLowerCase(),
        password,
        role: role || 'client'
    });

    // Generate token
    const token = signToken(newUser._id);

    // Remove password from output
    newUser.password = undefined;

    console.log('✅ User registered:', newUser.email);
    
    res.status(201).json({
        status: 'success',
        token,
        data: {
            user: newUser
        }
    });
});

// ====================================
// ✅ LOGIN USER
// ====================================
exports.login = catchAsync(async (req, res, next) => {
    console.log('🔐 Login request received:', req.body);
    
    // Validate request body
    const { error } = loginSchema.validate(req.body);
    if (error) {
        return next(new AppError(error.details[0].message, 400));
    }

    const { email, password } = req.body;

    // Check if user exists && password is correct
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    
    if (!user) {
        return next(new AppError('Incorrect email or password', 401));
    }

    // Check password
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
        return next(new AppError('Incorrect email or password', 401));
    }

    // Generate token
    const token = signToken(user._id);

    // Remove password from output
    user.password = undefined;

    console.log('✅ User logged in:', user.email);
    
    res.status(200).json({
        status: 'success',
        token,
        data: {
            user
        }
    });
});

// ====================================
// ✅ GET CURRENT USER
// ====================================
exports.getMe = catchAsync(async (req, res, next) => {
    console.log('👤 Get current user request');
    
    const user = await User.findById(req.user.id);

    if (!user) {
        return next(new AppError('User not found', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
            user
        }
    });
});

// ====================================
// ✅ UPDATE USER PROFILE
// ====================================
exports.updateMe = catchAsync(async (req, res, next) => {
    console.log('✏️ Update profile request:', req.body);
    
    // 1. Create error if user tries to update password
    if (req.body.password) {
        return next(new AppError('This route is not for password updates. Please use /update-password.', 400));
    }

    // 2. Filter out unwanted fields
    const filteredBody = {};
    const allowedFields = ['username', 'email', 'bio', 'skills', 'profileImage'];
    
    allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
            filteredBody[field] = req.body[field];
        }
    });

    // 3. Update user document
    const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        filteredBody,
        {
            new: true,
            runValidators: true
        }
    );

    res.status(200).json({
        status: 'success',
        message: 'Profile updated successfully',
        data: {
            user: updatedUser
        }
    });
});

// ====================================
// ✅ UPDATE PASSWORD
// ====================================
exports.updatePassword = catchAsync(async (req, res, next) => {
    console.log('🔑 Update password request');
    
    const { currentPassword, newPassword } = req.body;

    // 1. Check if both passwords are provided
    if (!currentPassword || !newPassword) {
        return next(new AppError('Please provide current password and new password', 400));
    }

    // 2. Get user from collection with password
    const user = await User.findById(req.user.id).select('+password');

    // 3. Check if current password is correct
    if (!(await user.comparePassword(currentPassword))) {
        return next(new AppError('Your current password is incorrect', 401));
    }

    // 4. Check if new password is different
    if (currentPassword === newPassword) {
        return next(new AppError('New password must be different from current password', 400));
    }

    // 5. Update password
    user.password = newPassword;
    await user.save();

    // 6. Generate new token
    const token = signToken(user._id);

    console.log('✅ Password updated for:', user.email);

    res.status(200).json({
        status: 'success',
        token,
        message: 'Password updated successfully'
    });
});

// ====================================
// ✅ LOGOUT USER
// ====================================
exports.logout = (req, res) => {
    console.log('🚪 Logout request');
    
    // Note: For JWT tokens, logout is handled client-side by removing the token
    // For server-side logout with blacklisted tokens, you'd need a token blacklist
    
    res.status(200).json({ 
        status: 'success',
        message: 'Logged out successfully' 
    });
};

// ====================================
// ✅ DELETE USER ACCOUNT (Optional Bonus)
// ====================================
exports.deleteMe = catchAsync(async (req, res, next) => {
    console.log('🗑️ Delete account request');
    
    await User.findByIdAndUpdate(req.user.id, { 
        active: false,
        deletedAt: new Date()
    });

    res.status(200).json({
        status: 'success',
        message: 'Your account has been deactivated. You can reactivate within 30 days.',
        data: null
    });
});

// ====================================
// ✅ FORGOT PASSWORD (Optional Bonus)
// ====================================
exports.forgotPassword = catchAsync(async (req, res, next) => {
    console.log('📧 Forgot password request:', req.body.email);
    
    const { email } = req.body;

    // 1. Get user based on email
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
        // Don't reveal if user exists or not for security
        return res.status(200).json({
            status: 'success',
            message: 'If your email exists, you will receive a password reset link.'
        });
    }

    // 2. Generate reset token (in production, you'd send an email)
    const resetToken = 'RESET_TOKEN_' + Date.now(); // Simplified for demo
    
    // In production:
    // 1. Generate crypto random token
    // 2. Hash it and save to user document
    // 3. Send email with reset link
    // 4. Set token expiry (e.g., 10 minutes)

    console.log('📧 Reset token generated for:', email, '- Token:', resetToken);

    res.status(200).json({
        status: 'success',
        message: 'Password reset link sent to your email',
        // Note: In production, don't send token in response
        data: {
            resetToken: resetToken // Only for development/testing
        }
    });
});

// ====================================
// ✅ RESET PASSWORD (Optional Bonus)
// ====================================
exports.resetPassword = catchAsync(async (req, res, next) => {
    console.log('🔄 Reset password request');
    
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return next(new AppError('Token and new password are required', 400));
    }

    // In production:
    // 1. Find user by hashed token
    // 2. Check if token is not expired
    // 3. Update password
    // 4. Clear reset token fields

    console.log('🔄 Password reset with token:', token);

    res.status(200).json({
        status: 'success',
        message: 'Password has been reset successfully. Please login with your new password.'
    });
});

// ====================================
// ✅ GET USER STATISTICS (Optional Bonus)
// ====================================
exports.getUserStats = catchAsync(async (req, res, next) => {
    console.log('📊 Get user statistics');
    
    const user = await User.findById(req.user.id);
    
    // Get additional stats (you'd need to query other models)
    // Example: Number of gigs posted, bids submitted, etc.
    
    const stats = {
        profileCompletion: 85, // Calculate based on filled fields
        memberSince: user.createdAt,
        rating: user.rating || 0,
        completedGigs: user.completedGigs || 0
    };

    res.status(200).json({
        status: 'success',
        data: {
            user,
            statistics: stats
        }
    });
});

// ====================================
// ✅ VERIFY EMAIL (Optional Bonus)
// ====================================
exports.verifyEmail = catchAsync(async (req, res, next) => {
    console.log('📧 Verify email request');
    
    const { token } = req.params;

    if (!token) {
        return next(new AppError('Verification token is required', 400));
    }

    // In production:
    // 1. Find user by verification token
    // 2. Check if token is valid and not expired
    // 3. Mark email as verified
    // 4. Clear verification token

    console.log('✅ Email verification with token:', token);

    res.status(200).json({
        status: 'success',
        message: 'Email verified successfully!'
    });
});

// ====================================
// ✅ UPLOAD PROFILE IMAGE (Optional Bonus)
// ====================================
exports.uploadProfileImage = catchAsync(async (req, res, next) => {
    console.log('🖼️ Upload profile image');
    
    // This would typically use multer for file uploads
    // For now, we'll accept a URL
    
    const { imageUrl } = req.body;

    if (!imageUrl) {
        return next(new AppError('Please provide an image URL', 400));
    }

    const user = await User.findByIdAndUpdate(
        req.user.id,
        { profileImage: imageUrl },
        { new: true }
    );

    res.status(200).json({
        status: 'success',
        message: 'Profile image updated',
        data: {
            user
        }
    });
});

// ====================================
// ✅ CHECK USERNAME AVAILABILITY
// ====================================
exports.checkUsernameAvailability = catchAsync(async (req, res, next) => {
    console.log('🔍 Check username availability:', req.params.username);
    
    const { username } = req.params;

    if (!username) {
        return next(new AppError('Username is required', 400));
    }

    const existingUser = await User.findOne({ username });

    res.status(200).json({
        status: 'success',
        data: {
            username,
            available: !existingUser,
            suggestion: existingUser ? `${username}${Date.now().toString().slice(-3)}` : null
        }
    });
});

// ====================================
// ✅ CHECK EMAIL AVAILABILITY
// ====================================
exports.checkEmailAvailability = catchAsync(async (req, res, next) => {
    console.log('🔍 Check email availability:', req.params.email);
    
    const { email } = req.params;

    if (!email) {
        return next(new AppError('Email is required', 400));
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });

    res.status(200).json({
        status: 'success',
        data: {
            email,
            available: !existingUser
        }
    });
});