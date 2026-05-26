import express from 'express';
import bcrypt from 'bcryptjs';
import { DatabaseService } from './DatabaseService.js';

const router = express.Router();

router.post('/login', async (req: any, res: any) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    const envEmail = process.env.ADMIN_EMAIL || 'admin@pro.com';
    const envPasswordHash = process.env.ADMIN_PASSWORD_HASH;
    const envPasswordPlain = process.env.ADMIN_PASSWORD;

    if (email.trim().toLowerCase() === envEmail.toLowerCase()) {
      let isMatch = false;
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
        return res.json({ success: true, email: envEmail, role: 'admin' });
      } else {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
      }
    }

    // Otherwise check other db admins
    const admin = await DatabaseService.getAdminByEmail(email.trim());
    if (!admin) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, admin.password_hash || admin.password || '');
    if (match || password === admin.password || password === admin.password_hash) {
      return res.json({ success: true, email: admin.email, role: admin.role });
    } else {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  } catch (err: any) {
    console.error('Admin Login Error:', err);
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
      return res.json({ success: true, email: envEmail, role: 'admin' });
    } else {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  } catch (err: any) {
    console.error('Admin Verify Error:', err);
    return res.status(500).json({ success: false, error: "Service unavailable" });
  }
});

router.post('/audit-log', async (req: any, res: any) => {
  try {
    const logEntry = req.body;
    const inserted = await DatabaseService.insertAuditLog(logEntry);
    return res.json({ success: true, log: inserted });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to insert audit log' });
  }
});

export default router;
export { router as adminRouter };
