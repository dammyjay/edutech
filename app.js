// app.js
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bodyParser = require("body-parser");
const path = require("path");
const createTables = require("./models/initTables");
// const notificationRoutes = require("./routes/notificationRoutes");
const runNewsletterScheduler = require("./cron/newsletterScheduler");
const runDevotionalScheduler = require("./cron/cronJobs");
require("dotenv").config(); // Load .env variables
const pool = require("./models/db"); // adjust path based on your folder structure
const methodOverride = require("method-override");

const app = express();
const layout = require("express-ejs-layouts");
const cookieParser = require("cookie-parser");
app.use(cookieParser());


// app.use(express.json());
// app.use(bodyParser.urlencoded({ extended: false }));

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Set EJS as view engine
app.set("view engine", "ejs");

app.set("views", path.join(__dirname, "views"));
app.use(layout);

// Set default layout file (optional)
// app.set('layout', 'partials/adminLayout'); // default layout for all .ejs files unless overridden

// Middleware

app.set("view engine", "ejs");
app.set("view cache", false);
app.use(express.static(path.join(__dirname, "public")));
// app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // Change to true only in HTTPS
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user; // 👈 Attach user to req
    res.locals.user = req.session.user; // (optional) make available in views
  }
  next();
});

app.locals.vapidPublicKey = process.env.VAPID_PUBLIC_KEY;

app.use(methodOverride("_method"));

app.use((req, res, next) => {
  console.log("🧾 SESSION:", req.session);
  next();
});

app.use((req, res, next) => {
  res.locals.title = "Company"; // Default title
  next();
});

// Routes
// app.get('/', (req, res) => {
//   res.render('home');
// });

const publicRoutes = require("./routes/publicRoutes");
app.use("/", publicRoutes);

const adminRoutes = require("./routes/adminRoutes");
app.use("/admin", adminRoutes);

// const videoRoutes = require("./routes/videoRoutes");
// app.use("/admin", videoRoutes);

const userRoutes = require("./routes/userRoutes");
app.use("/", userRoutes);

const aboutRoutes = require("./routes/aboutRoutes");
app.use("/", aboutRoutes);

const galleryRoutes = require("./routes/galleryRoutes");
app.use("/", galleryRoutes);

const publicFaqRoutes = require("./routes/publicFaqRoutes.js");
app.use("/", publicFaqRoutes);

const adminFaqRoutes = require("./routes/adminFaqRoutes");
app.use("/", adminFaqRoutes);

const studentRoutes = require("./routes/student");
app.use("/student", studentRoutes);

const schoolAdminRoutes = require("./routes/schoolAdmin");
app.use("/school-admin", schoolAdminRoutes);

const teacherRoutes = require("./routes/teacher");
app.use("/teacher", teacherRoutes);

const instructorRoutes = require("./routes/instructor");
app.use("/instructor", instructorRoutes);

const messageRoutes = require("./routes/messageRoutes");
app.use("/", messageRoutes);

app.get("/test", (req, res) => {
  res.send("✅ Test route works");
});

app.get("/api/check-school/:schoolId", async (req, res) => {
  try {
    const { schoolId } = req.params;
    const result = await pool.query(
      "SELECT name FROM schools WHERE school_id = $1",
      [schoolId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "School not found" });
    }

    res.json({ name: result.rows[0].name });
  } catch (err) {
    console.error("❌ Error checking school:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
});

const adminTestimonyRoutes = require("./routes/adminTestimonyRoutes");
app.use("/", adminTestimonyRoutes);

const testRoutes = require("./routes/testRoutes");
app.use("/", testRoutes);

runNewsletterScheduler();

// runDevotionalScheduler();

// Run table creation at startup
createTables();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
