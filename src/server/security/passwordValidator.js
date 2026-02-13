/**
 * Password strength validator
 * Enforces secure password requirements
 */

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

function validatePassword(password) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['password_required'] };
  }

  if (password.length < MIN_LENGTH) {
    errors.push(`password_too_short_min_${MIN_LENGTH}`);
  }

  if (password.length > MAX_LENGTH) {
    errors.push(`password_too_long_max_${MAX_LENGTH}`);
  }

  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push('password_needs_uppercase');
  }

  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    errors.push('password_needs_lowercase');
  }

  // Check for at least one number
  if (!/[0-9]/.test(password)) {
    errors.push('password_needs_number');
  }

  // Check for at least one special character
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('password_needs_special_char');
  }

  // Check for common weak passwords
  const commonPasswords = [
    'password', '12345678', 'password123', 'admin123',
    'qwerty', 'abc123', 'letmein', 'welcome'
  ];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('password_too_common');
  }

  // Check for repeated characters (e.g., "aaaa")
  if (/(.)\1{3,}/.test(password)) {
    errors.push('password_has_repeated_chars');
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    strength: calculateStrength(password)
  };
}

function calculateStrength(password) {
  if (!password) return 0;
  
  let strength = 0;
  
  // Length scoring
  if (password.length >= 8) strength += 1;
  if (password.length >= 12) strength += 1;
  if (password.length >= 16) strength += 1;
  
  // Character variety
  if (/[a-z]/.test(password)) strength += 1;
  if (/[A-Z]/.test(password)) strength += 1;
  if (/[0-9]/.test(password)) strength += 1;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 1;
  
  // Penalties
  if (/(.)\1{2,}/.test(password)) strength -= 1; // Repeated chars
  if (/^[0-9]+$/.test(password)) strength -= 2; // Only numbers
  if (/^[a-zA-Z]+$/.test(password)) strength -= 1; // Only letters
  
  return Math.max(0, Math.min(5, strength));
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  // Remove null bytes and trim
  return input.replace(/\0/g, '').trim();
}

module.exports = {
  validatePassword,
  calculateStrength,
  sanitizeInput
};

