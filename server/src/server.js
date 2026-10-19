require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { User, Listing, Reservation, AuditLog } = require('./models');
const openapi = require('./openapi');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const passwordRequirements = 'Use at least 8 characters, including an uppercase letter, a lowercase letter, a number, and a symbol.';
const isStrongPassword = value => typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value, 'utf8') <= 72 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9\s]/.test(value);
const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const resetMessage = 'If an active account uses that email, password reset instructions will be sent.';
const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);
const localResetLinksEnabled = () => process.env.NODE_ENV !== 'production' && process.env.PASSWORD_RESET_ALLOW_DEV_LINKS === 'true';
const sendPasswordResetEmail = async (email, resetUrl) => {
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Reset your LastPlate password',
    text: `Use this link to reset your LastPlate password. It expires in 15 minutes: ${resetUrl}`,
    html: `<p>We received a request to reset your LastPlate password.</p><p><a href="${resetUrl}">Choose a new password</a></p><p>This link expires in 15 minutes. If you did not request this, you can ignore this email.</p>`
  });
};
const sign = user => jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
const protect = asyncRoute(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(payload.sub);
    if (!req.user) return res.status(401).json({ message: 'Account not found.' });
    if (req.user.status === 'suspended') return res.status(403).json({ message: 'This account is suspended. Contact platform support.' });
    next();
  } catch { return res.status(401).json({ message: 'Your session has expired. Please sign in again.' }); }
});
const allow = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'You do not have permission to do that.' });

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'lastplate-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.get('/api/docs', (req, res) => res.json(openapi));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, password, role } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!String(name || '').trim() || !email || !password) return res.status(400).json({ message: 'Name, email and password are required.' });
  if (String(name).trim().length < 2 || String(name).trim().length > 80) return res.status(400).json({ message: 'Name must be between 2 and 80 characters.' });
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!isStrongPassword(password)) return res.status(400).json({ message: passwordRequirements });
  if (role === 'admin') return res.status(403).json({ message: 'Admin accounts are provisioned by the platform.' });
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ message: 'An account with this email already exists.' });
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 12), role: role === 'provider' ? 'provider' : 'customer' });
  res.status(201).json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, avatarEmoji: user.avatarEmoji, providerApproved: user.providerApproved, status: user.status } });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Enter your email address.' });
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ message: 'Email or password is incorrect.' });
  res.json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, avatarEmoji: user.avatarEmoji, providerApproved: user.providerApproved, status: user.status } });
}));
app.post('/api/auth/forgot-password', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Enter your email address.' });
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!smtpConfigured() && !localResetLinksEnabled()) return res.status(503).json({ message: 'Password reset is not configured. Set up SMTP email or enable local development reset links.' });

  const user = await User.findOne({ email, status: 'active' });
  if (!user) return res.json({ message: resetMessage });

  const token = crypto.randomBytes(32).toString('hex');
  user.passwordResetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
  user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
  await user.save();

  const resetUrl = new URL('/reset-password', process.env.CLIENT_ORIGIN || 'http://localhost:5173');
  resetUrl.searchParams.set('token', token);
  if (smtpConfigured()) {
    try {
      await sendPasswordResetEmail(user.email, resetUrl.toString());
    } catch (error) {
      console.error('Password reset email could not be sent:', error.message);
      return res.status(503).json({ message: 'We could not send the reset email right now. Please try again later.' });
    }
    return res.json({ message: resetMessage });
  }

  // Explicit opt-in for local development: show a link in the UI when no email transport is configured.
  res.json({ message: resetMessage, devResetUrl: resetUrl.toString() });
}));
app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ message: 'Reset link and new password are required.' });
  if (!isStrongPassword(password)) return res.status(400).json({ message: passwordRequirements });

  const passwordResetTokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const result = await User.updateOne(
    { passwordResetTokenHash, passwordResetExpires: { $gt: new Date() }, status: 'active' },
    { $set: { password: await bcrypt.hash(password, 12) }, $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 } }
  );
  if (!result.modifiedCount) return res.status(400).json({ message: 'This reset link is invalid or expired. Request a new one.' });
  res.json({ message: 'Your password has been reset. You can now sign in.' });
}));
app.get('/api/auth/me', protect, (req, res) => res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, phone: req.user.phone, avatarEmoji: req.user.avatarEmoji, providerApproved: req.user.providerApproved, status: req.user.status } }));
app.patch('/api/auth/me', protect, asyncRoute(async (req, res) => {
  const { name, phone, avatarEmoji } = req.body;
  if (name !== undefined) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  if (avatarEmoji !== undefined) req.user.avatarEmoji = avatarEmoji;
  await req.user.save();
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, phone: req.user.phone, avatarEmoji: req.user.avatarEmoji, providerApproved: req.user.providerApproved, status: req.user.status } });
}));

app.get('/api/foods', asyncRoute(async (req, res) => {
  const { q, category, minPrice, maxPrice, minDiscount, pickupAfter, pickupBefore, sort = 'newest', page = 1, limit = 12 } = req.query;
  const filter = { status: 'active', available: { $gt: 0 }, pickupEnd: { $gt: new Date() } };
  if (category) filter.category = category;
  if (q) filter.$text = { $search: q };
  if (minPrice || maxPrice) filter.price = { ...(minPrice && { $gte: Number(minPrice) }), ...(maxPrice && { $lte: Number(maxPrice) }) };
  if (pickupAfter || pickupBefore) filter.pickupStart = { ...(pickupAfter && { $gte: new Date(pickupAfter) }), ...(pickupBefore && { $lte: new Date(pickupBefore) }) };
  const pageSize = Math.min(Math.max(Number(limit) || 12, 1), 40), currentPage = Math.max(Number(page) || 1, 1);
  const sortBy = sort === 'price' ? { price: 1, createdAt: -1 } : sort === 'discount' ? { discountPct: -1, createdAt: -1 } : { createdAt: -1 };
  const pipeline = [
    { $match: filter },
    { $addFields: { discountPct: { $multiply: [{ $divide: [{ $subtract: ['$originalPrice', '$price'] }, '$originalPrice'] }, 100] } } }
  ];
  if (minDiscount) pipeline.push({ $match: { discountPct: { $gte: Number(minDiscount) } } });
  pipeline.push({ $facet: {
    items: [
      { $sort: sortBy }, { $skip: (currentPage - 1) * pageSize }, { $limit: pageSize },
      { $lookup: { from: User.collection.name, localField: 'provider', foreignField: '_id', pipeline: [{ $project: { name: 1 } }], as: 'providerUser' } },
      { $addFields: { provider: { $ifNull: [{ $arrayElemAt: ['$providerUser', 0] }, { name: '$providerName' }] } } },
      { $project: { providerUser: 0, discountPct: 0 } }
    ],
    metadata: [{ $count: 'total' }]
  } });
  const [result] = await Listing.aggregate(pipeline);
  const total = result?.metadata[0]?.total || 0;
  res.json({ items: result?.items || [], total, page: currentPage, pages: Math.ceil(total / pageSize) });
}));
app.get('/api/foods/:id', asyncRoute(async (req, res) => {
  const item = await Listing.findById(req.params.id).populate('provider', 'name');
  if (!item) return res.status(404).json({ message: 'This food deal could not be found.' });
  res.json({ item });
}));

app.post('/api/foods', protect, allow('provider'), asyncRoute(async (req, res) => {
  const ingredients = Array.isArray(req.body.ingredients) ? req.body.ingredients : String(req.body.ingredients || '').split(',').map(item => item.trim()).filter(Boolean);
  const allergens = Array.isArray(req.body.allergens) ? req.body.allergens : String(req.body.allergens || '').split(',').map(item => item.trim()).filter(Boolean);
  const data = { ...req.body, ingredients, allergens, provider: req.user.id, providerName: req.user.name, available: req.body.quantity, status: req.user.providerApproved ? 'active' : 'pending_approval' };
  if (data.useBy) data.useBy = new Date(data.useBy); else delete data.useBy;
  if (new Date(data.pickupStart) <= new Date() || new Date(data.pickupEnd) <= new Date(data.pickupStart) || new Date(data.pickupEnd) <= new Date()) return res.status(400).json({ message: 'Pickup start must be in the future and pickup end must be after start.' });
  const item = await Listing.create(data); res.status(201).json({ item });
}));
app.patch('/api/foods/:id', protect, allow('provider'), asyncRoute(async (req, res) => {
  if (req.body.status === 'active' && !req.user.providerApproved) return res.status(403).json({ message: 'Your partner account must be approved before you can publish listings.' });
  const item = await Listing.findOne({ _id: req.params.id, provider: req.user.id });
  if (!item) return res.status(404).json({ message: 'Listing not found.' });
  const editable = ['title', 'description', 'category', 'image', 'originalPrice', 'price', 'quantity', 'pickupStart', 'pickupEnd', 'useBy', 'address', 'ingredients', 'allergens', 'status'];
  editable.forEach(key => { if (req.body[key] !== undefined) item[key] = key === 'useBy' && !req.body[key] ? undefined : req.body[key]; });
  if (req.body.quantity !== undefined) {
    const committed = await Reservation.aggregate([{ $match: { listing: item._id, status: { $in: ['reserved', 'collected'] } } }, { $group: { _id: null, quantity: { $sum: '$quantity' } } }]);
    const alreadyCommitted = committed[0]?.quantity || 0;
    if (Number(req.body.quantity) < alreadyCommitted) return res.status(409).json({ message: `${alreadyCommitted} portions are already reserved or collected.` });
    item.available = Number(req.body.quantity) - alreadyCommitted;
    if (item.available > 0 && item.status === 'sold_out') item.status = 'active';
  }
  await item.save(); res.json({ item });
}));
app.get('/api/provider/foods', protect, allow('provider'), asyncRoute(async (req, res) => res.json({ items: await Listing.find({ provider: req.user.id }).sort({ createdAt: -1 }) })));
app.get('/api/provider/foods/:id', protect, allow('provider'), asyncRoute(async (req, res) => {
  const item = await Listing.findOne({ _id: req.params.id, provider: req.user.id });
  if (!item) return res.status(404).json({ message: 'Listing not found.' });
  res.json({ item });
}));
app.patch('/api/provider/foods/:id/status', protect, allow('provider'), asyncRoute(async (req, res) => {
  if (!['active', 'paused'].includes(req.body.status)) return res.status(400).json({ message: 'Listings may be set to active or paused.' });
  if (req.body.status === 'active' && !req.user.providerApproved) return res.status(403).json({ message: 'Your partner account must be approved before you can publish listings.' });
  const item = await Listing.findOneAndUpdate({ _id: req.params.id, provider: req.user.id }, { status: req.body.status }, { new: true });
  if (!item) return res.status(404).json({ message: 'Listing not found.' });
  res.json({ item });
}));

app.get('/api/favorites', protect, allow('customer'), asyncRoute(async (req, res) => {
  const user = await User.findById(req.user.id).populate({ path: 'favorites', populate: { path: 'provider', select: 'name' } });
  res.json({ items: user.favorites, ids: user.favorites.map(item => item.id) });
}));
app.patch('/api/favorites/:listingId', protect, allow('customer'), asyncRoute(async (req, res) => {
  const listing = await Listing.findById(req.params.listingId);
  if (!listing) return res.status(404).json({ message: 'Food listing not found.' });
  const current = req.user.favorites.some(id => id.equals(listing._id));
  await User.findByIdAndUpdate(req.user.id, current ? { $pull: { favorites: listing._id } } : { $addToSet: { favorites: listing._id } });
  res.json({ saved: !current });
}));

app.post('/api/reservations', protect, allow('customer'), asyncRoute(async (req, res) => {
  const quantity = Math.floor(Number(req.body.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) return res.status(400).json({ message: 'Choose at least one portion.' });
  const item = await Listing.findOneAndUpdate({ _id: req.body.listingId, status: 'active', available: { $gte: quantity }, pickupEnd: { $gt: new Date() } }, { $inc: { available: -quantity } }, { new: true });
  if (!item) return res.status(409).json({ message: 'This deal is no longer available in that quantity.' });
  let reservation;
  try {
    reservation = await Reservation.create({ customer: req.user.id, provider: item.provider, listing: item.id, listingTitle: item.title, quantity, total: item.price * quantity, savings: Math.max(0, item.originalPrice - item.price) * quantity, pickupStart: item.pickupStart, pickupEnd: item.pickupEnd });
  } catch (error) {
    await Listing.findByIdAndUpdate(item.id, { $inc: { available: quantity }, $set: { status: 'active' } });
    throw error;
  }
  if (!item.available) { item.status = 'sold_out'; await item.save(); }
  res.status(201).json({ reservation });
}));
app.get('/api/reservations/mine', protect, allow('customer'), asyncRoute(async (req, res) => res.json({ items: await Reservation.find({ customer: req.user.id }).sort({ createdAt: -1 }).populate('listing') })));
app.get('/api/reservations/provider', protect, allow('provider'), asyncRoute(async (req, res) => res.json({ items: await Reservation.find({ provider: req.user.id }).sort({ createdAt: -1 }).populate('customer', 'name').populate('listing', 'title address') })));
app.get('/api/reservations/:id', protect, asyncRoute(async (req, res) => {
  const query = req.user.role === 'customer' ? { _id: req.params.id, customer: req.user.id } : req.user.role === 'provider' ? { _id: req.params.id, provider: req.user.id } : { _id: req.params.id };
  const reservation = await Reservation.findOne(query).populate('listing').populate('provider', 'name').populate('customer', 'name');
  if (!reservation) return res.status(404).json({ message: 'Reservation not found.' });
  res.json({ reservation });
}));
app.patch('/api/reservations/:id/cancel', protect, asyncRoute(async (req, res) => {
  if (!['customer', 'provider'].includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission to cancel this reservation.' });
  const query = req.user.role === 'customer' ? { _id: req.params.id, customer: req.user.id, status: 'reserved' } : { _id: req.params.id, provider: req.user.id, status: 'reserved' };
  const reservation = await Reservation.findOneAndUpdate(query, { $set: { status: 'cancelled' } }, { new: true });
  if (!reservation) return res.status(404).json({ message: 'Active reservation not found.' });
  await Listing.findByIdAndUpdate(reservation.listing, { $inc: { available: reservation.quantity }, $set: { status: 'active' } });
  res.json({ reservation });
}));
app.patch('/api/reservations/:id/collect', protect, allow('provider'), asyncRoute(async (req, res) => {
  const reservation = await Reservation.findOneAndUpdate({ _id: req.params.id, provider: req.user.id, status: 'reserved' }, { status: 'collected' }, { new: true });
  if (!reservation) return res.status(404).json({ message: 'Active reservation not found.' });
  res.json({ reservation });
}));
app.get('/api/provider/analytics', protect, allow('provider'), asyncRoute(async (req, res) => {
  const reservations = await Reservation.find({ provider: req.user.id });
  res.json({ activeListings: await Listing.countDocuments({ provider: req.user.id, status: 'active' }), availablePortions: (await Listing.aggregate([{ $match: { provider: req.user._id } }, { $group: { _id: null, total: { $sum: '$available' } } }]))[0]?.total || 0, reservations: reservations.length, collected: reservations.filter(r => r.status === 'collected').length, recoveredRevenue: reservations.filter(r => r.status === 'collected').reduce((sum, r) => sum + r.total, 0) });
}));
app.get('/api/admin/overview', protect, allow('admin'), asyncRoute(async (req, res) => res.json({ users: await User.countDocuments(), providers: await User.countDocuments({ role: 'provider' }), pendingProviders: await User.countDocuments({ role: 'provider', providerApproved: false, status: 'active' }), listings: await Listing.countDocuments(), reservations: await Reservation.countDocuments(), recentActions: await AuditLog.find().sort({ createdAt: -1 }).limit(8).populate('actor', 'name email') })));
app.get('/api/admin/users', protect, allow('admin'), asyncRoute(async (req, res) => res.json({ items: await User.find().select('name email role status providerApproved createdAt').sort({ createdAt: -1 }).limit(300) })));
app.patch('/api/admin/users/:id/status', protect, allow('admin'), asyncRoute(async (req, res) => {
  if (!['active', 'suspended'].includes(req.body.status)) return res.status(400).json({ message: 'Choose active or suspended status.' });
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'You cannot suspend your own admin account.' });
  const user = await User.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }).select('name email role status providerApproved');
  if (!user) return res.status(404).json({ message: 'Account not found.' });
  if (user.role === 'provider' && user.status === 'suspended') await Listing.updateMany({ provider: user.id, status: 'active' }, { $set: { status: 'paused' } });
  await AuditLog.create({ actor: req.user.id, action: 'user.status', targetType: 'user', target: user.id, summary: `${user.email} set to ${user.status}` });
  res.json({ user });
}));
app.get('/api/admin/providers', protect, allow('admin'), asyncRoute(async (req, res) => res.json({ items: await User.find({ role: 'provider' }).select('name email status providerApproved createdAt').sort({ createdAt: -1 }) })));
app.patch('/api/admin/providers/:id/approval', protect, allow('admin'), asyncRoute(async (req, res) => {
  const approved = Boolean(req.body.approved);
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'provider' }, { providerApproved: approved }, { new: true }).select('name email status providerApproved');
  if (!user) return res.status(404).json({ message: 'Food partner not found.' });
  if (approved && user.status === 'active') await Listing.updateMany({ provider: user.id, status: 'pending_approval' }, { $set: { status: 'active' } });
  if (!approved) await Listing.updateMany({ provider: user.id, status: 'active' }, { $set: { status: 'paused' } });
  await AuditLog.create({ actor: req.user.id, action: 'provider.approval', targetType: 'user', target: user.id, summary: `${user.email} ${approved ? 'approved' : 'approval revoked'}` });
  res.json({ user });
}));
app.get('/api/admin/listings', protect, allow('admin'), asyncRoute(async (req, res) => res.json({ items: await Listing.find().populate('provider', 'name email').sort({ createdAt: -1 }).limit(300) })));
app.patch('/api/admin/listings/:id/status', protect, allow('admin'), asyncRoute(async (req, res) => {
  if (!['active', 'paused'].includes(req.body.status)) return res.status(400).json({ message: 'Listings may be set to active or paused.' });
  const item = await Listing.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (!item) return res.status(404).json({ message: 'Listing not found.' });
  await AuditLog.create({ actor: req.user.id, action: 'listing.moderation', targetType: 'listing', target: item.id, summary: `${item.title} set to ${item.status}` });
  res.json({ item });
}));
app.get('/api/admin/reservations', protect, allow('admin'), asyncRoute(async (req, res) => res.json({ items: await Reservation.find().sort({ createdAt: -1 }).limit(500).populate('customer', 'name email').populate('provider', 'name email') })));
app.get('/api/admin/audit', protect, allow('admin'), asyncRoute(async (req, res) => res.json({ items: await AuditLog.find().sort({ createdAt: -1 }).limit(200).populate('actor', 'name email') })));
app.use((req, res) => res.status(404).json({ message: 'The requested API route does not exist.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
  if (err.code === 11000) return res.status(409).json({ message: 'That record already exists.' });
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
});

const port = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lastplate')
  .then(() => app.listen(port, () => console.log(`LastPlate API listening on ${port}`)))
  .catch(error => { console.error('MongoDB connection failed:', error.message); process.exit(1); });
