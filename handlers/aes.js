require('dotenv').config();

const crypto = require('crypto');
const { logError } = require('../handlers/logs');
const encryptionKey = process.env.ENCRYPTION_KEY

function generateIv() {
  return crypto.randomBytes(16).toString('hex');
}

function encrypt(password) {
  try {
    if (!encryptionKey || encryptionKey === "") {
      console.warn('No encryption key, password will not be encrypted');
      return password;
    }
    const iv = generateIv();
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'hex'), Buffer.from(iv, 'hex'));
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { iv: iv, encryptedData: encrypted };
  } catch (error) {
    logError('Error in encrypt', error)
  }
}

function decrypt(encrypted) {
  try {
    if (!encryptionKey || encryptionKey === "") {
      console.warn('No encryption key, password will not be encrypted');
      return encrypted;
    }
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'hex'), Buffer.from(encrypted.iv, 'hex'));
    let decrypted = decipher.update(encrypted.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    logError('Error in decrypt', error)
  }

}

module.exports = {
  encrypt,
  decrypt
};