const db = require('../config/sqlite');
const bcrypt = require('bcryptjs');

class User {
    static async create(userData) {
        const { firstName, lastName, email, password, phoneNumber, role, address } = userData;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (firstName, lastName, email, password, phoneNumber, role, address) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [firstName, lastName, email, hashedPassword, phoneNumber, role, address],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, ...userData, password: undefined });
                }
            );
        });
    }
    
    static async findOne(query) {
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM users WHERE ';
            let params = [];
            
            if (query.email) {
                sql += 'email = ?';
                params.push(query.email);
            } else if (query.id) {
                sql += 'id = ?';
                params.push(query.id);
            }
            
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
    
    static async findById(id) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
    
    async comparePassword(candidatePassword) {
        return await bcrypt.compare(candidatePassword, this.password);
    }
}

module.exports = User;