const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Database file location
const dbPath = path.join(__dirname, "ac-care.db");

// Connect to SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Database connection failed:", err.message);
  } else {
    console.log("Connected to AC Care SQLite database.");
  }
});

// Create users table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error("Failed to create users table:", err.message);
  } else {
    console.log("Users table is ready.");
  }
});

// Create bookings table
db.run(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    service_type TEXT NOT NULL,
    service_package TEXT,

    number_of_units INTEGER DEFAULT 1,

    preferred_date TEXT NOT NULL,
    time_window TEXT NOT NULL,

    service_address TEXT NOT NULL,

    symptoms TEXT,
    special_notes TEXT,

    booking_status TEXT DEFAULT 'Pending',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`, (err) => {
  if (err) {
    console.error("Failed to create bookings table:", err.message);
  } else {
    console.log("Bookings table is ready.");
  }
});

module.exports = db;