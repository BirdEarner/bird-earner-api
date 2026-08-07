'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'already' | 'expired' | 'invalid' | 'error'>('loading');

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }

    fetch(`/api/auth/verify-email-link?token=${token}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          if (data.message === 'Email already verified') {
            setStatus('already');
          } else {
            setStatus('success');
          }
        } else {
          if (data.message?.includes('expired')) {
            setStatus('expired');
          } else {
            setStatus('invalid');
          }
        }
      })
      .catch(() => {
        setStatus('error');
      });
  }, [token]);

  return (
    <div style={cardStyle}>
      {status === 'loading' && (
        <p style={msgStyle}>Verifying your email...</p>
      )}
      {status === 'success' && (
        <>
          <div style={iconCircle('#16a34a')}>✓</div>
          <h1 style={titleStyle('#16a34a')}>Email Verified!</h1>
          <p style={msgStyle}>Your email has been verified successfully. You can close this page and return to the app.</p>
        </>
      )}
      {status === 'already' && (
        <>
          <div style={iconCircle('#2563eb')}>✓</div>
          <h1 style={titleStyle('#2563eb')}>Already Verified</h1>
          <p style={msgStyle}>Your email is already verified. You can close this page.</p>
        </>
      )}
      {status === 'expired' && (
        <>
          <div style={iconCircle('#dc2626')}>!</div>
          <h1 style={titleStyle('#dc2626')}>Link Expired</h1>
          <p style={msgStyle}>This verification link has expired. Please request a new one from the app.</p>
        </>
      )}
      {status === 'invalid' && (
        <>
          <div style={iconCircle('#dc2626')}>×</div>
          <h1 style={titleStyle('#dc2626')}>Invalid Link</h1>
          <p style={msgStyle}>This verification link is not valid.</p>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={iconCircle('#dc2626')}>!</div>
          <h1 style={titleStyle('#dc2626')}>Something went wrong</h1>
          <p style={msgStyle}>Please try again later.</p>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <html lang="en">
        <body style={bodyStyle}>
          <div style={cardStyle}>
            <p style={msgStyle}>Verifying your email...</p>
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body style={bodyStyle}>
        <VerifyEmailContent />
      </body>
    </html>
  );
}

const bodyStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  backgroundColor: '#f0f2f5',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '100vh',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  borderRadius: 16,
  padding: '48px 40px',
  maxWidth: 440,
  width: '90%',
  textAlign: 'center',
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};

const titleStyle = (color: string): React.CSSProperties => ({
  fontSize: 28,
  fontWeight: 700,
  color,
  marginBottom: 12,
});

const msgStyle: React.CSSProperties = {
  fontSize: 16,
  color: '#555',
  lineHeight: 1.6,
};

const iconCircle = (color: string): React.CSSProperties => ({
  width: 64,
  height: 64,
  borderRadius: '50%',
  backgroundColor: color,
  color: '#fff',
  fontSize: 32,
  fontWeight: 700,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  margin: '0 auto 20px',
});
