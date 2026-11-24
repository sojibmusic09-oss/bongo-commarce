'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)bongo_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function safeJsonFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, data: { error: `API error (${res.status})` } };
  }
}

export default function WhatsAppBotDashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [device, setDevice] = useState<number>(1);
  const [status, setStatus] = useState<any>(null);

  const [phone, setPhone] = useState('');
  const [apiKeys, setApiKeys] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastImg, setBroadcastImg] = useState('');
  const [testQuestion, setTestQuestion] = useState('');
  const [testReply, setTestReply] = useState('');
  const [msg, setMsg] = useState('');

  async function apiCall(url: string, method = 'POST', body?: unknown) {
    setMsg('');
    const { ok, data } = await safeJsonFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function refreshStatus(dev = device) {
    const me = await safeJsonFetch('/api/v1/auth/me');
    if (!me.ok || !me.data.user) {
      setUser(null);
      return;
    }
    setUser(me.data.user);
    const res = await safeJsonFetch(`/api/v1/whatsapp/status?device=${dev}`);
    if (res.ok && res.data.data) {
      setStatus(res.data.data);
    } else if (res.data?.error) {
      setMsg(res.data.error);
    }
  }

  useEffect(() => {
    refreshStatus(device);
    const timer = setInterval(() => refreshStatus(device), 5000);
    return () => clearInterval(timer);
  }, [device]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiCall('/api/v1/auth/login', 'POST', loginForm);
      await refreshStatus(device);
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-slate-50 to-sky-50 p-6">
        <div className="mx-auto mt-14 max-w-md rounded-3xl border border-white/80 bg-white/75 p-7 shadow-xl backdrop-blur-xl">
          <h1 className="text-xl font-extrabold text-emerald-700">WhatsApp AI Bot Platform</h1>
          <p className="mt-1 text-xs text-slate-500">আপনার অ্যাকাউন্ট দিয়ে লগইন করুন</p>
          {msg && <p className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs text-red-700">{msg}</p>}
          <form onSubmit={handleLogin} className="mt-4 space-y-3">
            <input required type="email" placeholder="ইমেইল" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} className="w-full rounded-xl border bg-white/80 px-4 py-2.5 text-sm" />
            <input required type="password" placeholder="পাসওয়ার্ড" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} className="w-full rounded-xl border bg-white/80 px-4 py-2.5 text-sm" />
            <button type="submit" className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 py-3 text-sm font-bold text-white shadow-lg">
              লগইন করুন
            </button>
          </form>
          <Link href="/dashboard" className="mt-4 block text-center text-xs text-emerald-700 underline">
            নতুন অ্যাকাউন্ট খুলতে ড্যাশবোর্ডে যান →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(at_0%_0%,rgba(16,185,129,0.1)_0px,transparent_50%),radial-gradient(at_100%_0%,rgba(14,165,233,0.1)_0px,transparent_50%)] bg-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Glass Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/80 bg-white/75 px-6 py-4 shadow-lg backdrop-blur-xl">
          <div>
            <h1 className="text-xl font-extrabold text-emerald-700">WhatsApp AI Sales Bot</h1>
            <p className="text-xs text-slate-500">Multi-Device • Gemini Multi-Key • Neon DB Synced</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-4 py-1.5 text-xs font-bold ${status?.waConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>
              {status?.waConnected ? `🟢 Device #${device} Connected` : `🔴 Device #${device} Disconnected`}
            </span>
            <Link href="/dashboard" className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
              Owner Panel
            </Link>
          </div>
        </header>

        {msg && <div className="rounded-xl border border-emerald-200 bg-white/90 p-3 text-sm font-medium text-emerald-900 shadow-sm">{msg}</div>}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/90 bg-white/65 p-4 text-center shadow backdrop-blur-md">
            <p className="text-[11px] font-bold uppercase text-slate-500">Catalog Products</p>
            <p className="mt-1 text-2xl font-extrabold text-emerald-600">{status?.catalogCount ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/90 bg-white/65 p-4 text-center shadow backdrop-blur-md">
            <p className="text-[11px] font-bold uppercase text-slate-500">Saved Customers</p>
            <p className="mt-1 text-2xl font-extrabold text-emerald-600">{status?.savedCustomersCount ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/90 bg-white/65 p-4 text-center shadow backdrop-blur-md">
            <p className="text-[11px] font-bold uppercase text-slate-500">Gemini Keys</p>
            <p className="mt-1 text-2xl font-extrabold text-emerald-600">{status?.apiKeysCount ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/90 bg-white/65 p-4 text-center shadow backdrop-blur-md">
            <p className="text-[11px] font-bold uppercase text-slate-500">AI Requests Today</p>
            <p className="mt-1 text-2xl font-extrabold text-emerald-600">{status?.tokenUsage?.requestsToday ?? 0}</p>
          </div>
        </div>

        {/* Multi-Device Connect Card */}
        <section className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-lg backdrop-blur-xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-emerald-800">১. WhatsApp কানেক্ট (Pairing Code / QR)</h2>
            <div className="flex gap-2">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  onClick={() => setDevice(d)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold ${device === d ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 border'}`}
                >
                  Device #{d}
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await apiCall('/api/v1/whatsapp/pairing-code', 'POST', { device, phone });
                setMsg(`✅ Pairing Code তৈরি হয়েছে: ${res.pairingCode}`);
                refreshStatus(device);
              } catch (err: any) {
                setMsg(`❌ ${err.message}`);
              }
            }}
            className="flex flex-wrap gap-2"
          >
            <input required placeholder="WhatsApp নম্বর (যেমন: 017xxxxxxxx)" value={phone} onChange={(e) => setPhone(e.target.value)} className="flex-1 rounded-xl border bg-white/90 px-4 py-2.5 text-sm" />
            <button type="submit" className="rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-5 py-2.5 text-sm font-bold text-white shadow">
              Get Pairing Code
            </button>
          </form>

          {status?.pairingCode && (
            <div className="mt-4 rounded-2xl border-2 border-dashed border-emerald-600 bg-emerald-50/90 p-4 text-center">
              <p className="text-xs font-bold text-emerald-800">আপনার WhatsApp → Linked Devices → Link with phone number-এ কোডটি দিন:</p>
              <p className="mt-1 font-mono text-3xl font-extrabold tracking-widest text-emerald-700">{status.pairingCode}</p>
            </div>
          )}

          {status?.qrCode && !status?.waConnected && (
            <div className="mt-4 text-center">
              <img src={status.qrCode} alt="WhatsApp QR" className="mx-auto h-48 w-48 rounded-xl border bg-white p-2" />
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => apiCall('/api/v1/whatsapp/hard-reset', 'POST', { device }).then((r) => { setMsg(r.message); refreshStatus(device); }).catch((e) => setMsg(e.message))} className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white">
              Hard Reset Device #{device}
            </button>
            <button onClick={() => apiCall('/api/v1/whatsapp/logout', 'POST', { device }).then((r) => { setMsg(r.message); refreshStatus(device); }).catch((e) => setMsg(e.message))} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white">
              Logout Device #{device}
            </button>
          </div>
        </section>

        {/* Gemini Keys & Telegram Config */}
        <div className="grid gap-5 md:grid-cols-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apiCall('/api/v1/whatsapp/api-keys', 'POST', { apiKeys })
                .then((r) => { setMsg(`✅ ${r.totalKeys} টি Gemini API Key সেভ হয়েছে!`); refreshStatus(device); })
                .catch((err) => setMsg(err.message));
            }}
            className="space-y-3 rounded-2xl border border-white/80 bg-white/75 p-5 shadow-lg backdrop-blur-xl"
          >
            <h3 className="text-sm font-extrabold text-emerald-800">২. Gemini Multi-API Keys</h3>
            <textarea rows={3} required placeholder="প্রতি লাইনে বা কমা দিয়ে Gemini API Key দিন..." value={apiKeys} onChange={(e) => setApiKeys(e.target.value)} className="w-full rounded-xl border bg-white/90 p-3 text-xs font-mono" />
            <button type="submit" className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white">
              Save Gemini Keys
            </button>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              apiCall('/api/v1/whatsapp/config', 'POST', { adminPhone, telegramBotToken: tgToken, telegramChatId: tgChatId })
                .then(() => { setMsg('✅ Admin & Telegram সেটিংস সেভ হয়েছে!'); refreshStatus(device); })
                .catch((err) => setMsg(err.message));
            }}
            className="space-y-2.5 rounded-2xl border border-white/80 bg-white/75 p-5 shadow-lg backdrop-blur-xl"
          >
            <h3 className="text-sm font-extrabold text-emerald-800">৩. Admin Phone & Telegram Alert</h3>
            <input placeholder="Admin WhatsApp (01...)" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} className="w-full rounded-xl border bg-white/90 px-3 py-2 text-xs" />
            <input placeholder="Telegram Bot Token" value={tgToken} onChange={(e) => setTgToken(e.target.value)} className="w-full rounded-xl border bg-white/90 px-3 py-2 text-xs" />
            <input placeholder="Telegram Chat ID" value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} className="w-full rounded-xl border bg-white/90 px-3 py-2 text-xs" />
            <div className="flex gap-2">
              <button type="submit" className="flex-1 rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white">Save Config</button>
              <button type="button" onClick={() => apiCall('/api/v1/whatsapp/test-telegram', 'POST', {}).then((r) => setMsg(r.message)).catch((e) => setMsg(e.message))} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white">Test TG</button>
            </div>
          </form>
        </div>

        {/* Broadcast & AI Test */}
        <div className="grid gap-5 md:grid-cols-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apiCall('/api/v1/whatsapp/broadcast', 'POST', { message: broadcastMsg, imageUrl: broadcastImg || undefined })
                .then((r) => setMsg(`📢 ${r.totalRecipients} জন কাস্টমারকে ব্রডকাস্ট পাঠানো হয়েছে!`))
                .catch((err) => setMsg(err.message));
            }}
            className="space-y-3 rounded-2xl border border-white/80 bg-white/75 p-5 shadow-lg backdrop-blur-xl"
          >
            <h3 className="text-sm font-extrabold text-emerald-800">৪. WhatsApp Push Broadcast</h3>
            <textarea rows={2} required placeholder="অফার বা মেসেজ লিখুন..." value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value)} className="w-full rounded-xl border bg-white/90 p-3 text-xs" />
            <input placeholder="ছবির লিংক (ঐচ্ছিক)" value={broadcastImg} onChange={(e) => setBroadcastImg(e.target.value)} className="w-full rounded-xl border bg-white/90 px-3 py-2 text-xs" />
            <button type="submit" className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white">Send Broadcast</button>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              apiCall('/api/v1/whatsapp/test-chat', 'POST', { message: testQuestion })
                .then((r) => setTestReply(r.reply))
                .catch((err) => setMsg(err.message));
            }}
            className="space-y-3 rounded-2xl border border-white/80 bg-white/75 p-5 shadow-lg backdrop-blur-xl"
          >
            <h3 className="text-sm font-extrabold text-emerald-800">৫. AI Bot Test Chat</h3>
            <div className="flex gap-2">
              <input required placeholder="কাস্টমারের মতো প্রশ্ন লিখুন..." value={testQuestion} onChange={(e) => setTestQuestion(e.target.value)} className="flex-1 rounded-xl border bg-white/90 px-3 py-2 text-xs" />
              <button type="submit" className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">Test</button>
            </div>
            {testReply && <pre className="whitespace-pre-wrap rounded-xl bg-emerald-50 p-3 text-xs text-slate-800">{testReply}</pre>}
          </form>
        </div>

        {/* Live Terminal Logs */}
        <section className="rounded-2xl border border-white/80 bg-white/75 p-5 shadow-lg backdrop-blur-xl">
          <h3 className="mb-2 text-sm font-extrabold text-emerald-800">Live Bot Terminal Logs</h3>
          <div className="h-44 overflow-y-auto rounded-xl bg-slate-900 p-4 font-mono text-xs text-slate-100">
            {(status?.recentLogs || []).map((l: any, idx: number) => (
              <div key={idx} className="mb-1">
                <span className="text-emerald-400">[{l.time}]</span> [{l.level}] {l.message}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
