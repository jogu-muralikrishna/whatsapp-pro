import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebaseClient';

export interface AuditLogEntry {
    admin_email: string;
    target_phone: string;
    action: string;
    ip_address: string;
    user_agent: string;
}

export const AdminAuditService = {
    async logAction(email: string, targetPhone: string, action: string) {
        try {
            // Safely attempt to fetch public IP
            let ipAddress = 'unknown';
            try {
                const res = await fetch('https://api.ipify.org?format=json');
                if (res.ok) {
                    const data = await res.json();
                    ipAddress = data.ip;
                }
            } catch (e) {
                console.warn('Could not resolve client environment IP address:', e);
            }

            const userAgent = navigator.userAgent || 'unknown';

            await addDoc(collection(db, 'admin_audit_logs'), {
                admin_email: email,
                target_phone: targetPhone,
                timestamp: serverTimestamp(),
                action,
                ip_address: ipAddress,
                user_agent: userAgent
            });
            console.log(`[AdminAuditService] Logged action "${action}" for target "${targetPhone}"`);
        } catch (error) {
            console.error('[AdminAuditService] Failed to record tactical audit log entry:', error);
        }
    }
};
