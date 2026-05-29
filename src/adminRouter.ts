import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseService } from './DatabaseService.js';

const router = express.Router();
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'gatekeeper_neural_flux_jwt_secret';

// Auth middleware to verify the session token
export const adminAuthMiddleware = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  let token = '';

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
  } else if (req.body && req.body.adminToken) {
    token = req.body.adminToken;
  } else if (req.query && req.query.adminToken) {
    token = req.query.adminToken as string;
  }

  // Backwards compatibility fallback for plain email in dev ONLY if JWT is disabled (dangerous but lets keep it safe)
  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: No admin session token provided' });
  }

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    // If it's a valid admin email (as token), but verify failed, handle strictly
    return res.status(401).json({ success: false, error: 'Unauthorized: Session token is invalid or expired' });
  }
};

async function logFailedLoginAttempt(email: string, reason: string, req: any) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || '';
  const timestamp = Date.now();

  const attempt = {
    email: email || 'Unknown',
    ip,
    userAgent,
    timestamp,
    reason
  };

  try {
    await DatabaseService.insertNotification({
      title: '🔴 Security Alert: Unauthorized Panel Access',
      message: `Failed admin authentication for ${email || 'Unknown'} from IP ${ip}. Reason: ${reason}`,
      type: 'security_alert',
      userId: 'all',
      timestamp
    });

    await DatabaseService.insertAuditLog({
      admin_email: 'SECURITY_SHIELD',
      target_phone: 'SYSTEM_CENTRAL',
      action: `Unlicensed Admin Login Attempt: ${email} (Reason: ${reason})`,
      ip_address: ip,
      user_agent: userAgent,
      timestamp
    });
  } catch (err) {
    console.error('Failed to log admin warning:', err);
  }

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({
      type: 'ADMIN_LOGIN_ATTEMPT_ALERT',
      data: attempt
    });
  }
}

router.post('/login', async (req: any, res: any) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    const envEmail = process.env.ADMIN_EMAIL || 'admin@pro.com';
    const envPasswordHash = process.env.ADMIN_PASSWORD_HASH;
    const envPasswordPlain = process.env.ADMIN_PASSWORD;

    let isMatch = false;
    let finalEmail = '';
    let finalRole = 'admin';

    if (email.trim().toLowerCase() === envEmail.toLowerCase()) {
      if (envPasswordHash) {
        isMatch = await bcrypt.compare(password, envPasswordHash);
        if (!isMatch && password === envPasswordHash) isMatch = true;
      } else if (envPasswordPlain) {
        isMatch = password === envPasswordPlain;
      } else {
        // Fallback to seeded database admins
        const admin = await DatabaseService.getAdminByEmail(email.trim());
        if (admin) {
          isMatch = await bcrypt.compare(password, admin.password_hash || admin.password || '');
          if (!isMatch && (password === admin.password || password === admin.password_hash)) isMatch = true;
        }
      }

      if (isMatch) {
        finalEmail = envEmail;
        finalRole = 'admin';
      }
    } else {
      // Otherwise check other db admins
      const admin = await DatabaseService.getAdminByEmail(email.trim());
      if (admin) {
        const match = await bcrypt.compare(password, admin.password_hash || admin.password || '');
        if (match || password === admin.password || password === admin.password_hash) {
          isMatch = true;
          finalEmail = admin.email;
          finalRole = admin.role || 'admin';
        }
      }
    }

    if (isMatch && finalEmail) {
      // Generate a session token secure JWT
      const token = jwt.sign(
        { email: finalEmail, role: finalRole, timestamp: Date.now() },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      return res.json({ success: true, email: finalEmail, role: finalRole, token });
    } else {
      await logFailedLoginAttempt(email, "Invalid credentials", req);
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  } catch (err: any) {
    console.error('Admin Login Error:', err);
    await logFailedLoginAttempt(email, `Login exception: ${err.message}`, req);
    return res.status(500).json({ success: false, error: "Invalid credentials" });
  }
});

router.post('/verify', async (req: any, res: any) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    const envEmail = process.env.ADMIN_EMAIL || 'admin@pro.com';
    const envPasswordHash = process.env.ADMIN_PASSWORD_HASH;
    const envPasswordPlain = process.env.ADMIN_PASSWORD;

    if (email.trim().toLowerCase() !== envEmail.toLowerCase()) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    let isMatch = false;
    if (envPasswordHash) {
      isMatch = await bcrypt.compare(password, envPasswordHash);
      if (!isMatch && password === envPasswordHash) isMatch = true;
    } else if (envPasswordPlain) {
      isMatch = password === envPasswordPlain;
    } else {
      // Fallback to standard seeded db
      const admin = await DatabaseService.getAdminByEmail(email.trim());
      if (admin) {
        isMatch = await bcrypt.compare(password, admin.password_hash || admin.password || '');
        if (!isMatch && (password === admin.password || password === admin.password_hash)) isMatch = true;
      }
    }

    if (isMatch) {
      const token = jwt.sign(
        { email: envEmail, role: 'admin', timestamp: Date.now() },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      return res.json({ success: true, email: envEmail, role: 'admin', token });
    } else {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  } catch (err: any) {
    console.error('Admin Verify Error:', err);
    return res.status(500).json({ success: false, error: "Service unavailable" });
  }
});

// Global state for admin login OTPs
let currentAdminOtps: Record<string, string> = {};

// Generate 6-digit pin for the active contact number
router.post('/request-otp', async (req: any, res: any) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }
  const clean = phone.replace(/\D/g, '');
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  currentAdminOtps[clean] = otp;
  
  // Note: We also set global variable so that client is updated
  (global as any).lastGeneratedOtp = { phone: clean, otp, timestamp: Date.now() };

  console.log(`[SECURITY CENTRAL] ADMIN 2FA OTP for +${clean} generated: ${otp}`);

  // Retrieve global proData to register the phone and send a real client-side notification message
  const gProData = (global as any).proData;
  if (gProData) {
    // 1. Add to registered phone numbers list
    if (!gProData.registeredPhones) {
      gProData.registeredPhones = [];
    }
    if (!gProData.registeredPhones.includes(clean)) {
      gProData.registeredPhones.push(clean);
    }

    // 2. Add message to the target phone's chat history so it shows up for real
    const formattedPhone = clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
    const mockMsg = {
        key: {
            id: 'AUTH-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
            fromMe: false,
            remoteJid: formattedPhone
        },
        message: {
            conversation: `[SECURITY VERIFICATION] Your 6-digit device linking verification PIN is: ${otp}`
        },
        text: `[SECURITY VERIFICATION] Your 6-digit device linking verification PIN is: ${otp}`,
        timestamp: Math.floor(Date.now() / 1000),
        chatJid: formattedPhone,
        status: 'received'
    };

    if (!gProData.messageHistory) {
        gProData.messageHistory = {};
    }
    if (!gProData.messageHistory[formattedPhone]) {
        gProData.messageHistory[formattedPhone] = [];
    }
    gProData.messageHistory[formattedPhone].push(mockMsg);

    // Save changes
    if (typeof (global as any).saveProData === 'function') {
      (global as any).saveProData();
    }
  }

  return res.json({ success: true, otp, message: `Verification code successfully dispatched to +${clean}.` });
});

// Get latest generated OTP (for user's in-app security notice or debug center)
router.get('/latest-otp', (req: any, res: any) => {
  const last = (global as any).lastGeneratedOtp;
  if (last && Date.now() - last.timestamp < 120000) { // Valid for 2 mins
    return res.json({ success: true, phone: last.phone, otp: last.otp });
  }
  return res.json({ success: false });
});

// Verify 6-digit OTP
router.post('/verify-otp', async (req: any, res: any) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ success: false, error: 'Missing phone or OTP parameter' });
  }
  const clean = phone.replace(/\D/g, '');
  const expectedOtp = currentAdminOtps[clean];

  if (expectedOtp && expectedOtp === otp.trim()) {
    delete currentAdminOtps[clean];
    // Return standard success token
    const token = jwt.sign(
      { email: 'device-approved-admin@pro.com', role: 'admin', phone: clean, timestamp: Date.now() },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    return res.json({ success: true, token, email: 'device-approved-admin@pro.com', role: 'admin' });
  }

  // Fallback for demo convenience - let 888888 or 123456 be alternative master bypass
  if (otp.trim() === '888888' || otp.trim() === '123456') {
    const token = jwt.sign(
      { email: 'master-override-admin@pro.com', role: 'admin', phone: clean, timestamp: Date.now() },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    return res.json({ success: true, token, email: 'master-override-admin@pro.com', role: 'admin' });
  }

  await logFailedLoginAttempt(`phone-${clean}`, `Invalid 2FA linking PIN: ${otp}`, req);
  return res.status(401).json({ success: false, error: 'Invalid 6-digit security PIN.' });
});

// Protect audit-log router using adminAuthMiddleware
router.post('/audit-log', adminAuthMiddleware, async (req: any, res: any) => {
  try {
    const logEntry = req.body;
    const inserted = await DatabaseService.insertAuditLog(logEntry);
    return res.json({ success: true, log: inserted });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to insert audit log' });
  }
});

// Get all administrative users
router.get('/users', adminAuthMiddleware, async (req: any, res: any) => {
  try {
    const list = await DatabaseService.getAllAdmins();
    // Map with passwords stripped
    const safeList = list.map((a: any) => ({
      email: a.email,
      role: a.role,
      createdAt: a.createdAt || Date.now()
    }));
    return res.json({ success: true, users: safeList });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Create a new admin
router.post('/users', adminAuthMiddleware, async (req: any, res: any) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    const cleanEmail = email.trim().toLowerCase();
    
    // Check if admin already exists
    const existing = await DatabaseService.getAdminByEmail(cleanEmail);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Administrator already exists with this email address' });
    }

    // Salt and hash using bcrypt for security
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    
    const admin = await DatabaseService.createAdmin(cleanEmail, passwordHash, role || 'admin');

    // Audit log this creation
    await DatabaseService.insertAuditLog({
      admin_email: req.admin?.email || 'System Admin',
      target_phone: 'SYSTEM_CONFIG',
      action: `Created new admin account: ${cleanEmail} (Role: ${role || 'admin'})`,
      ip_address: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      user_agent: req.headers['user-agent'] || 'Interface Admin Panel'
    });

    return res.json({ success: true, email: admin.email, role: admin.role });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Revoke/Delete admin user
router.delete('/users', adminAuthMiddleware, async (req: any, res: any) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email parameter to delete is required' });
    }
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail === 'admin@pro.com') {
      return res.status(400).json({ success: false, error: 'Cannot revoke default Super Admin account' });
    }
    if (cleanEmail === req.admin?.email) {
      return res.status(400).json({ success: false, error: 'Cannot revoke your own active admin account' });
    }

    const success = await DatabaseService.deleteAdmin(cleanEmail);
    if (success) {
      // Audit log this revocation
      await DatabaseService.insertAuditLog({
        admin_email: req.admin?.email || 'System Admin',
        target_phone: 'SYSTEM_CONFIG',
        action: `Revoked admin account: ${cleanEmail}`,
        ip_address: req.ip || req.connection?.remoteAddress || '127.0.0.1',
        user_agent: req.headers['user-agent'] || 'Interface Admin Panel'
      });
      return res.json({ success: true, message: 'Revoked administrative access privileges' });
    } else {
      return res.status(404).json({ success: false, error: 'Administrative record not found' });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch raw Audit Logs
router.get('/audit-logs', adminAuthMiddleware, async (req: any, res: any) => {
  try {
    const logs = await DatabaseService.getAuditLogs();
    // Sort chronologically (latest first)
    const sorted = [...logs].sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    return res.json({ success: true, logs: sorted });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch Security / failed attempts notifications list
router.get('/login-attempts', adminAuthMiddleware, async (req: any, res: any) => {
  try {
    const alerts = await DatabaseService.getUserNotifications('all');
    // Filter security alerts
    const securityAlerts = alerts.filter((a: any) => a.type === 'security_alert');
    const sorted = [...securityAlerts].sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    return res.json({ success: true, attempts: sorted });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
export { router as adminRouter };
