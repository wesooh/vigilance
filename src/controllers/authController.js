// Update registerClient function
exports.registerClient = async (req, res) => {
    try {
        const { firstName, lastName, email, password, phoneNumber, address } = req.body;
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }
        
        const user = await User.create({
            firstName, lastName, email, password, phoneNumber, address,
            role: 'client'
        });
        
        const token = generateToken(user.id);
        
        res.status(201).json({
            success: true,
            data: { userId: user.id, firstName, lastName, email, role: 'client', token }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update registerWorker function
exports.registerWorker = async (req, res) => {
    try {
        const { firstName, lastName, email, password, phoneNumber, address } = req.body;
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }
        
        const user = await User.create({
            firstName, lastName, email, password, phoneNumber, address,
            role: 'worker'
        });
        
        const token = generateToken(user.id);
        
        res.status(201).json({
            success: true,
            data: { userId: user.id, firstName, lastName, email, role: 'worker', token }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update login function
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const token = generateToken(user.id);
        
        res.status(200).json({
            success: true,
            data: {
                userId: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role,
                token
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// Add these missing functions at the bottom of the file

exports.verifyOTP = async (req, res) => {
    res.status(200).json({ success: true, message: 'OTP verified (test mode)' });
};

exports.resendOTP = async (req, res) => {
    res.status(200).json({ success: true, message: 'OTP resent (test mode)' });
};

exports.forgotPassword = async (req, res) => {
    res.status(200).json({ success: true, message: 'Password reset email sent (test mode)' });
};

exports.resetPassword = async (req, res) => {
    res.status(200).json({ success: true, message: 'Password reset successful (test mode)' });
};

exports.updateProfile = async (req, res) => {
    try {
        res.status(200).json({ success: true, message: 'Profile updated (test mode)' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.logout = async (req, res) => {
    res.status(200).json({ success: true, message: 'Logged out successfully' });
};