const multer = require('multer');
const path = require('path');
const { cloudinary, uploadToCloudinary } = require('../config/cloudinary');

// Configure storage for multer
const storage = multer.memoryStorage();

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images, PDFs, and documents are allowed'));
  }
};

// Create multer upload instance
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});

// Middleware to handle multiple file uploads
const uploadFields = upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'idPhoto', maxCount: 2 },
  { name: 'certificates', maxCount: 10 },
  { name: 'portfolio', maxCount: 20 },
  { name: 'cv', maxCount: 1 }
]);

// Function to upload files to Cloudinary
const uploadFilesToCloudinary = async (files, userId, folder) => {
  const uploadedFiles = {};
  
  for (const [fieldname, fileArray] of Object.entries(files)) {
    uploadedFiles[fieldname] = [];
    
    for (const file of fileArray) {
      const result = await uploadToCloudinary(file.buffer, `${folder}/${userId}`, {
        public_id: `${fieldname}_${Date.now()}`
      });
      
      uploadedFiles[fieldname].push({
        url: result.secure_url,
        publicId: result.public_id,
        originalName: file.originalname
      });
    }
  }
  
  return uploadedFiles;
};

module.exports = { upload, uploadFields, uploadFilesToCloudinary };