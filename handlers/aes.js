require('dotenv').config();

const crypto = require('crypto');
const encryptionKey = process.env.ENCRYPTION_KEY

function generateIv() {
  return crypto.randomBytes(16).toString('hex');
}

function encrypt(text) {
  if (!encryptionKey || encryptionKey === "") {
    console.warn('No encryption key, password will not be encrypted');
    return text;
  }
  const iv = generateIv();
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'hex'), Buffer.from(iv, 'hex'));
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { iv: iv, encryptedData: encrypted };
}

function decrypt(encrypted) {
  if (!encryptionKey || encryptionKey === "") {
    console.warn('No encryption key, password will not be encrypted');
    return encrypted;
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'hex'), Buffer.from(encrypted.iv, 'hex'));
  let decrypted = decipher.update(encrypted.encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};