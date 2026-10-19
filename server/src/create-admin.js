require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./models');

async function main() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD, MONGODB_URI } = process.env;
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in the process environment.');
  }
  await mongoose.connect(MONGODB_URI || 'mongodb://127.0.0.1:27017/lastplate');
  const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });
  if (existing) throw new Error('An account with that email already exists; no changes were made.');
  const admin = await User.create({ name: ADMIN_NAME, email: ADMIN_EMAIL, password: await bcrypt.hash(ADMIN_PASSWORD, 12), role: 'admin', providerApproved: true });
  console.log(`Admin account created: ${admin.email}`);
  await mongoose.disconnect();
}
main().catch(async error => { console.error(error.message); if (mongoose.connection.readyState) await mongoose.disconnect(); process.exitCode = 1; });
