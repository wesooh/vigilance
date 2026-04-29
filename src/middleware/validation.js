const { body, validationResult } = require('express-validator');

const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    
    res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  };
};

// Common validations
const validatePhoneNumber = body('phoneNumber')
  .matches(/^(\+254|0)[7-9][0-9]{8}$/)
  .withMessage('Invalid Kenyan phone number');

const validateEmail = body('email')
  .isEmail()
  .withMessage('Valid email is required');

const validatePassword = body('password')
  .isLength({ min: 6 })
  .withMessage('Password must be at least 6 characters');

const validateLocation = body('location')
  .optional()
  .isObject()
  .withMessage('Location must be an object');

module.exports = {
  validate,
  validatePhoneNumber,
  validateEmail,
  validatePassword,
  validateLocation
};