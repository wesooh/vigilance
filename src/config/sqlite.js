const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../vigilance.db');
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firstName TEXT,
        lastName TEXT,
        email TEXT UNIQUE,
        password TEXT,
        phoneNumber TEXT,
        role TEXT,
        address TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Bookings table
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bookingId TEXT UNIQUE,
        clientId INTEGER,
        workerId INTEGER,
        serviceCategory TEXT,
        serviceDate DATETIME,
        duration TEXT,
        status TEXT,
        totalAmount REAL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    console.log('✅ SQLite database ready');
});

module.exports = db;