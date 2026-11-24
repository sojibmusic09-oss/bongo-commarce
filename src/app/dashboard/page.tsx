'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)bongo_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export default function UserDashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });

  const [stores, setStores] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [manageData, setManageData] = useState<any>(null);
  const [tab, setTab] = useState<'products' | 'orders' | 'builder' | 'marketing' | 'domains' | 'subscription' | 'ai'>('products');
  const [msg, setMsg] = useState('');

  // Quick One-Click Shop
  const [newShopName, setNewShopName] = useState('');

  // Product Form
  const [prodForm, setProdForm] = useState({
    name: '',
    price: '',
    stock: '10',
    description: '',
    imageUrl: '',
    isDigital: false,
    categoryId: '',
  });

  // Category & Coupon Forms
  const [catName, setCatName] = useState('');
  const [couponForm, setCouponForm] = useState({ code: '', discountType: 'PERCENT', discountValue: '10' });
  const [domainHostname, setDomainHostname] = useState('');
  const [subForm, setSubForm] = useState({ planCode: 'BASIC', trxId: '', senderNumber: '' });

  // Builder States
  const [builder, setBuilder] = useState({
    name: '',
    tagline: '',
    primaryColor: '#4f46e5',
    backgroundColor: '#ffffff',
    textColor: '#0f172a',
    footerText: 'Powered by BongoCommerce SaaS',
    isPublished: true,
    previewMode: 'desktop' as 'desktop' | 'mobile',
  });

  // AI Assistant
  const [aiQ, setAiQ] = useState('আমার দোকানে কী কী প্রোডাক্ট আছে?');
  const [aiAns, setAiAns] = useState('');

  async function apiMutate(url: string, method = 'POST', body: unknown = {}) {
    setMsg('');
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Action failed');
    return json;
  }

  async function loadMyStores() {
    const meRes = await fetch('/api/v1/auth/me');
    const me = await meRes.json();
    setUser(me.user || null);
    if (!me.user) return;

    const res = await fetch('/api/v1/my/stores');
    if (res.ok) {
      const data = await res.json();
      setStores(data.stores || []);
      setPlans(data.plans || []);
      setInvoices(data.invoices || []);
      if (data.stores?.length > 0 && !selectedStoreId) {
        setSelectedStoreId(data.stores[0].id);
      }
    }
  }

  async function loadStoreManage(storeId: string) {
    if (!storeId) return;
    const res = await fetch(`/api/v1/stores/${storeId}/manage`);
    if (res.ok) {
      const d = await res.json();
      setManageData(d);
      if (d.store) {
        const t = (() => {
          try {
            return JSON.parse(d.store.theme_config);
          } catch {
            return {};
          }
        })();
        setBuilder((prev) => ({
          ...prev,
          name: d.store.name || '',
          tagline: d.store.tagline || '',
          primaryColor: t.primaryColor || '#4f46e5',
          backgroundColor: t.backgroundColor || '#ffffff',
          textColor: t.textColor || '#0f172a',
          footerText: t.footerText || 'Powered by BongoCommerce SaaS',
          isPublished: Boolean(d.store.is_published),
        }));
      }
    }
  }

  useEffect(() => {
    loadMyStores();
  }, []);

  useEffect(() => {
    if (selectedStoreId) loadStoreManage(selectedStoreId);
  }, [selectedStoreId]);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    try {
      const endpoint = authMode === 'register' ? '/api/v1/auth/register' : '/api/v1/auth/login';
      await apiMutate(endpoint, 'POST', authForm);
      await loadMyStores();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleOneClickCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const created = await apiMutate('/api/v1/stores/one-click', 'POST', {
        ownerName: user.name,
        preferredStoreName: newShopName || undefined,
        publishImmediately: true,
      });
      setNewShopName('');
      setMsg(`✅ নতুন শপ তৈরি হয়েছে: ${created.storeUrl}`);
      await loadMyStores();
      setSelectedStoreId(created.storeId);
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiMutate(`/api/v1/stores/${selectedStoreId}/products`, 'POST', {
        name: prodForm.name,
        price: Number(prodForm.price),
        stock: Number(prodForm.stock),
        description: prodForm.description,
        isDigital: prodForm.isDigital,
        categoryId: prodForm.categoryId || null,
        images: prodForm.imageUrl ? [prodForm.imageUrl] : [],
        isActive: true,
        createGlobalShortUrl: true,
      });
      setProdForm({ name: '', price: '', stock: '10', description: '', imageUrl: '', isDigital: false, categoryId: '' });
      setMsg('✅ প্রোডাক্ট যোগ করা হয়েছে!');
      await loadStoreManage(selectedStoreId);
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function handleSaveBuilder(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiMutate(`/api/v1/stores/${selectedStoreId}/builder`, 'POST', {
        name: builder.name,
        tagline: builder.tagline,
        isPublished: builder.isPublished,
        theme: {
          primaryColor: builder.primaryColor,
          secondaryColor: '#0f172a',
          backgroundColor: builder.backgroundColor,
          textColor: builder.textColor,
          fontFamily: 'noto-bengali',
          headerStyle: 'classic',
          footerText: builder.footerText,
          showSearch: true,
          showCategories: true,
        },
      });
      setMsg('✅ শপ ডিজাইন সেভ হয়েছে!');
      await loadStoreManage(selectedStoreId);
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  if (!user) {
    return (
      <div className="mx-auto mt-14 max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Store Owner Panel</h1>
        <div className="mt-3 flex gap-2 text-xs">
          <button onClick={() => setAuthMode('login')} className={`rounded px-3 py-1 ${authMode === 'login' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>লগইন</button>
          <button onClick={() => setAuthMode('register')} className={`rounded px-3 py-1 ${authMode === 'register' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>রেজিস্টার</button>
        </div>
        {msg && <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{msg}</p>}
        <form onSubmit={handleAuth} className="mt-4 space-y-3">
          {authMode === 'register' && (
            <input required placeholder="আপনার নাম" value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" />
          )}
          <input required type="email" placeholder="ইমেইল" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input required type="password" placeholder="পাসওয়ার্ড" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button type="submit" className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white">
            {authMode === 'login' ? 'লগইন করুন' : 'অ্যাকাউন্ট তৈরি করুন'}
          </button>
        </form>
        <Link href="/" className="mt-4 block text-center text-xs text-slate-500 underline">← হোমপেজ</Link>
      </div>
    );
  }

  const activeStore = manageData?.store;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-indigo-700">Owner Dashboard</h1>
            <p className="text-xs text-slate-500">{user.name} ({user.email})</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href="/" className="rounded bg-slate-100 px-3 py-1.5">Platform Home</Link>
            {activeStore && (
              <Link href={`/${activeStore.slug}`} target="_blank" className="rounded bg-emerald-600 px-3 py-1.5 text-white">
                View Live Shop (/{activeStore.slug}/)
              </Link>
            )}
            <button onClick={() => apiMutate('/api/v1/auth/logout').then(() => setUser(null))} className="rounded bg-red-600 px-3 py-1.5 text-white">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        {msg && <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">{msg}</div>}

        {/* STORE SWITCHER & ONE-CLICK CREATE */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">আমার শপ:</span>
            <select value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)} className="rounded-lg border px-3 py-1.5 text-sm">
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} (/{s.slug}/)</option>
              ))}
            </select>
          </div>
          <form onSubmit={handleOneClickCreate} className="flex gap-2">
            <input placeholder="নতুন শপের নাম (Optional)" value={newShopName} onChange={(e) => setNewShopName(e.target.value)} className="rounded-lg border px-3 py-1.5 text-xs" />
            <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">
              + One-Click Create Shop
            </button>
          </form>
        </div>

        {selectedStoreId && manageData && (
          <>
            <div className="flex flex-wrap gap-2">
              {(['products', 'orders', 'builder', 'marketing', 'domains', 'subscription', 'ai'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold uppercase ${
                    tab === t ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'products' && (
              <div className="grid gap-6 md:grid-cols-3">
                <form onSubmit={handleAddProduct} className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
                  <h2 className="font-bold">নতুন প্রোডাক্ট যোগ করুন</h2>
                  <input required placeholder="প্রোডাক্টের নাম" value={prodForm.name} onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <input required type="number" step="0.01" placeholder="দাম (BDT)" value={prodForm.price} onChange={(e) => setProdForm({ ...prodForm, price: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                    <input required type="number" placeholder="স্টক" value={prodForm.stock} onChange={(e) => setProdForm({ ...prodForm, stock: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                  </div>
                  <select value={prodForm.categoryId} onChange={(e) => setProdForm({ ...prodForm, categoryId: e.target.value })} className="w-full rounded border px-3 py-2 text-sm">
                    <option value="">ক্যাটাগরি নির্বাচন (ঐচ্ছিক)</option>
                    {manageData.categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input placeholder="ছবির লিংক (https://...)" value={prodForm.imageUrl} onChange={(e) => setProdForm({ ...prodForm, imageUrl: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <textarea placeholder="বিবরণ" value={prodForm.description} onChange={(e) => setProdForm({ ...prodForm, description: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={prodForm.isDigital} onChange={(e) => setProdForm({ ...prodForm, isDigital: e.target.checked })} /> Digital Product
                  </label>
                  <button type="submit" className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white">Save Product</button>
                </form>

                <div className="overflow-auto rounded-xl border bg-white p-4 shadow-sm md:col-span-2">
                  <h2 className="mb-3 font-bold">Products ({manageData.products.length})</h2>
                  <table className="w-full text-left text-xs">
                    <thead><tr className="border-b"><th className="p-2">Name</th><th className="p-2">URL</th><th className="p-2">Price</th><th className="p-2">Stock</th><th className="p-2">Action</th></tr></thead>
                    <tbody>
                      {manageData.products.map((p: any) => (
                        <tr key={p.id} className="border-b">
                          <td className="p-2 font-medium">{p.name}</td>
                          <td className="p-2"><Link href={`/${activeStore.slug}/${p.slug}`} className="text-indigo-600 underline">/{activeStore.slug}/{p.slug}</Link></td>
                          <td className="p-2">৳ {p.price}</td>
                          <td className="p-2">{p.stock}</td>
                          <td className="p-2">
                            <button onClick={() => apiMutate(`/api/v1/stores/${selectedStoreId}/products/${p.id}`, 'DELETE').then(() => loadStoreManage(selectedStoreId))} className="rounded bg-red-600 px-2 py-1 text-white">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'orders' && (
              <div className="space-y-6">
                <div className="overflow-auto rounded-xl border bg-white p-4 shadow-sm">
                  <h2 className="mb-3 font-bold">Orders ({manageData.orders.length})</h2>
                  <table className="w-full text-left text-xs">
                    <thead><tr className="border-b"><th className="p-2">Order #</th><th className="p-2">Customer</th><th className="p-2">Total</th><th className="p-2">Pay Status</th><th className="p-2">Order Status</th></tr></thead>
                    <tbody>
                      {manageData.orders.map((o: any) => (
                        <tr key={o.id} className="border-b">
                          <td className="p-2 font-mono">{o.order_number}</td>
                          <td className="p-2">{o.customer_name} ({o.customer_phone})</td>
                          <td className="p-2">৳ {o.total_amount}</td>
                          <td className="p-2">{o.payment_status}</td>
                          <td className="p-2">
                            <select value={o.status} onChange={(e) => apiMutate(`/api/v1/stores/${selectedStoreId}/orders/${o.id}`, 'PATCH', { status: e.target.value }).then(() => loadStoreManage(selectedStoreId))} className="rounded border px-2 py-1">
                              {['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'].map((st) => <option key={st} value={st}>{st}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="overflow-auto rounded-xl border bg-white p-4 shadow-sm">
                  <h2 className="mb-3 font-bold">Store Order Payments (Manual bKash Verify)</h2>
                  <table className="w-full text-left text-xs">
                    <thead><tr className="border-b"><th className="p-2">Method</th><th className="p-2">TrxID</th><th className="p-2">Sender</th><th className="p-2">Amount</th><th className="p-2">Status</th><th className="p-2">Verify</th></tr></thead>
                    <tbody>
                      {manageData.payments.filter((p: any) => p.purpose === 'STORE_ORDER').map((p: any) => (
                        <tr key={p.id} className="border-b">
                          <td className="p-2">{p.method}</td>
                          <td className="p-2 font-mono">{p.trx_id || '-'}</td>
                          <td className="p-2">{p.sender_number || '-'}</td>
                          <td className="p-2">৳ {p.amount}</td>
                          <td className="p-2">{p.status}</td>
                          <td className="flex gap-1 p-2">
                            {p.status !== 'PAID' && (
                              <>
                                <button onClick={() => apiMutate(`/api/v1/payments/${p.id}/verify`, 'POST', { decision: 'APPROVE' }).then(() => loadStoreManage(selectedStoreId))} className="rounded bg-emerald-600 px-2 py-1 text-white">Approve</button>
                                <button onClick={() => apiMutate(`/api/v1/payments/${p.id}/verify`, 'POST', { decision: 'REJECT' }).then(() => loadStoreManage(selectedStoreId))} className="rounded bg-red-600 px-2 py-1 text-white">Reject</button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'builder' && (
              <div className="grid gap-6 md:grid-cols-2">
                <form onSubmit={handleSaveBuilder} className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
                  <h2 className="font-bold">Shop Website Builder</h2>
                  <input required placeholder="Shop Name" value={builder.name} onChange={(e) => setBuilder({ ...builder, name: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <input placeholder="Tagline" value={builder.tagline} onChange={(e) => setBuilder({ ...builder, tagline: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <label>Primary <input type="color" value={builder.primaryColor} onChange={(e) => setBuilder({ ...builder, primaryColor: e.target.value })} className="block h-9 w-full" /></label>
                    <label>Background <input type="color" value={builder.backgroundColor} onChange={(e) => setBuilder({ ...builder, backgroundColor: e.target.value })} className="block h-9 w-full" /></label>
                    <label>Text <input type="color" value={builder.textColor} onChange={(e) => setBuilder({ ...builder, textColor: e.target.value })} className="block h-9 w-full" /></label>
                  </div>
                  <input placeholder="Footer Text" value={builder.footerText} onChange={(e) => setBuilder({ ...builder, footerText: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={builder.isPublished} onChange={(e) => setBuilder({ ...builder, isPublished: e.target.checked })} /> Publish Shop Publicly
                  </label>
                  <button type="submit" className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white">Save Design</button>
                </form>

                <div className="rounded-xl border bg-white p-5 shadow-sm">
                  <div className="mb-3 flex justify-between">
                    <h3 className="font-bold">Live Preview</h3>
                    <div className="flex gap-1 text-xs">
                      <button onClick={() => setBuilder({ ...builder, previewMode: 'desktop' })} className="rounded border px-2 py-1">Desktop</button>
                      <button onClick={() => setBuilder({ ...builder, previewMode: 'mobile' })} className="rounded border px-2 py-1">Mobile</button>
                    </div>
                  </div>
                  <div
                    style={{ backgroundColor: builder.backgroundColor, color: builder.textColor }}
                    className={`mx-auto overflow-hidden rounded-lg border ${builder.previewMode === 'mobile' ? 'max-w-xs' : 'w-full'}`}
                  >
                    <div style={{ backgroundColor: builder.primaryColor }} className="p-4 text-white">
                      <p className="font-bold">{builder.name}</p>
                      <p className="text-xs opacity-85">{builder.tagline}</p>
                    </div>
                    <div className="p-4 text-xs">Sample Product Grid ({manageData.products.length} items)</div>
                    <div className="border-t p-2 text-center text-[11px] opacity-75">{builder.footerText}</div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'marketing' && (
              <div className="grid gap-6 md:grid-cols-2">
                <form onSubmit={(e) => { e.preventDefault(); apiMutate(`/api/v1/stores/${selectedStoreId}/categories`, 'POST', { name: catName }).then(() => { setCatName(''); loadStoreManage(selectedStoreId); }); }} className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
                  <h2 className="font-bold">ক্যাটাগরি তৈরি</h2>
                  <input required placeholder="ক্যাটাগরির নাম" value={catName} onChange={(e) => setCatName(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
                  <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-xs text-white">Add Category</button>
                  <ul className="space-y-1 text-xs">{manageData.categories.map((c: any) => <li key={c.id}>• {c.name} (/{c.slug})</li>)}</ul>
                </form>

                <form onSubmit={(e) => { e.preventDefault(); apiMutate(`/api/v1/stores/${selectedStoreId}/coupons`, 'POST', { code: couponForm.code, discountType: couponForm.discountType, discountValue: Number(couponForm.discountValue) }).then(() => { setCouponForm({ code: '', discountType: 'PERCENT', discountValue: '10' }); loadStoreManage(selectedStoreId); }); }} className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
                  <h2 className="font-bold">কুপন তৈরি</h2>
                  <input required placeholder="Code (e.g. EID10)" value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={couponForm.discountType} onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value })} className="rounded border px-3 py-2 text-sm">
                      <option value="PERCENT">PERCENT (%)</option>
                      <option value="FIXED">FIXED (BDT)</option>
                    </select>
                    <input required type="number" value={couponForm.discountValue} onChange={(e) => setCouponForm({ ...couponForm, discountValue: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                  </div>
                  <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-xs text-white">Create Coupon</button>
                  <ul className="space-y-1 text-xs">{manageData.coupons.map((c: any) => <li key={c.id}>• <b>{c.code}</b> ({c.discount_value} {c.discount_type})</li>)}</ul>
                </form>
              </div>
            )}

            {tab === 'domains' && (
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <h2 className="mb-3 font-bold">Custom Domain Mapping</h2>
                <form onSubmit={(e) => { e.preventDefault(); apiMutate(`/api/v1/stores/${selectedStoreId}/domains`, 'POST', { hostname: domainHostname }).then(() => { setDomainHostname(''); loadStoreManage(selectedStoreId); }).catch((err) => setMsg(err.message)); }} className="mb-4 flex gap-2">
                  <input required placeholder="shop.yourdomain.com" value={domainHostname} onChange={(e) => setDomainHostname(e.target.value)} className="flex-1 rounded border px-3 py-2 text-sm" />
                  <button type="submit" className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">Add Domain</button>
                </form>
                <div className="space-y-2 text-xs">
                  {manageData.domains.map((d: any) => (
                    <div key={d.id} className="rounded border p-3">
                      <b>{d.hostname}</b> — Status: {d.status} | TXT Verification: <code>{d.verification_token}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'subscription' && (
              <div className="grid gap-6 md:grid-cols-2">
                <form onSubmit={(e) => { e.preventDefault(); apiMutate('/api/v1/subscriptions/upgrade', 'POST', { storeId: selectedStoreId, ...subForm }).then((r) => { setMsg(`Invoice ${r.invoiceNumber} created! Awaiting Super Admin bKash verification.`); loadMyStores(); }).catch((err) => setMsg(err.message)); }} className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
                  <h2 className="font-bold">Upgrade Subscription Plan (Manual bKash)</h2>
                  <select value={subForm.planCode} onChange={(e) => setSubForm({ ...subForm, planCode: e.target.value })} className="w-full rounded border px-3 py-2 text-sm">
                    {plans.map((p) => <option key={p.id} value={p.code}>{p.name} — ৳ {p.price_monthly}/month</option>)}
                  </select>
                  <input required placeholder="bKash TrxID" value={subForm.trxId} onChange={(e) => setSubForm({ ...subForm, trxId: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <input required placeholder="Sender bKash Number" value={subForm.senderNumber} onChange={(e) => setSubForm({ ...subForm, senderNumber: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <button type="submit" className="w-full rounded bg-indigo-600 py-2 text-sm font-semibold text-white">Submit Subscription Payment</button>
                </form>

                <div className="rounded-xl border bg-white p-5 shadow-sm">
                  <h3 className="mb-2 font-bold">Invoice History</h3>
                  <ul className="space-y-2 text-xs">
                    {invoices.map((inv) => (
                      <li key={inv.id} className="rounded border p-2">
                        <b>{inv.invoice_number}</b> — ৳ {inv.amount} — Status: <b>{inv.status}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {tab === 'ai' && (
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <h2 className="mb-2 font-bold">AI Shop Assistant (Grounded in Your Store DB)</h2>
                <form onSubmit={(e) => { e.preventDefault(); apiMutate('/api/v1/ai/chat', 'POST', { storeId: selectedStoreId, question: aiQ, language: 'bn' }).then((r) => setAiAns(r.answer)); }} className="flex gap-2">
                  <input value={aiQ} onChange={(e) => setAiQ(e.target.value)} className="flex-1 rounded border px-3 py-2 text-sm" />
                  <button type="submit" className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">জিজ্ঞেস করুন</button>
                </form>
                {aiAns && <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs">{aiAns}</pre>}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
