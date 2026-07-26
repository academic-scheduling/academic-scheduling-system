import React, { useState } from 'react';

export default function CompleteProfile() {
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [maxHours, setMaxHours] = useState('10');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Burası da mock olarak veri kaydetme simülasyonu yapacak
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Profiliniz Güncellendi! 🎉</h2>
          <p style={styles.subtitle}>
            Akademik bilgileriniz başarıyla sisteme kaydedildi. Artık ders programı planlama paneline erişebilirsiniz.
          </p>
          <button 
            onClick={() => alert("Ana panele yönlendiriliyorsunuz (Mock Dashboard)...")} 
            style={styles.button}
          >
            Hadi Başlayalım
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Hesap Tamamlama</h2>
        <p style={styles.subtitle}>Sistemi kullanabilmemiz için lütfen akademik detaylarınızı belirtin.</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Akademik Unvan</label>
            <select value={title} onChange={(e) => setTitle(e.target.value)} required style={styles.input}>
              <option value="">Seçiniz...</option>
              <option value="Prof. Dr.">Prof. Dr.</option>
              <option value="Doç. Dr.">Doç. Dr.</option>
              <option value="Dr. Öğr. Üyesi">Dr. Öğr. Üyesi</option>
              <option value="Arş. Gör.">Arş. Gör.</option>
              <option value="Öğr. Gör.">Öğr. Gör.</option>
            </select>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Bölüm / Departman</label>
            <input 
              type="text" 
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Örn: Bilgisayar Mühendisliği"
              required 
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Haftalık Maksimum Ders Saati</label>
            <input 
              type="number" 
              value={maxHours}
              onChange={(e) => setMaxHours(e.target.value)}
              min="1"
              max="40"
              required 
              style={styles.input}
            />
          </div>

          <button type="submit" style={styles.button}>Bilgileri Kaydet ve Devam Et</button>
        </form>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f3f4f6' },
  card: { padding: '2.5rem', borderRadius: '12px', backgroundColor: '#ffffff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', width: '100%', maxWidth: '450px' },
  title: { textAlign: 'center', color: '#1f2937', marginBottom: '0.5rem', fontSize: '1.5rem', fontWeight: 'bold' },
  subtitle: { textAlign: 'center', color: '#6b7280', marginBottom: '2rem', fontSize: '0.875rem', lineHeight: '1.4' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontSize: '0.875rem', fontWeight: '500', color: '#374151' },
  input: { padding: '0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', outline: 'none', backgroundColor: '#fff' },
  button: { padding: '0.75rem', borderRadius: '6px', backgroundColor: '#10b981', color: '#ffffff', fontSize: '1rem', fontWeight: '600', cursor: 'pointer', border: 'none', marginTop: '0.5rem' }
};