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
    const data = JSON.parse(text);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: res.status,
      data: { error: `সার্ভার API পাওয়া যায়নি (${res.status})।` },
    };
  }
}

export default function SuperAdminPage() {
  const [user, setUser] = useState<any>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [tab, setTab] = useState<'overview' | 'stores' | 'payments' | 'database' | 'backups' | 'logs'>('overview');
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const [dbForm, setDbForm] = useState({
    engine: 'mysql' as 'postgresql' | 'mysql' | 'mariadb',
    host: '127.0.0.1',
    port: 3306,
    database: '',
    username: '',
    password: '',
    ssl: false,
    reauthPassword: '',
    confirmZeroDataLossAck: false,
  });
  const [dbTestResult, setDbTestResult] = useState<any>(null);
  const [switchSteps, setSwitchSteps] = useState<any[]>([]);
  const [newStore, setNewStore] = useState({ name: '', slug: '', tagline: '' });

  async function loadOverview() {
    setLoading(true);
    try {
      const me = await safeJsonFetch('/api/v1/auth/me');
      setUser(me.ok ? me.data.user || null : null);
      if (me.ok && me.data.user?.platform_role === 'SUPER_ADMIN') {
        const res = await safeJsonFetch('/api/v1/super-admin/overview');
        if (res.ok) setData(res.data);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  async function apiMutate(url: string, method = 'POST', body: unknown = {}) {
    setMsg('');
    const { ok, data: json } = await safeJsonFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
      body: JSON.stringify(body),
    });
    if (!ok) throw new Error(json.error || 'Action failed');
    return json;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiMutate('/api/v1/auth/login', 'POST', loginForm);
      await loadOverview();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleStoreStatus(storeId: string, status: string) {
    try {
      await apiMutate(`/api/v1/super-admin/stores/${storeId}/status`, 'POST', { status });
      setMsg(`Store status updated to ${status}`);
      await loadOverview();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleCreateStore(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiMutate('/api/v1/stores', 'POST', newStore);
      setNewStore({ name: '', slug: '', tagline: '' });
      setMsg('✅ Store created by Super Admin');
      await loadOverview();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleVerifyDomain(domainId: string, status: 'VERIFIED' | 'FAILED') {
    try {
      await apiMutate(`/api/v1/super-admin/domains/${domainId}/verify`, 'POST', { status });
      setMsg(`Domain marked ${status}`);
      await loadOverview();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleVerifyPayment(paymentId: string, decision: 'APPROVE' | 'REJECT') {
    try {
      await apiMutate(`/api/v1/payments/${paymentId}/verify`, 'POST', {
        decision,
        reason: decision === 'REJECT' ? 'Rejected by Super Admin' : undefined,
      });
      setMsg(`Payment ${decision}D`);
      await loadOverview();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleTestDb() {
    try {
      const res = await apiMutate('/api/v1/super-admin/database/test', 'POST', {
        engine: dbForm.engine,
        host: dbForm.host,
        port: Number(dbForm.port),
        database: dbForm.database,
        username: dbForm.username,
        password: dbForm.password,
        ssl: dbForm.ssl,
      });
      setDbTestResult(res);
    } catch (err: any) {
      setDbTestResult({ ok: false, error: err.message });
    }
  }

  async function handleRunMigrations() {
    try {
      const res = await apiMutate('/api/v1/super-admin/database/migrate', 'POST', {});
      setMsg(`Migrations applied: ${res.applied?.join(', ') || 'All up to date'}`);
      await loadOverview();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleSwitchDatabase(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const res = await apiMutate('/api/v1/super-admin/database/switch', 'POST', {
        ...dbForm,
        port: Number(dbForm.port),
      });
      setSwitchSteps(res.steps || []);
      setMsg(res.success ? '✅ Database switched with Zero-Data-Loss verification!' : `❌ ${res.error}`);
      await loadOverview();
    } catch (err: any) {
      setMsg(`❌ ${err.message}`);
    }
  }

  async function handleCreateBackup() {
    try {
      const b = await apiMutate('/api/v1/super-admin/backups', 'POST', {});
      setMsg(`✅ Encrypted Backup created: ${b.filename} (SHA256: ${b.sha256Checksum.slice(0, 12)}...)`);
      await loadOverview();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleRestoreBackup(filename: string) {
    if (!confirm(`Restore ${filename}? Current DB will be backed up first.`)) return;
    try {
      const res = await apiMutate('/api/v1/super-admin/backups/restore', 'POST', { filename });
      setMsg(`✅ Backup restored (${res.restoredRows} rows).`);
      await loadOverview();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  if (!user || user.platform_role !== 'SUPER_ADMIN') {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Super Admin Login</h1>
        <p className="mt-1 text-xs text-slate-500">সিস্টেম অ্যাডমিন অ্যাকাউন্ট দিয়ে লগইন করুন।</p>
        {msg && <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{msg}</p>}
        <form onSubmit={handleLogin} className="mt-4 space-y-3">
          <input
            required
            type="email"
            placeholder="Admin Email"
            value={loginForm.email}
            onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <input
            required
            type="password"
            placeholder="Password"
            value={loginForm.password}
            onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <button type="submit" className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white">
            লগইন করুন
          </button>
        </form>
        <Link href="/" className="mt-4 block text-center text-xs text-indigo-600 hover:underline">
          ← হোমপেজে ফিরে যান
        </Link>
      </div>
    );
  }

  const orderRevenue = (data?.payments || [])
    .filter((p: any) => p.purpose === 'STORE_ORDER' && p.status === 'PAID')
    .reduce((s: number, p: any) => s + Number(p.amount), 0);
  const subRevenue = (data?.payments || [])
    .filter((p: any) => p.purpose === 'STORE_SUBSCRIPTION' && p.status === 'PAID')
    .reduce((s: number, p: any) => s + Number(p.amount), 0);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold">Super Admin Console</h1>
            <p className="text-xs text-slate-300">
              {user.email} | Active DB: {data?.dbStatus?.engine?.toUpperCase()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link href="/" className="rounded bg-slate-700 px-3 py-1.5">
              Platform Home
            </Link>
            <Link href="/dashboard" className="rounded bg-indigo-600 px-3 py-1.5">
              Owner View
            </Link>
            <button
              onClick={() => apiMutate('/api/v1/auth/logout').then(() => setUser(null))}
              className="rounded bg-red-600 px-3 py-1.5"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          {(['overview', 'stores', 'payments', 'database', 'backups', 'logs'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase ${
                tab === t ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 shadow-sm'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {msg && <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">{msg}</div>}
        {loading && !data && <p className="text-sm text-slate-500">Loading...</p>}

        {data && tab === 'overview' && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">মোট শপ (Stores)</p>
              <p className="text-2xl font-bold">{data.stores.length}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">মোট ইউজার</p>
              <p className="text-2xl font-bold">{data.users.length}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Store Order Revenue (PAID)</p>
              <p className="text-2xl font-bold text-emerald-600">৳ {orderRevenue.toFixed(2)}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">SaaS Subscription Revenue</p>
              <p className="text-2xl font-bold text-indigo-600">৳ {subRevenue.toFixed(2)}</p>
            </div>
          </div>
        )}

        {data && tab === 'stores' && (
          <div className="space-y-6">
            <form onSubmit={handleCreateStore} className="grid gap-2 rounded-xl bg-white p-4 shadow-sm md:grid-cols-4">
              <input
                required
                placeholder="Store Name"
                value={newStore.name}
                onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                className="rounded border px-3 py-2 text-sm"
              />
              <input
                required
                placeholder="slug (e.g. techmart)"
                value={newStore.slug}
                onChange={(e) => setNewStore({ ...newStore, slug: e.target.value })}
                className="rounded border px-3 py-2 text-sm"
              />
              <input
                placeholder="Tagline"
                value={newStore.tagline}
                onChange={(e) => setNewStore({ ...newStore, tagline: e.target.value })}
                className="rounded border px-3 py-2 text-sm"
              />
              <button type="submit" className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
                Admin Create Store
              </button>
            </form>

            <div className="overflow-auto rounded-xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 font-bold">Stores ({data.stores.length})</h2>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">Name</th>
                    <th className="p-2">Slug</th>
                    <th className="p-2">Owner</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stores.map((s: any) => (
                    <tr key={s.id} className="border-b">
                      <td className="p-2 font-medium">{s.name}</td>
                      <td className="p-2">
                        <Link href={`/${s.slug}`} className="text-indigo-600 underline">
                          /{s.slug}/
                        </Link>
                      </td>
                      <td className="p-2">{s.owner_email}</td>
                      <td className="p-2">{s.status}</td>
                      <td className="flex gap-1 p-2">
                        <button
                          onClick={() => handleStoreStatus(s.id, 'ACTIVE')}
                          className="rounded bg-emerald-600 px-2 py-1 text-white"
                        >
                          Activate
                        </button>
                        <button
                          onClick={() => handleStoreStatus(s.id, 'SUSPENDED')}
                          className="rounded bg-amber-600 px-2 py-1 text-white"
                        >
                          Suspend
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-auto rounded-xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 font-bold">Custom Domains ({data.domains.length})</h2>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">Hostname</th>
                    <th className="p-2">Store</th>
                    <th className="p-2">DNS TXT Token</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.domains.map((d: any) => (
                    <tr key={d.id} className="border-b">
                      <td className="p-2 font-medium">{d.hostname}</td>
                      <td className="p-2">{d.store_name}</td>
                      <td className="p-2 font-mono">{d.verification_token}</td>
                      <td className="p-2">{d.status}</td>
                      <td className="flex gap-1 p-2">
                        <button
                          onClick={() => handleVerifyDomain(d.id, 'VERIFIED')}
                          className="rounded bg-emerald-600 px-2 py-1 text-white"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => handleVerifyDomain(d.id, 'FAILED')}
                          className="rounded bg-red-600 px-2 py-1 text-white"
                        >
                          Fail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && tab === 'payments' && (
          <div className="overflow-auto rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-bold">All Payments (Order & Subscription Separated)</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="p-2">Purpose</th>
                  <th className="p-2">Method</th>
                  <th className="p-2">TrxID</th>
                  <th className="p-2">Amount</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Verify</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p: any) => (
                  <tr key={p.id} className="border-b">
                    <td className="p-2 font-bold">{p.purpose}</td>
                    <td className="p-2">{p.method}</td>
                    <td className="p-2 font-mono">{p.trx_id || '-'}</td>
                    <td className="p-2">৳ {p.amount}</td>
                    <td className="p-2">{p.status}</td>
                    <td className="flex gap-1 p-2">
                      {p.status !== 'PAID' && (
                        <>
                          <button
                            onClick={() => handleVerifyPayment(p.id, 'APPROVE')}
                            className="rounded bg-emerald-600 px-2 py-1 text-white"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleVerifyPayment(p.id, 'REJECT')}
                            className="rounded bg-red-600 px-2 py-1 text-white"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && tab === 'database' && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="text-base font-bold">Current Active Database</h2>
              <div className="mt-3 space-y-1 text-xs">
                <p><b>Engine:</b> {data.dbStatus.engine}</p>
                <p><b>Host:</b> {data.dbStatus.host}:{data.dbStatus.port}</p>
                <p><b>Database:</b> {data.dbStatus.database}</p>
                <p><b>User:</b> {data.dbStatus.username} (Password masked)</p>
                <p><b>Status:</b> {data.dbStatus.connected ? '🟢 Connected' : '🔴 Disconnected'}</p>
                <p><b>Version:</b> {data.dbStatus.version || 'N/A'}</p>
                <p><b>Config Source:</b> {data.dbStatus.source}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={handleRunMigrations} className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white">
                  Run Schema Migrations
                </button>
                {data.phpMyAdminUrl && (
                  <a
                    href={data.phpMyAdminUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded bg-amber-600 px-3 py-1.5 text-xs text-white"
                  >
                    Open phpMyAdmin (External)
                  </a>
                )}
              </div>
            </div>

            <form onSubmit={handleSwitchDatabase} className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
              <h2 className="text-base font-bold">Zero-Data-Loss Database Switching (PG ↔ MySQL/MariaDB)</h2>
              <select
                value={dbForm.engine}
                onChange={(e) =>
                  setDbForm({
                    ...dbForm,
                    engine: e.target.value as any,
                    port: e.target.value === 'postgresql' ? 5432 : 3306,
                  })
                }
                className="w-full rounded border px-3 py-2 text-sm"
              >
                <option value="mysql">MySQL (cPanel Compatible)</option>
                <option value="mariadb">MariaDB (cPanel Compatible)</option>
                <option value="postgresql">PostgreSQL</option>
              </select>
              <div className="grid grid-cols-3 gap-2">
                <input
                  required
                  placeholder="Host"
                  value={dbForm.host}
                  onChange={(e) => setDbForm({ ...dbForm, host: e.target.value })}
                  className="col-span-2 rounded border px-3 py-2 text-sm"
                />
                <input
                  required
                  type="number"
                  placeholder="Port"
                  value={dbForm.port}
                  onChange={(e) => setDbForm({ ...dbForm, port: Number(e.target.value) })}
                  className="rounded border px-3 py-2 text-sm"
                />
              </div>
              <input
                required
                placeholder="Target Database Name"
                value={dbForm.database}
                onChange={(e) => setDbForm({ ...dbForm, database: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <input
                required
                placeholder="Username"
                value={dbForm.username}
                onChange={(e) => setDbForm({ ...dbForm, username: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Target DB Password"
                value={dbForm.password}
                onChange={(e) => setDbForm({ ...dbForm, password: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={dbForm.ssl}
                  onChange={(e) => setDbForm({ ...dbForm, ssl: e.target.checked })}
                />{' '}
                Use SSL
              </label>

              <button
                type="button"
                onClick={handleTestDb}
                className="w-full rounded bg-slate-800 py-2 text-xs font-semibold text-white"
              >
                1. Test Target Connection
              </button>
              {dbTestResult && (
                <p
                  className={`rounded p-2 text-xs ${
                    dbTestResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {dbTestResult.ok ? `Connected: ${dbTestResult.version}` : `Error: ${dbTestResult.error}`}
                </p>
              )}

              <input
                required
                type="password"
                placeholder="Super Admin Re-Auth Password (বাধ্যতামূলক)"
                value={dbForm.reauthPassword}
                onChange={(e) => setDbForm({ ...dbForm, reauthPassword: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  required
                  type="checkbox"
                  checked={dbForm.confirmZeroDataLossAck}
                  onChange={(e) => setDbForm({ ...dbForm, confirmZeroDataLossAck: e.target.checked })}
                />
                Confirm Backup + Write-Freeze + Zero-Data-Loss Cutover
              </label>
              <button type="submit" className="w-full rounded bg-red-600 py-2.5 text-sm font-bold text-white">
                2. Execute Safe Database Switch
              </button>

              {switchSteps.length > 0 && (
                <div className="space-y-1 rounded bg-slate-50 p-3 text-xs">
                  {switchSteps.map((st, i) => (
                    <div key={i}>
                      <b>Step {st.step}:</b> {st.name} — [{st.status}] {st.detail}
                    </div>
                  ))}
                </div>
              )}
            </form>
          </div>
        )}

        {data && tab === 'backups' && (
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">Encrypted Backups (AES-256-GCM + SHA-256)</h2>
              <button onClick={handleCreateBackup} className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">
                + Create Backup Now
              </button>
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="p-2">File</th>
                  <th className="p-2">Engine</th>
                  <th className="p-2">Rows</th>
                  <th className="p-2">SHA-256</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.backups.map((b: any) => (
                  <tr key={b.id} className="border-b">
                    <td className="p-2 font-mono">{b.filename}</td>
                    <td className="p-2">{b.engine}</td>
                    <td className="p-2">{b.totalRows}</td>
                    <td className="p-2 font-mono">{b.sha256Checksum.slice(0, 14)}...</td>
                    <td className="flex gap-2 p-2">
                      <a href={`/api/v1/super-admin/backups/${b.filename}`} className="rounded bg-slate-800 px-2 py-1 text-white">
                        Download
                      </a>
                      <button
                        onClick={() => handleRestoreBackup(b.filename)}
                        className="rounded bg-amber-600 px-2 py-1 text-white"
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && tab === 'logs' && (
          <div className="overflow-auto rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-bold">Immutable Audit Logs ({data.auditLogs.length})</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="p-2">Time</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Target</th>
                  <th className="p-2">IP</th>
                  <th className="p-2">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {data.auditLogs.map((l: any) => (
                  <tr key={l.id} className="border-b">
                    <td className="p-2">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="p-2 font-bold">{l.action}</td>
                    <td className="p-2">
                      {l.target_type} ({l.target_id || '-'})
                    </td>
                    <td className="p-2">{l.ip_address}</td>
                    <td className="p-2 font-mono">{l.metadata_json || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
