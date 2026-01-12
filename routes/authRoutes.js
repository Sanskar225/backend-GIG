const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// ====================================
// PUBLIC ROUTES (No authentication required)
// ====================================
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/verify-email/:token', authController.verifyEmail);
router.get('/check-username/:username', authController.checkUsernameAvailability);
router.get('/check-email/:email', authController.checkEmailAvailability);

// ====================================
// PROTECTED ROUTES (Authentication required)
// ====================================
router.use(auth); // All routes below this require authentication

router.get('/me', authController.getMe);
router.patch('/update-me', authController.updateMe);
router.patch('/update-password', authController.updatePassword);
router.post('/logout', authController.logout);
router.delete('/delete-me', authController.deleteMe);
router.get('/stats', authController.getUserStats);
router.post('/upload-profile-image', authController.uploadProfileImage);

module.exports = router;