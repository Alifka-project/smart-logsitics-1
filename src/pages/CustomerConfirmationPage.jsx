import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Calendar, Package, MapPin, Phone, Loader, ChevronRight, ArrowRight } from 'lucide-react';

// ── Animations / shared CSS ──────────────────────────────────────────────────
const STYLES = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.6); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes checkDraw {
    from { stroke-dashoffset: 100; }
    to   { stroke-dashoffset: 0; }
  }
  @keyframes shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position:  400px 0; }
  }
  @keyframes ripplePulse {
    0%   { box-shadow: 0 0 0 0   rgba(0,80,130,0.3); }
    70%  { box-shadow: 0 0 0 16px rgba(0,80,130,0); }
    100% { box-shadow: 0 0 0 0   rgba(0,80,130,0); }
  }

  .anim-card { animation: fadeUp 0.45s ease both; }
  .anim-c1 { animation-delay: 0.05s; }
  .anim-c2 { animation-delay: 0.12s; }
  .anim-c3 { animation-delay: 0.19s; }
  .anim-c4 { animation-delay: 0.26s; }
  .anim-icon { animation: scaleIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both; animation-delay: 0.1s; }

  .card {
    background: #fff;
    border-radius: 20px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.06);
    border: 1px solid #f1f5f9;
  }

  .date-pill {
    display: flex; align-items: center;
    padding: 12px 14px; border-radius: 14px;
    border: 2px solid #e2e8f0; background: #fff;
    cursor: pointer; transition: all 0.2s ease;
    gap: 10px;
  }
  .date-pill:hover { border-color: #0056a3; background: #F0F7FF; }
  .date-pill.selected {
    border-color: #003057;
    background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
  }

  .btn-confirm {
    width: 100%; padding: 15px 24px; border-radius: 14px; border: none;
    font-size: 15px; font-weight: 700; color: #fff; cursor: pointer;
    background: linear-gradient(135deg, #003057 0%, #0056a3 100%);
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: all 0.25s ease;
    box-shadow: 0 4px 16px rgba(0,48,87,0.3);
  }
  .btn-confirm:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,48,87,0.4);
    background: linear-gradient(135deg, #00213d 0%, #003a6e 100%);
    animation: ripplePulse 1.2s ease;
  }
  .btn-confirm:active:not(:disabled) { transform: translateY(0); }
  .btn-confirm:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }

  .btn-track {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 10px 20px; border-radius: 50px; border: 2px solid #003057;
    color: #003057; background: #fff; font-weight: 700; font-size: 13px;
    cursor: pointer; transition: all 0.2s ease; text-decoration: none;
  }
  .btn-track:hover { background: #003057; color: #fff; }

  .shimmer-line {
    background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
    background-size: 400px 100%;
    animation: shimmer 1.2s infinite linear;
    border-radius: 8px;
  }
`;

export default function CustomerConfirmationPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [delivery, setDelivery] = useState(null);
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isAlreadyConfirmed, setIsAlreadyConfirmed] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => { fetchDeliveryDetails(); }, [token]);

  const fetchDeliveryDetails = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/customer/confirm-delivery/${token}`);
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error || 'Failed to load delivery details'); return; }
      setDelivery(data.delivery);
      setAvailableDates(data.availableDates || []);
      setIsAlreadyConfirmed(data.isAlreadyConfirmed || false);
      if (data.availableDates?.length > 0) setSelectedDate(data.availableDates[0]);
    } catch (err) {
      setError(err.message || 'Failed to fetch delivery details');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelivery = async (e) => {
    e.preventDefault();
    if (!selectedDate) { setError('Please select a delivery date'); return; }
    try {
      setConfirming(true);
      setError('');
      const res = await fetch(`/api/customer/confirm-delivery/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryDate: selectedDate })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error || 'Failed to confirm delivery'); return; }
      setSuccess(true);
      setDelivery(data.delivery);
      setTimeout(() => navigate(`/customer-tracking/${token}`), 3500);
    } catch (err) {
      setError(err.message || 'Failed to confirm delivery');
    } finally {
      setConfirming(false);
    }
  };

  const formatDateShort = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return {
      day:   d.toLocaleDateString('en-AE', { weekday: 'short' }),
      date:  d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' }),
      full:  d.toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    };
  };

  const items = delivery?.items
    ? (Array.isArray(delivery.items) ? delivery.items : [delivery.items])
    : [];

  // ── Loading skeleton ─────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
      <style>{STYLES}</style>
      <div style={{ background: 'linear-gradient(135deg,#003057,#005082)', padding: '24px 16px 40px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="shimmer-line" style={{ width: 120, height: 30, marginBottom: 12, opacity: 0.4 }} />
          <div className="shimmer-line" style={{ width: 200, height: 22, opacity: 0.3 }} />
        </div>
      </div>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '20px 16px' }}>
        {[1,2,3].map(i => (
          <div key={i} className="card" style={{ padding: 20, marginBottom: 12 }}>
            <div className="shimmer-line" style={{ height: 14, width: '50%', marginBottom: 10 }} />
            <div className="shimmer-line" style={{ height: 12, width: '80%', marginBottom: 8 }} />
            <div className="shimmer-line" style={{ height: 12, width: '60%' }} />
          </div>
        ))}
      </div>
    </div>
  );

  // ── Error state ──────────────────────────────────────────────────
  if (error && !delivery) return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <style>{STYLES}</style>
      <div className="card" style={{ maxWidth: 400, width: '100%', padding: 32, textAlign: 'center' }}>
        <div className="anim-icon" style={{ width: 64, height: 64, borderRadius: '50%', background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <AlertCircle style={{ width: 30, height: 30, color: '#EF4444' }} />
        </div>
        <h2 style={{ fontWeight: 800, fontSize: 18, color: '#1e293b', marginBottom: 8 }}>Link Unavailable</h2>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>{error}</p>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Call us:{' '}
          <a href="tel:+971524408687" style={{ color: '#003057', fontWeight: 700 }}>+971 52 440 8687</a>
        </p>
      </div>
    </div>
  );

  // ── Success state ────────────────────────────────────────────────
  if (success) return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <style>{STYLES}</style>
      <div className="card" style={{ maxWidth: 400, width: '100%', padding: 36, textAlign: 'center' }}>
        <div className="anim-icon" style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg,#DCFCE7,#BBF7D0)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', boxShadow: '0 0 0 10px rgba(34,197,94,0.1)' }}>
          <CheckCircle style={{ width: 36, height: 36, color: '#16A34A' }} />
        </div>
        <h2 style={{ fontWeight: 800, fontSize: 22, color: '#1e293b', marginBottom: 8 }}>Delivery Confirmed!</h2>
        <p style={{ fontSize: 15, color: '#16A34A', fontWeight: 600, marginBottom: 8 }}>
          {formatDateShort(selectedDate).full}
        </p>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
          Thank you. Redirecting you to real-time tracking…
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
          <Loader style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
          Redirecting…
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
      <style>{STYLES}</style>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)', padding: '24px 16px 40px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <img src="/elect home.png" alt="Electrolux" style={{ height: 34, filter: 'brightness(0) invert(1)', marginBottom: 14 }} />
          <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 800, marginBottom: 6 }}>Delivery Confirmation</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
            {isAlreadyConfirmed ? 'Your delivery is already confirmed' : 'Select your preferred delivery date below'}
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 16px 32px', marginTop: -18 }}>

        {/* ── Error Banner ──────────────────────────────────────── */}
        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 14, padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle style={{ width: 18, height: 18, color: '#EF4444', flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: '#DC2626' }}>{error}</p>
          </div>
        )}

        {delivery && (
          <>
            {/* ── Order Details Card ─────────────────────────────── */}
            <div className="card anim-card anim-c1" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
                <h2 style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>Order Details</h2>
              </div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {(delivery.poNumber || delivery.id) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Package style={{ width: 16, height: 16, color: '#003057' }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Order Reference</p>
                      {delivery.poNumber && (
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>PO: {delivery.poNumber}</p>
                      )}
                      {delivery.id && (
                        <p style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>Delivery No: #{String(delivery.id).slice(0, 8)}</p>
                      )}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                    <MapPin style={{ width: 16, height: 16, color: '#003057' }} />
                  </div>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Address</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginTop: 2 }}>{delivery.address}</p>
                  </div>
                </div>
                {delivery.phone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Phone style={{ width: 16, height: 16, color: '#003057' }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone</p>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{delivery.phone}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Items Card ────────────────────────────────────── */}
            {items.length > 0 && (
              <div className="card anim-card anim-c2" style={{ marginBottom: 12, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Package style={{ width: 15, height: 15, color: '#64748b' }} />
                  <h2 style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>Items</h2>
                  <span style={{ marginLeft: 'auto', background: '#F1F5F9', color: '#64748b', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 50 }}>
                    {items.length}
                  </span>
                </div>
                <div style={{ padding: '8px 18px 12px' }}>
                  {items.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: idx < items.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#003057', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>
                        {typeof item === 'string' ? item : (item.name || item.description || item.sku || 'Item')}
                      </span>
                      {typeof item === 'object' && item.quantity && (
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>×{item.quantity}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Already Confirmed ─────────────────────────────── */}
            {isAlreadyConfirmed ? (
              <div className="card anim-card anim-c3" style={{ padding: 20, border: '1.5px solid #DCFCE7', background: 'linear-gradient(135deg,#F0FDF4,#DCFCE7)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div className="anim-icon" style={{ width: 44, height: 44, borderRadius: '50%', background: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <CheckCircle style={{ width: 22, height: 22, color: '#fff' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 800, fontSize: 16, color: '#15803D' }}>Delivery Already Confirmed</p>
                    {delivery.confirmedDate && (
                      <p style={{ fontSize: 13, color: '#16A34A', marginTop: 4 }}>
                        Scheduled for{' '}
                        <strong>{new Date(delivery.confirmedDate).toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                      </p>
                    )}
                    <button
                      onClick={() => navigate(`/customer-tracking/${token}`)}
                      className="btn-track"
                      style={{ marginTop: 14 }}
                    >
                      View Tracking <ChevronRight style={{ width: 15, height: 15 }} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Date Selection Form ────────────────────────── */
              <div className="card anim-card anim-c3" style={{ overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Calendar style={{ width: 15, height: 15, color: '#64748b' }} />
                  <h2 style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>Select Delivery Date</h2>
                </div>
                <form onSubmit={handleConfirmDelivery} style={{ padding: 18 }}>
                  {/* Date pills – 2 columns */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                    {availableDates.map((date) => {
                      const { day, date: dateLabel } = formatDateShort(date);
                      const isSelected = selectedDate === date;
                      return (
                        <label key={date} className={`date-pill${isSelected ? ' selected' : ''}`} onClick={() => setSelectedDate(date)}>
                          <input type="radio" name="delivery-date" value={date} checked={isSelected} onChange={() => setSelectedDate(date)} style={{ display: 'none' }} />
                          <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${isSelected ? '#003057' : '#cbd5e1'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {isSelected && <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#003057' }} />}
                          </div>
                          <div>
                            <p style={{ fontSize: 11, fontWeight: 700, color: isSelected ? '#003057' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{day}</p>
                            <p style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#003057' : '#374151' }}>{dateLabel}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {/* Selected date display */}
                  {selectedDate && (
                    <div style={{ padding: '10px 14px', background: '#EFF6FF', borderRadius: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Calendar style={{ width: 15, height: 15, color: '#003057', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#003057' }}>
                        {formatDateShort(selectedDate).full}
                      </span>
                    </div>
                  )}

                  {/* Agreement checkbox */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: '#F8FAFC', borderRadius: 12, marginBottom: 16, cursor: 'pointer' }}>
                    <div
                      onClick={() => setAgreed(v => !v)}
                      style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${agreed ? '#003057' : '#cbd5e1'}`, background: agreed ? '#003057' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, transition: 'all 0.2s ease', cursor: 'pointer' }}
                    >
                      {agreed && (
                        <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                          <path d="M1 4.5L4 7.5L10 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                      I confirm this order and agree to the selected delivery date.
                    </span>
                  </label>

                  {/* Submit button */}
                  <button
                    type="submit"
                    className="btn-confirm"
                    disabled={confirming || !selectedDate || !agreed}
                  >
                    {confirming ? (
                      <><Loader style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} /> Confirming…</>
                    ) : (
                      <>Confirm Delivery <ArrowRight style={{ width: 18, height: 18 }} /></>
                    )}
                  </button>
                </form>
              </div>
            )}
          </>
        )}

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', paddingTop: 16, paddingBottom: 8 }}>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            Need help?{' '}
            <a href="tel:+971524408687" style={{ color: '#003057', fontWeight: 700, textDecoration: 'none' }}>+971 52 440 8687</a>
            {' '}· Electrolux Delivery Team
          </p>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>electrolux-smart-portal.vercel.app</p>
        </div>
      </div>
    </div>
  );
}
