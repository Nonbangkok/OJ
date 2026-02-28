const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer configuration for single file uploads (in memory)
const memoryUpload = multer({ storage: multer.memoryStorage() });

// Multer configuration for batch uploads (to disk)
const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // We'll use a temporary directory provided by the OS
        const uploadPath = path.join('/tmp', 'oj_uploads');

        // Ensure the directory exists
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Create a unique filename to avoid conflicts
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const diskUpload = multer({ storage: diskStorage });

module.exports = {
    memoryUpload,
    diskUpload
};