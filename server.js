const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

dotenv.config();

const app = express();
const dbPath = path.join(__dirname, 'vigilance.db');
const db = new sqlite3.Database(dbPath);

// Create all tables
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
        idNumber TEXT,
        latitude REAL DEFAULT 0,
        longitude REAL DEFAULT 0,
        lastLocationUpdate DATETIME,
        isOnline INTEGER DEFAULT 0,
        avgRating REAL DEFAULT 0,
        totalRatings INTEGER DEFAULT 0,
        verificationStatus TEXT DEFAULT 'pending',
        verificationDocuments TEXT,
        verifiedAt DATETIME,
        verifiedBy INTEGER,
        rejectionReason TEXT,
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
        startTime TEXT,
        endTime TEXT,
        address TEXT,
        totalAmount REAL,
        status TEXT DEFAULT 'pending',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Ratings table
    db.run(`CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bookingId TEXT,
        clientId INTEGER,
        workerId INTEGER,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        review TEXT,
        response TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Messages table for chat
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversationId TEXT,
        senderId INTEGER,
        receiverId INTEGER,
        message TEXT,
        isRead INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    console.log('✅ SQLite database ready with all tables');
});

app.use(cors());
app.use(express.json());

const generateToken = (id, role) => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
};

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register/client', async (req, res) => {
    try {
        const { firstName, lastName, email, password, phoneNumber, address } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            `INSERT INTO users (firstName, lastName, email, password, phoneNumber, role, address)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [firstName, lastName, email, hashedPassword, phoneNumber, 'client', address],
            function(err) {
                if (err) return res.status(400).json({ success: false, message: 'Email exists' });
                const token = generateToken(this.lastID, 'client');
                res.json({ success: true, data: { userId: this.lastID, firstName, lastName, email, role: 'client', token } });
            }
        );
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/auth/register/worker', async (req, res) => {
    try {
        const { firstName, lastName, email, password, phoneNumber, idNumber, address } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            `INSERT INTO users (firstName, lastName, email, password, phoneNumber, role, address, idNumber)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [firstName, lastName, email, hashedPassword, phoneNumber, 'worker', address, idNumber],
            function(err) {
                if (err) return res.status(400).json({ success: false, message: 'Email exists' });
                const token = generateToken(this.lastID, 'worker');
                res.json({ success: true, data: { userId: this.lastID, firstName, lastName, email, role: 'worker', token } });
            }
        );
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
            if (err || !user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
            const valid = await bcrypt.compare(password, user.password);
            if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
            const token = generateToken(user.id, user.role);
            res.json({ success: true, data: { userId: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, token } });
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== LOCATION TRACKING ====================

app.put('/api/workers/location', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { latitude, longitude, status } = req.body;
        
        db.run(
            `UPDATE users SET latitude = ?, longitude = ?, lastLocationUpdate = CURRENT_TIMESTAMP, isOnline = ? WHERE id = ?`,
            [latitude, longitude, status === 'online' ? 1 : 0, decoded.id],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, message: 'Location updated', data: { latitude, longitude, status } });
            }
        );
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/workers/nearby', async (req, res) => {
    const { lat, lng, radius = 5 } = req.query;
    
    if (!lat || !lng) {
        return res.status(400).json({ success: false, message: 'Latitude and longitude required' });
    }
    
    db.all(`
        SELECT id, firstName, lastName, phoneNumber, role, latitude, longitude, avgRating, isOnline, verificationStatus,
               (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * 
               cos(radians(longitude) - radians(?)) + sin(radians(?)) * 
               sin(radians(latitude)))) AS distance
        FROM users 
        WHERE role = 'worker' 
        AND isOnline = 1 
        AND verificationStatus = 'verified'
        AND latitude IS NOT NULL 
        AND latitude != 0
        AND (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * 
             cos(radians(longitude) - radians(?)) + sin(radians(?)) * 
             sin(radians(latitude)))) < ?
        ORDER BY distance
    `, [lat, lng, lat, lat, lng, lat, radius], (err, workers) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: workers });
    });
});

// ==================== BOOKING ROUTES ====================

app.post('/api/clients/book-worker', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { workerId, serviceCategory, serviceDate, duration, startTime, endTime, address } = req.body;
        const bookingId = `VHC${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const totalAmount = 1500;
        
        db.run(
            `INSERT INTO bookings (bookingId, clientId, workerId, serviceCategory, serviceDate, duration, startTime, endTime, address, totalAmount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [bookingId, decoded.id, workerId, serviceCategory, serviceDate, duration, startTime, endTime, address, totalAmount],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, data: { bookingId, id: this.lastID, totalAmount } });
            }
        );
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/clients/bookings', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        db.all(`SELECT * FROM bookings WHERE clientId = ? ORDER BY createdAt DESC`, [decoded.id], (err, bookings) => {
            res.json({ success: true, data: bookings });
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/workers/bookings', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        db.all(`SELECT b.*, u.firstName, u.lastName, u.phoneNumber 
                FROM bookings b 
                JOIN users u ON b.clientId = u.id 
                WHERE b.workerId = ? ORDER BY b.createdAt DESC`, [decoded.id], (err, bookings) => {
            res.json({ success: true, data: bookings });
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.put('/api/bookings/:bookingId/status', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { bookingId } = req.params;
        const { status } = req.body;
        
        db.run(`UPDATE bookings SET status = ? WHERE bookingId = ? AND workerId = ?`, 
            [status, bookingId, decoded.id], 
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, message: `Booking ${status}` });
            });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

// ==================== RATING SYSTEM ====================

app.post('/api/ratings/submit', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { bookingId, workerId, rating, review } = req.body;
        
        db.get(`SELECT * FROM bookings WHERE bookingId = ? AND clientId = ?`, [bookingId, decoded.id], (err, booking) => {
            if (err || !booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }
            
            db.run(
                `INSERT INTO ratings (bookingId, clientId, workerId, rating, review) VALUES (?, ?, ?, ?, ?)`,
                [bookingId, decoded.id, workerId, rating, review],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    
                    db.get(`SELECT AVG(rating) as avgRating, COUNT(*) as total FROM ratings WHERE workerId = ?`, [workerId], (err, stats) => {
                        db.run(`UPDATE users SET avgRating = ?, totalRatings = ? WHERE id = ?`, [stats.avgRating, stats.total, workerId]);
                    });
                    
                    res.json({ success: true, message: 'Rating submitted', data: { ratingId: this.lastID } });
                }
            );
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/ratings/worker/:workerId', async (req, res) => {
    const { workerId } = req.params;
    
    db.all(`SELECT r.*, u.firstName, u.lastName FROM ratings r 
            JOIN users u ON r.clientId = u.id 
            WHERE r.workerId = ? ORDER BY r.createdAt DESC`, [workerId], (err, ratings) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        
        db.get(`SELECT avgRating, totalRatings FROM users WHERE id = ?`, [workerId], (err, stats) => {
            res.json({ 
                success: true, 
                data: { 
                    ratings, 
                    averageRating: stats?.avgRating || 0,
                    totalRatings: stats?.totalRatings || 0
                } 
            });
        });
    });
});

// ==================== ADVANCED SEARCH ====================

app.post('/api/workers/search', async (req, res) => {
    const { minRating, keyword, lat, lng, radius = 10 } = req.body;
    
    if (lat && lng) {
        let sql = `SELECT id, firstName, lastName, phoneNumber, avgRating, totalRatings, latitude, longitude, isOnline, verificationStatus,
                   (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * 
                   cos(radians(longitude) - radians(?)) + sin(radians(?)) * 
                   sin(radians(latitude)))) AS distance
                   FROM users WHERE role = 'worker' AND isOnline = 1 AND verificationStatus = 'verified'`;
        let params = [lat, lng, lat];
        
        if (minRating) {
            sql += ` AND avgRating >= ?`;
            params.push(minRating);
        }
        
        if (keyword) {
            sql += ` AND (firstName LIKE ? OR lastName LIKE ?)`;
            params.push(`%${keyword}%`, `%${keyword}%`);
        }
        
        sql += ` AND (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * 
                 cos(radians(longitude) - radians(?)) + sin(radians(?)) * 
                 sin(radians(latitude)))) < ?`;
        params.push(lat, lng, lat, radius);
        
        sql += ` ORDER BY distance`;
        
        db.all(sql, params, (err, workers) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: workers, count: workers.length });
        });
    } else {
        let sql = `SELECT id, firstName, lastName, phoneNumber, avgRating, totalRatings, verificationStatus 
                   FROM users WHERE role = 'worker' AND isOnline = 1 AND verificationStatus = 'verified'`;
        let params = [];
        
        if (minRating) {
            sql += ` AND avgRating >= ?`;
            params.push(minRating);
        }
        
        if (keyword) {
            sql += ` AND (firstName LIKE ? OR lastName LIKE ?)`;
            params.push(`%${keyword}%`, `%${keyword}%`);
        }
        
        db.all(sql, params, (err, workers) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: workers, count: workers.length });
        });
    }
});

app.get('/api/workers/filters', async (req, res) => {
    res.json({
        success: true,
        data: {
            categories: ['House Maid', 'Nanny', 'Cook', 'Electrician', 'Plumber', 'Carpenter', 'Gardener'],
            ratingRange: { min: 1, max: 5 },
            availability: ['today', 'tomorrow', 'this_week']
        }
    });
});

// ==================== WORKER VERIFICATION ====================

app.post('/api/worker/upload-documents', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { idPhoto, certificate, selfie, additionalDocs } = req.body;
        
        const documents = JSON.stringify({
            idPhoto,
            certificate,
            selfie,
            additionalDocs,
            submittedAt: new Date().toISOString()
        });
        
        db.run(
            `UPDATE users SET verificationStatus = 'pending', verificationDocuments = ? WHERE id = ?`,
            [documents, decoded.id],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, message: 'Documents submitted for verification' });
            }
        );
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/worker/verification-status', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        db.get(`SELECT verificationStatus, verificationDocuments, verifiedAt, rejectionReason FROM users WHERE id = ?`, 
            [decoded.id], (err, user) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: user });
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/admin/verifications/pending', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        db.get(`SELECT role FROM users WHERE id = ?`, [decoded.id], (err, user) => {
            if (err || user?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Admin access required' });
            }
            
            db.all(`SELECT id, firstName, lastName, email, phoneNumber, verificationDocuments, createdAt 
                    FROM users WHERE role = 'worker' AND verificationStatus = 'pending'`, 
                    (err, workers) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                
                const workersWithDocs = workers.map(w => ({
                    ...w,
                    documents: w.verificationDocuments ? JSON.parse(w.verificationDocuments) : null
                }));
                res.json({ success: true, data: workersWithDocs });
            });
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.post('/api/admin/verifications/approve/:workerId', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { workerId } = req.params;
        
        db.get(`SELECT role FROM users WHERE id = ?`, [decoded.id], (err, admin) => {
            if (err || admin?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Admin access required' });
            }
            
            db.run(
                `UPDATE users SET verificationStatus = 'verified', verifiedAt = CURRENT_TIMESTAMP, verifiedBy = ? WHERE id = ?`,
                [decoded.id, workerId],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Worker verified successfully' });
                }
            );
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.post('/api/admin/verifications/reject/:workerId', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { workerId } = req.params;
        const { reason } = req.body;
        
        db.get(`SELECT role FROM users WHERE id = ?`, [decoded.id], (err, admin) => {
            if (err || admin?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Admin access required' });
            }
            
            db.run(
                `UPDATE users SET verificationStatus = 'rejected', rejectionReason = ?, verifiedBy = ? WHERE id = ?`,
                [reason, decoded.id, workerId],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Worker verification rejected' });
                }
            );
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/admin/verifications/stats', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        db.get(`SELECT role FROM users WHERE id = ?`, [decoded.id], (err, admin) => {
            if (err || admin?.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Admin access required' });
            }
            
            db.get(`SELECT COUNT(*) as pending FROM users WHERE role = 'worker' AND verificationStatus = 'pending'`, [], (err, pending) => {
                db.get(`SELECT COUNT(*) as verified FROM users WHERE role = 'worker' AND verificationStatus = 'verified'`, [], (err, verified) => {
                    db.get(`SELECT COUNT(*) as rejected FROM users WHERE role = 'worker' AND verificationStatus = 'rejected'`, [], (err, rejected) => {
                        db.get(`SELECT COUNT(*) as total FROM users WHERE role = 'worker'`, [], (err, total) => {
                            res.json({
                                success: true,
                                data: {
                                    pending: pending?.pending || 0,
                                    verified: verified?.verified || 0,
                                    rejected: rejected?.rejected || 0,
                                    total: total?.total || 0
                                }
                            });
                        });
                    });
                });
            });
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/workers/verified', async (req, res) => {
    db.all(`SELECT id, firstName, lastName, email, phoneNumber, avgRating, totalRatings, latitude, longitude, isOnline
            FROM users WHERE role = 'worker' AND verificationStatus = 'verified' AND isOnline = 1`, 
            (err, workers) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: workers });
    });
});

// ==================== CHAT SYSTEM ====================

app.post('/api/chat/send', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { receiverId, message, conversationId } = req.body;
        const convId = conversationId || `${Math.min(decoded.id, receiverId)}_${Math.max(decoded.id, receiverId)}`;
        
        db.run(
            `INSERT INTO messages (conversationId, senderId, receiverId, message) VALUES (?, ?, ?, ?)`,
            [convId, decoded.id, receiverId, message],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, data: { messageId: this.lastID, conversationId: convId } });
            }
        );
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/chat/messages/:userId', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const { userId } = req.params;
        const convId = `${Math.min(decoded.id, userId)}_${Math.max(decoded.id, userId)}`;
        
        db.all(`SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC`, [convId], (err, messages) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            
            db.run(`UPDATE messages SET isRead = 1 WHERE conversationId = ? AND receiverId = ?`, [convId, decoded.id]);
            
            res.json({ success: true, data: messages });
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.get('/api/chat/conversations', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        
        db.all(`SELECT DISTINCT 
                    CASE WHEN senderId = ? THEN receiverId ELSE senderId END as otherUserId,
                    MAX(createdAt) as lastMessage,
                    COUNT(CASE WHEN isRead = 0 AND receiverId = ? THEN 1 END) as unreadCount
                FROM messages 
                WHERE senderId = ? OR receiverId = ?
                GROUP BY otherUserId
                ORDER BY lastMessage DESC`, [decoded.id, decoded.id, decoded.id, decoded.id], (err, conversations) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            
            const convWithDetails = [];
            let completed = 0;
            
            if (conversations.length === 0) {
                return res.json({ success: true, data: [] });
            }
            
            conversations.forEach(conv => {
                db.get(`SELECT id, firstName, lastName, role FROM users WHERE id = ?`, [conv.otherUserId], (err, user) => {
                    convWithDetails.push({
                        ...conv,
                        otherUser: user
                    });
                    completed++;
                    
                    if (completed === conversations.length) {
                        res.json({ success: true, data: convWithDetails });
                    }
                });
            });
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

// ==================== M-PESA ROUTE ====================

app.post('/api/payments/mpesa/stkpush', async (req, res) => {
    const { bookingId, phoneNumber } = req.body;
    
    try {
        const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
        const tokenRes = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', { headers: { Authorization: `Basic ${auth}` } });
        const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
        const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
        const stkRequest = {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: 10,
            PartyA: phoneNumber,
            PartyB: process.env.MPESA_SHORTCODE,
            PhoneNumber: phoneNumber,
            CallBackURL: 'https://example.com/callback',
            AccountReference: bookingId,
            TransactionDesc: 'Payment for services'
        };
        const stkRes = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', stkRequest, { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
        res.json({ success: true, message: 'STK Push sent', data: stkRes.data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Vigilance API running' });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    console.log(`✅ All features ready: Location, Ratings, Search, Verification, Chat`);
});