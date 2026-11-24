'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Product {
  id: string;
  name: string;
  slug: string;
  price: string;
  compare_at_price?: string | null;
  stock: number;
  description: string;
  images_json: string;
  is_digital: boolean | number;
}

interface StoreData {
  id: string;
  name: string;
  slug: string;
  tagline?: string;
  description?: string;
  theme_config: string;
  homepage_blocks: string;
  contact_email?: string;
  contact_phone?: string;
}

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
      data: { error: `API error (${res.status}). Check if /api/v1/[...path]/route.ts is deployed.` },
    };
  }
}

export default function PlatformOrStorefrontPage() {
  const params = useParams<{ slug?: string[] }>();
  const slugParts = params?.slug || [];

  const storeSlug = slugParts[0];
  const productSlug = slugParts[1];

  const [user, setUser] = useState<{ id: string; name: string; email: string; platform_role: string } | null>(null);
  const [stores, setStores] = useState<Array<{ id: string; name: string; slug: string; tagline?: string }>>([]);

  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [ownerName, setOwnerName] = useState('');
  const [shopName, setShopName] = useState('');
  const [createdShop, setCreatedShop] = useState<{ slug: string; storeUrl: string; adminUrl: string } | null>(null);

  const [analyzeUrl, setAnalyzeUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [aiQuestion, setAiQuestion] = useState('এই Website-এ কী কী Product আছে এবং দাম কত?');
  const [aiAnswer, setAiAnswer] = useState('');

  const [store, setStore] = useState<StoreData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [checkoutForm, setCheckoutForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    shippingAddress: '',
    couponCode: '',
    paymentMethod: 'MANUAL_BKASH' as 'MANUAL_BKASH' | 'OFFICIAL_BKASH' | 'CASH_ON_DELIVERY',
    trxId: '',
    senderNumber: '',
  });
  const [orderResult, setOrderResult] = useState<any>(null);
  const [trackQuery, setTrackQuery] = useState({ orderNumber: '', email: '' });
  const [trackedOrder, setTrackedOrder] = useState<any>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    safeJsonFetch('/api/v1/auth/me').then(({ ok, data }) => {
      if (ok && data.user) {
        setUser(data.user);
        setOwnerName(data.user.name);
      }
    });

    if (!storeSlug) {
      safeJsonFetch('/api/v1/stores/public').then(({ ok, data }) => {
        if (ok) setStores(data.stores || []);
      });
    } else {
      const qs = new URLSearchParams({ slug: storeSlug });
      if (productSlug) qs.set('productSlug', productSlug);
      safeJsonFetch(`/api/v1/stores/public?${qs.toString()}`).then(({ ok, data }) => {
        if (ok && data.store) {
          setStore(data.store);
          setProducts(data.products || []);
          setSelectedProduct(data.selectedProduct || null);
        } else {
          setMsg(data.error || 'Store not found');
        }
      });
    }
  }, [storeSlug, productSlug]);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const endpoint = authMode === 'register' ? '/api/v1/auth/register' : '/api/v1/auth/login';
    const { ok, data } = await safeJsonFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        authMode === 'register'
          ? { name: authName, email: authEmail, password: authPassword }
          : { email: authEmail, password: authPassword }
      ),
    });
    if (!ok) return setMsg(data.error || 'Auth failed');
    setUser(data.user);
    setOwnerName(data.user.name);
    setMsg('✅ লগইন সম্পন্ন হয়েছে! এখন এক ক্লিকেই আপনার শপ তৈরি করুন।');
  }

  async function handleOneClickShop(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const { ok, data } = await safeJsonFetch('/api/v1/stores/one-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
      body: JSON.stringify({
        ownerName: ownerName || user?.name || 'My',
        preferredStoreName: shopName || undefined,
        publishImmediately: true,
      }),
    });
    if (!ok) return setMsg(data.error || 'Shop creation failed');
    setCreatedShop(data);
  }

  async function handleAnalyzeWebsite(e: React.FormEvent) {
    e.preventDefault();
    setAnalyzing(true);
    setMsg('');
    setAiAnswer('');
    try {
      const { ok, data } = await safeJsonFetch('/api/v1/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
        body: JSON.stringify({ url: analyzeUrl }),
      });
      if (!ok) return setMsg(data.error || 'Analysis failed');
      setAnalysisId(data.analysisId);
      setAnalysisData(data.analysis);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleAiChat(e: React.FormEvent) {
    e.preventDefault();
    const { data } = await safeJsonFetch('/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
      body: JSON.stringify({ analysisId: analysisId || undefined, question: aiQuestion, language: 'bn' }),
    });
    setAiAnswer(data.answer || data.error);
  }

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!store || cart.length === 0) return;
    setMsg('');
    const { ok, data } = await safeJsonFetch('/api/v1/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: store.id,
        customerName: checkoutForm.customerName,
        customerEmail: checkoutForm.customerEmail,
        customerPhone: checkoutForm.customerPhone,
        shippingAddress: checkoutForm.shippingAddress,
        couponCode: checkoutForm.couponCode || undefined,
        paymentMethod: checkoutForm.paymentMethod,
        manualBkash:
          checkoutForm.paymentMethod === 'MANUAL_BKASH'
            ? { trxId: checkoutForm.trxId, senderNumber: checkoutForm.senderNumber }
            : undefined,
        items: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
      }),
    });
    if (!ok) return setMsg(data.error || 'Checkout failed');
    setOrderResult(data);
    setCart([]);
  }

  async function handleTrackOrder(e: React.FormEvent) {
    e.preventDefault();
    const qs = new URLSearchParams(trackQuery);
    const { data } = await safeJsonFetch(`/api/v1/orders/track?${qs.toString()}`);
    setTrackedOrder(data.order || { error: data.error });
  }

  if (storeSlug) {
    if (!store) {
      return (
        <div className="mx-auto max-w-2xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-800">{msg || 'লোড হচ্ছে...'}</h1>
          <Link href="/" className="mt-4 inline-block rounded bg-indigo-600 px-4 py-2 text-white">
            হোমপেজে ফিরে যান
          </Link>
        </div>
      );
    }

    const theme = (() => {
      try {
        return JSON.parse(store.theme_config);
      } catch {
        return { primaryColor: '#4f46e5', backgroundColor: '#ffffff', textColor: '#0f172a' };
      }
    })();

    const filtered = products.filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const cartTotal = cart.reduce((sum, i) => sum + Number(i.product.price) * i.quantity, 0);

    return (
      <div style={{ backgroundColor: theme.backgroundColor, color: theme.textColor }} className="min-h-screen">
        <header style={{ backgroundColor: theme.primaryColor }} className="text-white shadow">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div>
              <Link href={`/${store.slug}`} className="text-xl font-bold">
                {store.name}
              </Link>
              <p className="text-xs opacity-90">{store.tagline}</p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Link href="/" className="rounded bg-white/15 px-3 py-1.5 hover:bg-white/25">
                হোম
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-6">
          {msg && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{msg}</div>}

          {selectedProduct ? (
            <section className="grid gap-6 rounded-xl border bg-white p-6 shadow-sm md:grid-cols-2">
              <div className="flex items-center justify-center rounded-lg bg-slate-100 p-6">
                <img
                  src={JSON.parse(selectedProduct.images_json || '[]')[0] || 'https://placehold.co/400x300?text=Product'}
                  alt={selectedProduct.name}
                  className="max-h-80 rounded object-contain"
                />
              </div>
              <div className="space-y-4">
                <Link href={`/${store.slug}`} className="text-sm text-indigo-600 hover:underline">
                  ← সব প্রোডাক্টে ফিরুন
                </Link>
                <h1 className="text-2xl font-bold">{selectedProduct.name}</h1>
                <p className="text-2xl font-extrabold text-indigo-600">৳ {selectedProduct.price}</p>
                <p className="text-sm text-slate-600">
                  স্টক: {selectedProduct.is_digital ? 'ডিজিটাল প্রোডাক্ট (তাৎক্ষণিক ডেলিভারি)' : `${selectedProduct.stock} টি`}
                </p>
                <div className="prose prose-sm text-slate-700" dangerouslySetInnerHTML={{ __html: selectedProduct.description || '' }} />
                <button
                  onClick={() => setCart((prev) => [...prev, { product: selectedProduct, quantity: 1 }])}
                  className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700"
                >
                  কার্টে যোগ করুন (Add to Cart)
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold">পণ্যসমূহ ({filtered.length})</h2>
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="প্রোডাক্ট খুঁজুন..."
                  className="w-full rounded-lg border px-3 py-2 text-sm md:w-72"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {filtered.map((p) => {
                  const imgs = (() => {
                    try {
                      return JSON.parse(p.images_json || '[]');
                    } catch {
                      return [];
                    }
                  })();
                  return (
                    <div key={p.id} className="flex flex-col justify-between rounded-xl border bg-white p-4 shadow-sm">
                      <div>
                        <Link href={`/${store.slug}/${p.slug}`}>
                          <img src={imgs[0] || 'https://placehold.co/300x220?text=Product'} alt={p.name} className="mb-3 h-40 w-full rounded-lg object-cover" />
                          <h3 className="font-semibold text-slate-900 hover:text-indigo-600">{p.name}</h3>
                        </Link>
                        <p className="mt-1 text-lg font-bold text-indigo-600">৳ {p.price}</p>
                      </div>
                      <button
                        onClick={() => setCart((prev) => [...prev, { product: p, quantity: 1 }])}
                        className="mt-3 w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white hover:bg-indigo-600"
                      >
                        Add to Cart
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <section className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-lg font-bold">শপিং কার্ট ও চেকআউট ({cart.length})</h3>
              {cart.length === 0 ? (
                <p className="text-sm text-slate-500">আপনার কার্ট খালি।</p>
              ) : (
                <form onSubmit={handleCheckout} className="space-y-3">
                  <div className="space-y-1 border-b pb-2 text-sm">
                    {cart.map((c, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>{c.product.name} × {c.quantity}</span>
                        <span>৳ {(Number(c.product.price) * c.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1 font-bold">
                      <span>মোট:</span>
                      <span>৳ {cartTotal.toFixed(2)}</span>
                    </div>
                  </div>
                  <input required placeholder="আপনার নাম" value={checkoutForm.customerName} onChange={(e) => setCheckoutForm({ ...checkoutForm, customerName: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <input required type="email" placeholder="ইমেইল" value={checkoutForm.customerEmail} onChange={(e) => setCheckoutForm({ ...checkoutForm, customerEmail: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <input required placeholder="মোবাইল নম্বর" value={checkoutForm.customerPhone} onChange={(e) => setCheckoutForm({ ...checkoutForm, customerPhone: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <textarea required placeholder="ডেলিভারি ঠিকানা" value={checkoutForm.shippingAddress} onChange={(e) => setCheckoutForm({ ...checkoutForm, shippingAddress: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <input placeholder="কুপন কোড (যদি থাকে)" value={checkoutForm.couponCode} onChange={(e) => setCheckoutForm({ ...checkoutForm, couponCode: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <select value={checkoutForm.paymentMethod} onChange={(e) => setCheckoutForm({ ...checkoutForm, paymentMethod: e.target.value as any })} className="w-full rounded border px-3 py-2 text-sm">
                    <option value="MANUAL_BKASH">Manual bKash (Admin Verification)</option>
                    <option value="OFFICIAL_BKASH">Official bKash Merchant API</option>
                    <option value="CASH_ON_DELIVERY">Cash On Delivery</option>
                  </select>
                  {checkoutForm.paymentMethod === 'MANUAL_BKASH' && (
                    <div className="grid grid-cols-2 gap-2">
                      <input required placeholder="bKash TrxID" value={checkoutForm.trxId} onChange={(e) => setCheckoutForm({ ...checkoutForm, trxId: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                      <input required placeholder="প্রেরক নম্বর" value={checkoutForm.senderNumber} onChange={(e) => setCheckoutForm({ ...checkoutForm, senderNumber: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                    </div>
                  )}
                  <button type="submit" className="w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700">
                    অর্ডার কনফার্ম করুন
                  </button>
                </form>
              )}
              {orderResult && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  অর্ডার সফল! Order ID: <b>{orderResult.orderNumber}</b> | Payment Status: <b>{orderResult.paymentStatus}</b>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-lg font-bold">অর্ডার ট্র্যাক করুন</h3>
              <form onSubmit={handleTrackOrder} className="space-y-3">
                <input required placeholder="Order Number (যেমন: ORD-...)" value={trackQuery.orderNumber} onChange={(e) => setTrackQuery({ ...trackQuery, orderNumber: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                <input required type="email" placeholder="কাস্টমার ইমেইল" value={trackQuery.email} onChange={(e) => setTrackQuery({ ...trackQuery, email: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                <button type="submit" className="w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white">
                  স্ট্যাটাস দেখুন
                </button>
              </form>
              {trackedOrder && <pre className="mt-3 overflow-auto rounded bg-slate-100 p-3 text-xs">{JSON.stringify(trackedOrder, null, 2)}</pre>}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-slate-50">
      <nav className="border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-xl font-extrabold text-indigo-700">BongoCommerce SaaS</span>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/dashboard" className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white">
              আমার শপ / ড্যাশবোর্ড
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
        {msg && <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">{msg}</div>}

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-extrabold text-slate-900">এক ক্লিকেই আপনার নিজস্ব অনলাইন শপ তৈরি করুন</h1>
            <p className="mt-2 text-sm text-slate-600">
              আপনার নিজের কোনো Website নেই? চিন্তা নেই! আপনার নাম দিয়ে এক ক্লিকেই নিজের Online Shop তৈরি করুন।
            </p>

            {!user ? (
              <form onSubmit={handleAuth} className="mt-4 space-y-3 border-t pt-4">
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setAuthMode('register')} className={`rounded px-3 py-1 ${authMode === 'register' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>নতুন অ্যাকাউন্ট</button>
                  <button type="button" onClick={() => setAuthMode('login')} className={`rounded px-3 py-1 ${authMode === 'login' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>লগইন</button>
                </div>
                {authMode === 'register' && (
                  <input required minLength={2} placeholder="আপনার নাম (যেমন: Rahim)" value={authName} onChange={(e) => setAuthName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                )}
                <input required type="email" placeholder="ইমেইল" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                <input required minLength={8} type="password" placeholder="পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                <button type="submit" className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white">
                  {authMode === 'register' ? 'রেজিস্টার করে শুরু করুন' : 'লগইন করুন'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleOneClickShop} className="mt-4 space-y-3 border-t pt-4">
                <p className="text-xs text-emerald-700">লগইন করা আছে: <b>{user.name}</b> ({user.email})</p>
                <input required placeholder="আপনার নাম (যেমন: Rahim)" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                <input placeholder="শপের নাম (খালি রাখলে অটো সাজেস্ট হবে)" value={shopName} onChange={(e) => setShopName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                <button type="submit" className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700">
                  CREATE MY SHOP (এক ক্লিকে শপ তৈরি)
                </button>
              </form>
            )}

            {createdShop && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                <p className="font-bold text-emerald-800">🎉 আপনার শপ তৈরি হয়ে গেছে!</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href={createdShop.storeUrl} className="rounded bg-emerald-600 px-3 py-1.5 text-white">
                    শপ দেখুন ({createdShop.storeUrl})
                  </Link>
                  <Link href={createdShop.adminUrl} className="rounded bg-slate-800 px-3 py-1.5 text-white">
                    শপ কাস্টমাইজ করুন
                  </Link>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">AI Website Link Analyzer</h2>
            <p className="mt-1 text-xs text-slate-600">
              যেকোনো পাবলিক ওয়েবসাইটের লিংক দিন—AI যাচাইকৃত প্রোডাক্ট, দাম ও তথ্য বের করে দেখাবে (SSRF সুরক্ষিত)।
            </p>
            <form onSubmit={handleAnalyzeWebsite} className="mt-4 flex gap-2">
              <input required type="url" placeholder="https://example.com" value={analyzeUrl} onChange={(e) => setAnalyzeUrl(e.target.value)} className="flex-1 rounded-lg border px-3 py-2 text-sm" />
              <button disabled={analyzing} type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
                {analyzing ? 'বিশ্লেষণ হচ্ছে...' : 'Analyze'}
              </button>
            </form>

            {analysisData && (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p><b>Website:</b> {analysisData.websiteName || analysisData.title || 'N/A'}</p>
                  <p><b>Accessible:</b> {analysisData.accessible ? 'হ্যাঁ' : `না (${analysisData.blockedReason})`}</p>
                  <p><b>পাওয়া প্রোডাক্ট:</b> {analysisData.products?.length || 0} টি</p>
                </div>
                <form onSubmit={handleAiChat} className="flex gap-2">
                  <input value={aiQuestion} onChange={(e) => setAiQuestion(e.target.value)} className="flex-1 rounded border px-3 py-1.5 text-xs" />
                  <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white">প্রশ্ন করুন</button>
                </form>
                {aiAnswer && <pre className="whitespace-pre-wrap rounded-lg border bg-indigo-50 p-3 text-xs">{aiAnswer}</pre>}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">প্ল্যাটফর্মের সক্রিয় শপসমূহ</h2>
          {stores.length === 0 ? (
            <p className="text-sm text-slate-500">এখনো কোনো পাবলিশড শপ নেই। উপরে ক্লিক করে প্রথম শপ তৈরি করুন!</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {stores.map((s) => (
                <Link key={s.id} href={`/${s.slug}`} className="rounded-xl border p-4 transition hover:border-indigo-500 hover:shadow">
                  <h3 className="font-bold text-slate-900">{s.name}</h3>
                  <p className="text-xs text-slate-500">/{s.slug}/</p>
                  <p className="mt-1 text-xs text-slate-600">{s.tagline}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
