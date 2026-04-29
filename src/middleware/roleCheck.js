const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: `Access denied. Required role: ${roles.join(' or ')}` 
      });
    }
    
    next();
  };
};

const isAdmin = checkRole(['admin']);
const isWorker = checkRole(['worker']);
const isClient = checkRole(['client']);
const isWorkerOrClient = checkRole(['worker', 'client']);

module.exports = { checkRole, isAdmin, isWorker, isClient, isWorkerOrClient };