const Joi = require('joi');

// Gig creation validation
const createGigSchema = Joi.object({
    title: Joi.string()
        .min(10)
        .required(),
    
    description: Joi.string()
        .min(100)
        .required(),
    
    category: Joi.string()
        .valid('web-development', 'mobile-development', 'design', 'writing', 'marketing', 'data-science', 'other')
        .required(),
    
    budget: Joi.number()
        .min(1)
        .required(),
    
    deadline: Joi.date()
        .greater('now')
        .required(),
    
    skillsRequired: Joi.array()
        .items(Joi.string())
        .optional()
});

// Proposal submission validation
const submitProposalSchema = Joi.object({
    coverLetter: Joi.string()
        .min(50)
        .required(),
    
    bidAmount: Joi.number()
        .min(1)
        .required(),
    
    estimatedTime: Joi.string()
        .required()
});

module.exports = {
    createGigSchema,
    submitProposalSchema
};
