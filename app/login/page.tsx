'use client';

import { useState, FormEvent, ChangeEvent } from 'react';

export default function LoginPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [masked, setMasked] = useState('');
  const [countdown, setCountdown] = useState(300);

  const handleIdentifierChange = (e: ChangeEvent<HTMLInputElement>) => {
    setIdentifier(e.target.value);
    setError('');
  };

  const handleOtpChange = (e: ChangeEvent<HTMLInputElement>) => {
    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
  };

  const handleRequestOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengirim OTP');
      setMasked(data.masked || identifier);
      setStep(2);
      setCountdown(300);
      setSuccess(data.message || 'OTP terkirim');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verifikasi gagal');
      setSuccess('Login berhasil! Mengarahkan...');
      // Redirect to home or dashboard
      setTimeout(() => window.location.href = '/', 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = () => {
    setStep(1);
    setOtp('');
    setCountdown(300);
  };

  // Countdown timer
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;

  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-50 px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-serif font-medium text-stone-900">Masuk ke Rancan</h1>
          <p className="text-stone-500 mt-1 text-sm">Masukkan identitas untuk menerima kode OTP via Telegram</p>
        </div>

        {step === 1 && (
          <form onSubmit={handleRequestOtp} className="space-y-5">
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-stone-700 mb-1">
                Nomor HP / Email / Telegram ID
              </label>
              <input
                id="identifier"
                type="text"
                value={identifier}
                onChange={handleIdentifierChange}
                placeholder="081234567890 atau email@domain.com"
                className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                required
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm" role="alert">
                {error}
              </div>
            )}

            {success && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm" role="status">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !identifier}
              className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              {loading ? 'Mengirim...' : 'Kirim Kode OTP'}
            </button>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm text-center">
              Kode OTP dikirim ke <strong className="text-stone-900">{masked}</strong>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-stone-700 mb-1">
                  Kode OTP (6 digit)
                </label>
                <input
                  id="otp"
                  type="text"
                  value={otp}
                  onChange={handleOtpChange}
                  placeholder="123456"
                  maxLength={6}
                  className="w-full px-4 py-3 border border-stone-300 rounded-xl text-2xl tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-between text-sm text-stone-500">
                <span>Kode berlaku: {minutes}:{seconds.toString().padStart(2, '0')}</span>
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-amber-600 hover:text-amber-700 font-medium transition-colors"
                >
                  Kirim Ulang
                </button>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm" role="alert">
                  {error}
                </div>
              )}

              {success && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm" role="status">
                  {success}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
              >
                {loading ? 'Memverifikasi...' : 'Verifikasi & Masuk'}
              </button>
            </form>

            {/* Divider + SSO */}
            <div className="flex items-center gap-3 py-2">
              <div className="h-px bg-stone-200 flex-1" />
              <span className="text-xs text-stone-400 uppercase tracking-wide">atau</span>
              <div className="h-px bg-stone-200 flex-1" />
            </div>

            <a
              href="/api/auth/login-oidc"
              className="w-full flex items-center justify-center gap-2 py-3 border border-stone-300 hover:border-amber-500 hover:bg-amber-50 text-stone-700 font-medium rounded-xl transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Login dengan SSO
            </a>

            <div className="text-center pt-4">
              <a href="/" className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
                ← Kembali ke beranda
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}