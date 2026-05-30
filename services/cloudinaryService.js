const cloudinary = require('cloudinary').v2;

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

console.log('[CLOUDINARY_CONFIG] Cloud Name:', cloudName ? 'Defined' : 'UNDEFINED');
console.log('[CLOUDINARY_CONFIG] API Key:', apiKey ? 'Defined' : 'UNDEFINED');
console.log('[CLOUDINARY_CONFIG] API Secret:', apiSecret ? 'Defined (Length: ' + apiSecret.length + ')' : 'UNDEFINED');

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret
});

/**
 * Uploads a base64 encoded image to Cloudinary.
 * @param {string} base64Image - Base64 data string (e.g. data:image/png;base64,...)
 * @param {string} folder - Destination folder on Cloudinary
 * @returns {Promise<{cloudinaryUrl: string, publicId: string}>}
 */
const uploadImageBase64 = async (base64Image, folder = 'catch_it/photos') => {
  console.log(`[CLOUDINARY_UPLOAD] Starting image upload to folder: ${folder}`);
  try {
    const result = await cloudinary.uploader.upload(base64Image, {
      folder: folder,
      resource_type: 'image'
    });
    console.log(`[CLOUDINARY_UPLOAD] Image upload successful. PublicID: ${result.public_id}`);
    return {
      cloudinaryUrl: result.secure_url,
      publicId: result.public_id
    };
  } catch (error) {
    console.error('[CLOUDINARY_UPLOAD] Error uploading image to Cloudinary:', error);
    throw error;
  }
};

/**
 * Uploads a binary buffer to Cloudinary using upload_stream.
 * @param {Buffer} buffer - Audio/File buffer data
 * @param {string} folder - Destination folder on Cloudinary
 * @returns {Promise<{cloudinaryUrl: string, publicId: string}>}
 */
const uploadAudioBuffer = (buffer, folder = 'catch_it/audio') => {
  console.log(`[CLOUDINARY_UPLOAD] Starting audio buffer upload to folder: ${folder} (${buffer.length} bytes)`);
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'video' // Cloudinary uploads audio under the 'video' resource type
      },
      (error, result) => {
        if (error) {
          console.error('[CLOUDINARY_UPLOAD] Error uploading audio stream to Cloudinary:', error);
          return reject(error);
        }
        console.log(`[CLOUDINARY_UPLOAD] Audio stream upload successful. PublicID: ${result.public_id}`);
        resolve({
          cloudinaryUrl: result.secure_url,
          publicId: result.public_id
        });
      }
    );
    uploadStream.end(buffer);
  });
};

module.exports = {
  uploadImageBase64,
  uploadAudioBuffer
};
