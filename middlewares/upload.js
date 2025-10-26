// const multer = require("multer");
// const { CloudinaryStorage } = require("multer-storage-cloudinary");
// const cloudinary = require("../utils/cloudinary");

// const storage = new CloudinaryStorage({
//   cloudinary: cloudinary,
//   params: {
//     folder: "ministry-logos",
//     allowed_formats: ["jpg", "jpeg", "png"],
//   },
// });

// const parser = multer({ storage: storage });

// module.exports = parser;



// middleware/upload.js
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

// ✅ Dynamic Cloudinary Storage (handles both images and docs)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Check file type
    let folder = "uploads";

    if (file.fieldname === "thumbnail") folder = "courses/thumbnails";
    else if (file.fieldname === "curriculum") folder = "courses/curriculums";
    else if (file.fieldname === "logo") folder = "ministry-logos";

    // Determine resource type automatically (important for PDFs/DOCX)
    return {
      folder: folder,
      resource_type: "auto",
      format: undefined, // Cloudinary auto-detects
      public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
    };
  },
});

// ✅ Initialize Multer parser
const upload = multer({ storage });

module.exports = upload;
