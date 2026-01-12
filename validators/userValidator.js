const Joi = require('joi');

// User registration validation
const registerSchema = Joi.object({
    username: Joi.string()
        .alphanum()
        .min(3)
        .max(30)
        .required(),
    
    email: Joi.string()
        .email()
        .required(),
    
    password: Joi.string()
        .min(6)
        .required(),
    
    role: Joi.string()
        .valid('freelancer', 'client')
        .default('client')
});

// User login validation
const loginSchema = Joi.object({
    email: Joi.string()
        .email()
        .required(),
    
    password: Joi.string()
        .required()
});

module.exports = {
    registerSchema,
    loginSchema
};