const db = require('./sqlite');

const connectDB = async () => {
    console.log('✅ SQLite database connected');
    console.log('📁 Database file: vigilance.db');
    return db;
};

module.exports = connectDB;