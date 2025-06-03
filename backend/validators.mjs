// validators.mjs - Input validation utilities
import { PublicKey } from '@solana/web3.js';

// Validates Solana public key/address
export function isValidSolanaAddress(address) {
    try {
        new PublicKey(address);
        return true;
    } catch (error) {
        return false;
    }
}

// Sanitize and validate wallet name
export function sanitizeWalletName(walletName) {
    if (!walletName || typeof walletName !== 'string') return null;
    
    // Remove any potentially dangerous characters and limit length
    const sanitized = walletName
        .replace(/[<>{}[\]()]/g, '')
        .trim()
        .substring(0, 50);
        
    return sanitized || null;
}

// Validate public hash for status/collection endpoints
export function validatePublicHash(hash) {
    if (!hash || typeof hash !== 'string') return null;
    
    // Check if hash is alphanumeric with possible dashes
    if (!hash.match(/^[a-zA-Z0-9-]+$/)) return null;
    
    return hash;
}

// Helper to validate and sanitize request bodies
export function validateSubmissionBody(body) {
    if (!body || typeof body !== 'object') {
        return { valid: false, error: "Invalid request body format" };
    }
    
    const { walletName, publicHash, walletAddress } = body;
    
    // Check required fields
    if (!walletName || !publicHash || !walletAddress) {
        return { 
            valid: false, 
            error: "Missing required fields: walletName, publicHash, or walletAddress" 
        };
    }
    
    // Validate and sanitize wallet name
    const sanitizedWalletName = sanitizeWalletName(walletName);
    if (!sanitizedWalletName) {
        return { valid: false, error: "Invalid wallet name format" };
    }
    
    // Validate public hash
    const validatedHash = validatePublicHash(publicHash);
    if (!validatedHash) {
        return { valid: false, error: "Invalid public hash format" };
    }
    
    // Validate Solana address
    if (!isValidSolanaAddress(walletAddress)) {
        return { valid: false, error: "Invalid Solana wallet address" };
    }
    
    return { 
        valid: true, 
        sanitizedData: {
            walletName: sanitizedWalletName,
            publicHash: validatedHash,
            walletAddress
        }
    };
}
