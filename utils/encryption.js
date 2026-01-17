const crypto = require("crypto");
const { Buffer } = require("buffer");
require("dotenv").config({ path: ".env.local" });

const algorithm = "aes-256-cbc";

const SECRET = process.env.MESSAGE_SECRET;
if (!SECRET) {
  throw new Error("MESSAGE_SECRET is not defined");
}

const secretKey = crypto
  .createHash("sha256")
  .update(SECRET)
  .digest()
  .slice(0, 32);

const ivLength = 16;

// Encrypt
exports.encrypt = (text) => {
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  return iv.toString("hex") + ":" + encrypted;
};

// Decrypt
exports.decrypt = (encryptedText) => {
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");

  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};
