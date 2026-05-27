import React, { useState } from 'react';
import { AdminLoginScreen } from './AdminLoginScreen';
import { AdminPanelScreen } from './AdminPanelScreen';

interface SecretAdminPanelProps {
    onClose: () => void;
    currentPhoneNumber?: string;
}

export const SecretAdminPanel: React.FC<SecretAdminPanelProps> = ({ onClose, currentPhoneNumber }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [adminEmail, setAdminEmail] = useState('');
    const [adminToken, setAdminToken] = useState('');

    const handleLoginSuccess = (email: string, token: string) => {
        setAdminEmail(email);
        setAdminToken(token);
        setIsAuthenticated(true);
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
        setAdminEmail('');
        setAdminToken('');
    };

    if (!isAuthenticated) {
        return (
            <AdminLoginScreen 
                onClose={onClose} 
                onLoginSuccess={handleLoginSuccess}
                currentPhoneNumber={currentPhoneNumber}
            />
        );
    }

    return (
        <AdminPanelScreen 
            adminEmail={adminEmail} 
            adminToken={adminToken}
            onClose={onClose} 
            onLogout={handleLogout} 
        />
    );
};
