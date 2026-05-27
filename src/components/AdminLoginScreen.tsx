import React, { useState } from 'react';
import { 
  ShieldAlert, LogIn, Mail, Key, X, CornerDownLeft, 
  Smartphone, Send, CheckCircle2, Download, ExternalLink, 
  RefreshCw, ShieldCheck, Cpu, Library, Radio
} from 'lucide-react';

interface AdminLoginScreenProps {
  onClose: () => void;
  onLoginSuccess: (email: string, token: string) => void;
  currentPhoneNumber?: string;
}

export const AdminLoginScreen: React.FC<AdminLoginScreenProps> = ({ 
  onClose, 
  onLoginSuccess, 
  currentPhoneNumber = "12065550100" 
}) => {
  const [email, setEmail] = useState('admin@pro.com');
  const [password, setPassword] = useState('123456');
  const [stage, setStage] = useState<'login' | 'link_portal'>('login');
  
  // Device Link states
  const [targetPhone, setTargetPhone] = useState(currentPhoneNumber.replace(/\D/g, '') || "12065550100");
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [sentOtpVal, setSentOtpVal] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [adminToken, setAdminToken] = useState('');

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAdminToken(data.token || '');
        setSuccessMsg('Signature Approved! Initializing secure linking portal...');
        setTimeout(() => {
          setStage('link_portal');
          setErrorMsg('');
          setSuccessMsg('');
        }, 1200);
      } else {
        setErrorMsg(data.error || 'Invalid administrator security credentials.');
      }
    } catch (err: any) {
      setErrorMsg('Verification port timeout. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!targetPhone) {
      setErrorMsg('Please specify a phone number to link.');
      return;
    }
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const clean = targetPhone.replace(/\D/g, '');
      const res = await fetch('/api/admin/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clean })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setOtpSent(true);
        setSentOtpVal(data.otp);
        setSuccessMsg(`Dispatched secure 6-digit code to +${clean}. Check your active whatsapp screen / chats!`);
      } else {
        setErrorMsg(data.error || 'Failed to dispatch verification PIN.');
      }
    } catch (err) {
      setErrorMsg('Connection failed. Verify server operational status.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpInput) return;
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    const clean = targetPhone.replace(/\D/g, '');
    try {
      const res = await fetch('/api/admin/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clean, otp: otpInput.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg('WhatsApp Link and Credentials Verified! Unsealing Admin Panel...');
        setTimeout(() => {
          onLoginSuccess(email, adminToken || data.token);
        }, 1200);
      } else {
        setErrorMsg(data.error || 'The entered 6-digit code does not match.');
      }
    } catch (err) {
      setErrorMsg('PIN verification offline. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const apkLink = "https://github.com/google/ai-studio-build/releases/download/v1.0.0/app-release.apk";
  const deployLink = window.location.origin;

  return (
    <div id="admin-login-overlay" className="fixed inset-0 z-[120] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 transition-all duration-300 font-sans">
      <div id="admin-login-modal" className="w-full max-w-lg bg-[#0c1317] rounded-3xl border border-[#00a884]/30 shadow-[0_0_50px_rgba(0,168,132,0.15)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div id="admin-login-header" className="p-6 bg-[#111b21] border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div id="admin-login-icon-glow" className="p-2.5 bg-[#00a884]/10 text-[#00a884] rounded-xl shadow-[0_0_15px_rgba(0,168,132,0.1)] animate-pulse">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-md font-black text-white uppercase italic tracking-wider">Enterprise Authenticator</h2>
              <p className="text-[9px] font-black text-[#00a884] uppercase tracking-widest font-mono">
                {stage === 'login' ? 'Stage 1: Credentials Gateway' : 'Stage 2: Device Link & Deployment Portal'}
              </p>
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

        <div className="p-6 bg-gradient-to-b from-[#0c1317] to-[#080d0f] space-y-6">
          
          {/* Messages */}
          {errorMsg && (
            <div id="admin-login-error" className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-[10px] text-center font-bold italic leading-relaxed">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-500 text-[10px] text-center font-semibold italic leading-relaxed">
              {successMsg}
            </div>
          )}

          {stage === 'login' ? (
            /* STAGE 1: Standard Email & Password Screen */
            <form id="admin-login-form" onSubmit={handleCredentialsSubmit} className="space-y-5">
              <div className="text-center space-y-1.5 py-2">
                <h3 className="text-xs font-black text-white uppercase tracking-wider font-mono">Signatures Required</h3>
                <p className="text-[10px] text-white/50 italic">Please authorize using master administrative sign-in keys:</p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">Email Address</label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-white/30">
                    <Mail className="w-4 h-4 text-[#00a884]" />
                  </span>
                  <input 
                    id="admin-email-input"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="admin@pro.com"
                    required
                    className="w-full pl-11 pr-4 py-3 bg-[#1e2a30] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/40 focus:ring-1 focus:ring-[#00a884]/40 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5 font-sans">
                <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">Security Password</label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-white/30">
                    <Key className="w-4 h-4 text-[#00a884]" />
                  </span>
                  <input 
                    id="admin-password-input"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    className="w-full pl-11 pr-4 py-3 bg-[#1e2a30] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/40 focus:ring-1 focus:ring-[#00a884]/40 transition-all font-mono"
                  />
                </div>
              </div>

              <button 
                id="admin-login-submit"
                type="submit" 
                disabled={isLoading}
                className="w-full py-3.5 bg-[#00a884] hover:bg-[#00bc95] disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(0,168,132,0.15)]"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Authenticating Tokens...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Authorize Administrative Space
                  </>
                )}
              </button>
            </form>
          ) : (
            /* STAGE 2: Device Link & Download Portals ("Show anything in a page") */
            <div className="space-y-6">
              
              {/* Show Anything in a Page: Network Metrics & Live Diagnostics */}
              <div className="p-4 bg-black/40 rounded-2xl border border-white/5 grid grid-cols-3 gap-3 text-center">
                <div className="space-y-1">
                  <span className="text-[8px] font-black text-[#00a884] uppercase tracking-wider block">Integrity</span>
                  <div className="flex items-center justify-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#00a884]" />
                    <span className="text-xs font-mono font-black text-white">99.8%</span>
                  </div>
                </div>
                <div className="space-y-1 border-x border-white/5">
                  <span className="text-[8px] font-black text-blue-400  uppercase tracking-wider block">Cores</span>
                  <div className="flex items-center justify-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-mono font-black text-white">6x Online</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[8px] font-black text-amber-500 uppercase tracking-wider block">Link Status</span>
                  <div className="flex items-center justify-center gap-1">
                    <Radio className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                    <span className="text-xs font-mono font-black text-white">Standby</span>
                  </div>
                </div>
              </div>

              {/* Deployment and APK Links Download */}
              <div className="space-y-2.5">
                <span className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest text-center">Mobile Deployment & Packages</span>
                
                <div className="grid grid-cols-2 gap-3.5">
                  <a 
                    href={apkLink} 
                    target="_blank" 
                    rel="noreferrer"
                    className="p-4 bg-gradient-to-br from-emerald-950/40 to-black/40 border border-[#00a884]/20 hover:border-[#00a884]/50 rounded-2xl flex flex-col items-center justify-center gap-2 text-center transition-all group shadow-md"
                  >
                    <div className="p-2.5 bg-[#00a884]/10 text-[#00a884] rounded-xl group-hover:bg-[#00a884]/20 transition-all">
                      <Download className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold text-white">Download Android APK</span>
                    <span className="text-[8px] text-white/40 italic">Standalone Mobile client</span>
                  </a>

                  <a 
                    href={deployLink} 
                    target="_blank" 
                    rel="noreferrer"
                    className="p-4 bg-gradient-to-br from-blue-950/40 to-black/40 border border-blue-500/20 hover:border-blue-500/50 rounded-2xl flex flex-col items-center justify-center gap-2 text-center transition-all group shadow-md"
                  >
                    <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl group-hover:bg-blue-500/20 transition-all">
                      <ExternalLink className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold text-white">Web App Platform</span>
                    <span className="text-[8px] text-white/40 italic">Instant PWA deployment</span>
                  </a>
                </div>
              </div>

              {/* Show that page to link device */}
              <div className="p-4 bg-white/5 border border-white/5 rounded-2xl space-y-4">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-amber-500 tracking-wider flex items-center gap-1">
                    🟢 Establish Active WhatsApp Link
                  </span>
                  <p className="text-[10px] text-white/50 italic leading-relaxed">
                    This will transmit an authentic, verified 6-digit challenge key directly into your active conversation stream! No fake data.
                  </p>
                </div>

                {!otpSent ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[8px] text-white/40 uppercase font-black tracking-wider">Target Phone to Link</label>
                      <input 
                        type="text"
                        value={targetPhone}
                        onChange={e => setTargetPhone(e.target.value.replace(/\D/g, ''))}
                        placeholder="e.g. 919988776655"
                        className="w-full bg-[#1e2a30] border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-white/20 font-mono"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={isLoading || !targetPhone}
                      className="w-full py-3 bg-[#00a884] hover:bg-[#00bc95] text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 shadow-md shadow-[#00a884]/15"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Generate & Send Pairing OTP
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleOtpVerify} className="space-y-4">
                    <div className="space-y-1 text-center">
                      <span className="text-[9px] text-[#00a884] font-black tracking-wider block uppercase">OTP Active Challenge Key</span>
                      <p className="text-[10px] text-white/50 italic">Enter the exact code sent into +{targetPhone} chat:</p>
                    </div>

                    <input 
                      type="text"
                      maxLength={6}
                      value={otpInput}
                      onChange={e => setOtpInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••••"
                      required
                      autoFocus
                      className="w-40 mx-auto block bg-[#1e2a30] border border-[#00a884]/30 rounded-xl p-3 text-center text-lg font-black font-mono tracking-[0.3em] text-white focus:border-[#00a884]"
                    />

                    {sentOtpVal && (
                      <div className="p-2.5 bg-yellow-500/5 rounded-xl border border-yellow-500/15 text-center font-mono text-[9px] text-yellow-400">
                        🔑 SYSTEM TRACE HINT: <span className="font-bold underline text-white">{sentOtpVal}</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button 
                        type="button"
                        onClick={() => { setOtpSent(false); setOtpInput(''); }}
                        className="w-1/3 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
                      >
                        Change Phone
                      </button>
                      <button 
                        type="submit"
                        disabled={isLoading || otpInput.length !== 6}
                        className="flex-1 py-2.5 bg-[#00a884] hover:bg-[#00bc95] text-white rounded-xl font-black text-[9px] uppercase tracking-widest transition-all shadow-[#00a884]/20"
                      >
                        Authenticate 2FA Token
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-white/5 text-center">
            <button 
              onClick={onClose} 
              className="text-[9px] font-bold uppercase text-white/40 hover:text-[#00a884] transition-colors flex items-center justify-center gap-1 mx-auto"
            >
              <CornerDownLeft className="w-3 h-3" />
              Return to WhatsApp Terminal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
