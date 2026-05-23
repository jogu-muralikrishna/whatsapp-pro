import React, { useState } from 'react';
import { AdminLoginScreen } from './AdminLoginScreen';
import { AdminPanelScreen } from './AdminPanelScreen';

interface SecretAdminPanelProps {
    onClose: () => void;
}

export const SecretAdminPanel: React.FC<SecretAdminPanelProps> = ({ onClose }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [adminEmail, setAdminEmail] = useState('');

    const handleLoginSuccess = (email: string) => {
        setAdminEmail(email);
        setIsAuthenticated(true);
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
        setAdminEmail('');
    };

    if (!isAuthenticated) {
        return (
            <AdminLoginScreen 
                onClose={onClose} 
                onLoginSuccess={handleLoginSuccess} 
            />
        );
    }

    return (
        <AdminPanelScreen 
            adminEmail={adminEmail} 
            onClose={onClose} 
            onLogout={handleLogout} 
        />
    );
};
