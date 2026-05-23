import React, { useState } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { ShieldAlert, LogIn, Mail, Key, X, CornerDownLeft } from 'lucide-react';
import { auth } from '../lib/firebaseClient';
import { AdminAuditService } from '../services/AdminAuditService';

interface AdminLoginScreenProps {
    onClose: () => void;
    onLoginSuccess: (email: string) => void;
}

export const AdminLoginScreen: React.FC<AdminLoginScreenProps> = ({ onClose, onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) return;

        setIsLoading(true);
        setErrorMsg('');

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const idTokenResult = await userCredential.user.getIdTokenResult();
            
            // Check custom claims
            const isAdmin = idTokenResult.claims.role === 'admin';
            
            if (isAdmin) {
                // Log successful login
                await AdminAuditService.logAction(email, 'self', 'login_success');
                onLoginSuccess(email);
            } else {
                // Deny access and sign out
                await AdminAuditService.logAction(email, 'self', 'login_denied_no_claim');
                await signOut(auth);
                setErrorMsg('Access Denied: Your account does not possess the designated "admin" authorization privilege.');
            }
        } catch (error: any) {
            console.error('Firebase Auth Error:', error);
            // Log failed attempt
            await AdminAuditService.logAction(email || 'unknown', 'self', `login_failure: ${error.message || 'invalid_credentials'}`);
            setErrorMsg('Invalid email or password. Authentication handshake failed.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div id="admin-login-overlay" className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 transition-all duration-300">
            <div id="admin-login-modal" className="w-full max-w-md bg-[#0c1317] rounded-3xl border border-[#00a884]/20 shadow-[0_0_50px_rgba(0,168,132,0.1)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div id="admin-login-header" className="p-6 bg-[#111b21] border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div id="admin-login-icon-glow" className="p-2.5 bg-[#00a884]/10 text-[#00a884] rounded-xl shadow-[0_0_15px_rgba(0,168,132,0.1)]">
                            <ShieldAlert className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-md font-black text-white uppercase italic tracking-wider">Secure Portal</h2>
                            <p className="text-[9px] font-black text-[#00a884] uppercase tracking-widest">Administrative Auth Gateway</p>
                        </div>
                    </div>
                    <button 
                        id="admin-login-close"
                        onClick={onClose} 
                        className="p-2 hover:bg-white/5 text-white/40 hover:text-white rounded-full transition-all"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form Container */}
                <div className="p-8 bg-gradient-to-b from-[#0c1317] to-[#080d0f] space-y-6">
                    <div className="text-center space-y-1">
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">Admin Verification</h3>
                        <p className="text-[10px] text-white/40">Credential validation via Cloud Gatekeeper</p>
                    </div>

                    {errorMsg && (
                        <div id="admin-login-error" className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-[11px] text-center font-bold italic leading-relaxed">
                            {errorMsg}
                        </div>
                    )}

                    <form id="admin-login-form" onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="block text-[8px] font-black uppercase text-white/40 tracking-widest">Email Address</label>
                            <div className="relative">
                                <span className="absolute left-4 top-3.5 text-white/30">
                                    <Mail className="w-4 h-4" />
                                </span>
                                <input 
                                    id="admin-email-input"
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="admin@enterprise.domain"
                                    required
                                    className="w-full pl-11 pr-4 py-3.5 bg-[#202c33] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/40 transition-all font-mono"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-[8px] font-black uppercase text-white/40 tracking-widest">Security Password</label>
                            <div className="relative">
                                <span className="absolute left-4 top-3.5 text-white/30">
                                    <Key className="w-4 h-4" />
                                </span>
                                <input 
                                    id="admin-password-input"
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    required
                                    className="w-full pl-11 pr-4 py-3.5 bg-[#202c33] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/40 transition-all font-mono"
                                />
                            </div>
                        </div>

                        <button 
                            id="admin-login-submit"
                            type="submit" 
                            disabled={isLoading}
                            className="w-full py-3.5 mt-2 bg-[#00a884] hover:bg-[#009675] disabled:cursor-wait text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(0,168,132,0.15)] hover:shadow-[0_0_25px_rgba(0,168,132,0.25)]"
                        >
                            <LogIn className="w-4 h-4" />
                            {isLoading ? 'Decrypting Signatures...' : 'Establish Tactical Port'}
                        </button>
                    </form>

                    <div className="pt-2 border-t border-white/5 text-center">
                        <button 
                            onClick={onClose} 
                            className="text-[9px] font-bold uppercase text-white/30 hover:text-[#00a884] transition-colors flex items-center justify-center gap-1 mx-auto"
                        >
                            <CornerDownLeft className="w-3 h-3" />
                            Return to Matrix Terminal
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
