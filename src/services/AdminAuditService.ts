import { db } from '../lib/firebaseClient';

export interface AuditLogEntry {
    admin_email: string;
    target_phone: string;
    action: string;
    ip_address: string;
    user_agent: string;
}

export const AdminAuditService = {
    token: '',
    setToken(t: string) {
        this.token = t;
    },
    async logAction(email: string, targetPhone: string, action: string) {
        try {
            await fetch('/api/admin/audit-log', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': this.token ? `Bearer ${this.token}` : ''
                },
                body: JSON.stringify({
                    email,
                    targetPhone,
                    action,
                    timestamp: Date.now(),
                    userAgent: navigator.userAgent
                })
            });
        } catch (e) {
            // Decrypt handshake failure: Silent fail - never crash the application
        }
    }
};
