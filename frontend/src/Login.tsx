import React, { useState } from 'react';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // MOCK API SÜRECİ: 1 saniye bekletip başarılı kabul ediyoruz
    setTimeout(() => {
      setLoading(false);
      if (username === 'admin' && password === '1234') {
        // Geçici mock token'ı tarayıcıya yazalım
        localStorage.setItem('token', 'mock-jwt-token-xyz123');
        onLoginSuccess(); // Üst bileşene girişin başarılı olduğunu bildirir
      } else {
        setError('Hatalı kullanıcı adı veya şifre! (Mock için: admin / 1234 kullanın)');
      }
    }, 1000);
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Akademik Planlama Sistemi</h2>
        <p style={styles.subtitle}>Lütfen kullanıcı bilgilerinizle giriş yapın.</p>
        
        {error && <div style={styles.errorBox}>{error}</div>}

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Kullanıcı Adı</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Örn: admin"
              required 
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Şifre</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Örn: 1234"
              required 
              style={styles.input}
            />
          </div>

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f3f4f6' },
  card: { padding: '2.5rem', borderRadius: '12px', backgroundColor: '#ffffff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px' },
  title: { textAlign: 'center', color: '#1f2937', marginBottom: '0.5rem', fontSize: '1.5rem', fontWeight: 'bold' },
  subtitle: { textAlign: 'center', color: '#6b7280', marginBottom: '2rem', fontSize: '0.875rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontSize: '0.875rem', fontWeight: '500', color: '#374151' },
  input: { padding: '0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', outline: 'none' },
  button: { padding: '0.75rem', borderRadius: '6px', backgroundColor: '#2563eb', color: '#ffffff', fontSize: '1rem', fontWeight: '600', cursor: 'pointer', border: 'none', marginTop: '0.5rem' },
  errorBox: { padding: '0.75rem', borderRadius: '6px', backgroundColor: '#fee2e2', color: '#dc2626', fontSize: '0.875rem', marginBottom: '1rem', textAlign: 'center' }
};