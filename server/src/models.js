const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'provider', 'admin'], default: 'customer' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  avatarEmoji: { type: String, enum: ['🥑', '🍋', '🥕', '🍓', '🥐', '🍄', '🐝', '🌿'], default: '🥑' },
  phone: { type: String, trim: true },
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpires: { type: Date, select: false },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
  providerApproved: { type: Boolean, default: false }
}, { timestamps: true });

const listingSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  providerName: { type: String, required: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, required: true, maxlength: 1200 },
  category: { type: String, required: true, enum: ['Bakery', 'Meals', 'Produce', 'Desserts', 'Other'] },
  image: { type: String, default: '' },
  originalPrice: { type: Number, required: true, min: 0.01 },
  price: { type: Number, required: true, min: 0.01 },
  quantity: { type: Number, required: true, min: 1 },
  available: { type: Number, required: true, min: 0 },
  pickupStart: { type: Date, required: true },
  pickupEnd: { type: Date, required: true },
  useBy: { type: Date },
  address: { type: String, required: true },
  ingredients: [String], allergens: [String],
  status: { type: String, enum: ['active', 'paused', 'pending_approval', 'sold_out', 'expired'], default: 'active', index: true }
}, { timestamps: true });
listingSchema.pre('validate', function () {
  if (this.price > this.originalPrice) this.invalidate('price', 'Deal price cannot exceed the original price.');
  if (this.available > this.quantity) this.invalidate('available', 'Available portions cannot exceed total portions.');
  if (this.pickupStart && this.pickupEnd && this.pickupEnd <= this.pickupStart) this.invalidate('pickupEnd', 'Pickup end must be after pickup start.');
  if (this.useBy && this.pickupEnd && this.useBy < this.pickupEnd) this.invalidate('useBy', 'Use-by time must be at or after the pickup window.');
});
listingSchema.index({ title: 'text', description: 'text', providerName: 'text' });
listingSchema.index({ status: 1, pickupEnd: 1, available: 1, createdAt: -1 });

const reservationSchema = new mongoose.Schema({
  reference: { type: String, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  listingTitle: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  total: { type: Number, required: true },
  savings: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['reserved', 'collected', 'cancelled'], default: 'reserved', index: true },
  pickupStart: Date, pickupEnd: Date
}, { timestamps: true });
reservationSchema.pre('validate', function () { if (!this.reference) this.reference = `LP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; });

const auditSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  targetType: { type: String, required: true },
  target: { type: String, required: true },
  summary: { type: String, required: true }
}, { timestamps: true });
auditSchema.index({ createdAt: -1 });

module.exports = {
  User: mongoose.model('User', userSchema),
  Listing: mongoose.model('Listing', listingSchema),
  Reservation: mongoose.model('Reservation', reservationSchema),
  AuditLog: mongoose.model('AuditLog', auditSchema)
};
