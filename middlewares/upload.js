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



// // middleware/upload.js
// const multer = require("multer");
// const { CloudinaryStorage } = require("multer-storage-cloudinary");
// const cloudinary = require("../utils/cloudinary");


// const storage = new CloudinaryStorage({
//   cloudinary: cloudinary,
//   params: async (req, file) => {
//     let folder = "uploads";

//     if (file.fieldname === "thumbnail") folder = "courses/thumbnails";
//     else if (file.fieldname === "curriculum") folder = "courses/curriculums";
//     else if (file.fieldname === "logo") folder = "ministry-logos";
//     return {
//       folder: folder,
//       resource_type: "auto",
//       format: undefined,
//       public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
//     };
//   },
// });

// const lessonStorage = new CloudinaryStorage({
//   cloudinary: cloudinary,
//   params: {
//     folder: "lessons/files",
//     resource_type: "raw",
//     allowed_formats: ["pdf", "doc", "docx"],
//   },
// });

// exports.lessonUpload = multer({ storage: lessonStorage });

// const upload = multer({ storage });

// module.exports = upload;


// middleware/upload.js
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

/* ============================
   📂 General Upload Storage
   Handles: thumbnails, curriculums, logos, etc.
============================ */
const generalStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let folder = "uploads";

    if (file.fieldname === "thumbnail") folder = "courses/thumbnails";
    else if (file.fieldname === "curriculum") folder = "courses/curriculums";
    else if (file.fieldname === "logo") folder = "ministry-logos";

    return {
      folder,
      resource_type: "auto", // auto-detects image, video, or doc
      use_filename: true,
      unique_filename: false,
      public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
    };
  },
});
const upload = multer({ storage: generalStorage });

/* ============================
   📘 Lesson File Upload Storage
   Handles: PDF / DOC / DOCX lesson files
============================ */
const lessonStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "lessons/files",
    resource_type: "raw", // ensure file integrity
    allowed_formats: ["pdf", "doc", "docx"],
  },
});
const lessonUpload = multer({ storage: lessonStorage });

/* ============================
   ✅ Export both
============================ */
module.exports = {
  upload,         // for general uploads (thumbnails, curriculums, logos)
  lessonUpload,   // for lesson files
};
