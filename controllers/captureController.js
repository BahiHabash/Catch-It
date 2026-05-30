const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CAPTURE_ROOT = path.join(__dirname, '..', 'captures');
const audioSessions = new Map();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeSessionId(value) {
  if (!value || typeof value !== 'string') {
    return crypto.randomUUID();
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID();
}

function getSessionDir(sessionId) {
  const safeId = safeSessionId(sessionId);
  const sessionDir = path.join(CAPTURE_ROOT, safeId);
  ensureDir(sessionDir);
  ensureDir(path.join(sessionDir, 'photos'));
  ensureDir(path.join(sessionDir, 'audio'));
  return { safeId, sessionDir };
}

function readMetadata(sessionDir) {
  const metadataPath = path.join(sessionDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeMetadata(sessionDir, metadata) {
  fs.writeFileSync(
    path.join(sessionDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
}

function requestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket.remoteAddress || null;
}

exports.startSession = (req, res) => {
  const sessionId = crypto.randomUUID();
  const { sessionDir } = getSessionDir(sessionId);
  const now = new Date().toISOString();

  const metadata = {
    sessionId,
    startedAt: now,
    updatedAt: now,
    ip: requestIp(req),
    userAgent: req.get('user-agent') || null,
    clientHints: {
      language: req.body.language || null,
      platform: req.body.platform || null,
      screen: req.body.screen || null,
      timezone: req.body.timezone || null
    },
    location: req.body.location || null,
    permissions: req.body.permissions || null,
    photos: [],
    audioChunks: []
  };

  writeMetadata(sessionDir, metadata);
  res.json({ success: true, sessionId });
};

exports.saveMetadata = (req, res) => {
  const { safeId, sessionDir } = getSessionDir(req.params.sessionId);
  const now = new Date().toISOString();
  const metadata = readMetadata(sessionDir);

  const nextMetadata = {
    ...metadata,
    sessionId: metadata.sessionId || safeId,
    updatedAt: now,
    ip: metadata.ip || requestIp(req),
    userAgent: metadata.userAgent || req.get('user-agent') || null,
    location: req.body.location || metadata.location || null,
    clientHints: {
      ...(metadata.clientHints || {}),
      ...(req.body.clientHints || {})
    },
    permissions: {
      ...(metadata.permissions || {}),
      ...(req.body.permissions || {})
    }
  };

  writeMetadata(sessionDir, nextMetadata);
  res.json({ success: true });
};

exports.savePhoto = (req, res) => {
  const { safeId, sessionDir } = getSessionDir(req.params.sessionId);
  const { image, facingMode, deviceLabel, takenAt } = req.body;
  const match = typeof image === 'string'
    ? image.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/)
    : null;

  if (!match) {
    res.status(400).json({ success: false, message: 'Invalid image payload' });
    return;
  }

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${timestamp}-${facingMode || 'camera'}.${extension}`;
  const relativePath = path.join('photos', fileName);

  fs.writeFileSync(path.join(sessionDir, relativePath), buffer);

  const metadata = readMetadata(sessionDir);
  metadata.sessionId = metadata.sessionId || safeId;
  metadata.updatedAt = new Date().toISOString();
  metadata.photos = Array.isArray(metadata.photos) ? metadata.photos : [];
  metadata.photos.push({
    file: relativePath.replace(/\\/g, '/'),
    facingMode: facingMode || null,
    deviceLabel: deviceLabel || null,
    takenAt: takenAt || metadata.updatedAt
  });
  writeMetadata(sessionDir, metadata);

  res.json({ success: true, file: relativePath.replace(/\\/g, '/') });
};

exports.saveAudioChunk = (req, res) => {
  const { safeId } = getSessionDir(req.params.sessionId);
  const chunkIndex = String(req.query.index || Date.now()).replace(/[^0-9]/g, '');

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ success: false, message: 'Empty audio chunk' });
    return;
  }

  const session = audioSessions.get(safeId) || {
    chunks: [],
    size: 0,
    contentType: req.get('content-type') || 'audio/webm',
    startedAt: new Date().toISOString()
  };

  session.chunks.push({
    index: Number.parseInt(chunkIndex, 10) || session.chunks.length,
    buffer: req.body
  });
  session.size += req.body.length;
  session.contentType = session.contentType || req.get('content-type') || 'audio/webm';
  session.updatedAt = new Date().toISOString();
  audioSessions.set(safeId, session);

  res.json({ success: true, buffered: session.chunks.length, size: session.size, index: chunkIndex });
};

exports.finishAudio = (req, res) => {
  const { safeId, sessionDir } = getSessionDir(req.params.sessionId);
  const session = audioSessions.get(safeId);

  if (!session || !session.chunks.length) {
    res.json({ success: true, file: null, message: 'No buffered audio to save' });
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${timestamp}-recording.webm`;
  const relativePath = path.join('audio', fileName);
  const sortedChunks = session.chunks
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(chunk => chunk.buffer);
  const audioBuffer = Buffer.concat(sortedChunks, session.size);

  fs.writeFileSync(path.join(sessionDir, relativePath), audioBuffer);

  const metadata = readMetadata(sessionDir);
  metadata.sessionId = metadata.sessionId || safeId;
  metadata.updatedAt = new Date().toISOString();
  metadata.audio = {
    file: relativePath.replace(/\\/g, '/'),
    size: audioBuffer.length,
    chunkCount: session.chunks.length,
    contentType: session.contentType,
    startedAt: session.startedAt,
    savedAt: metadata.updatedAt
  };
  metadata.audioChunks = [];
  writeMetadata(sessionDir, metadata);
  audioSessions.delete(safeId);

  res.json({ success: true, file: relativePath.replace(/\\/g, '/'), size: audioBuffer.length });
};
