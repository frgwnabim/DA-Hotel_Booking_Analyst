# DA-Hotel_Booking_Analyst

Analisis dan prediksi pembatalan booking hotel (`is_canceled`) dengan alur CRISP-DM.

| File / Folder | Isi |
|---|---|
| `Hotel_Booking_Cancellation_Analysis.ipynb` | Notebook lengkap: data wrangling, feature engineering, EDA, uji hipotesis, baseline model, hyperparameter tuning, evaluasi, deployment |
| `hotel_booking.csv` | Dataset mentah |
| `dashboard/` | Dashboard web statis (HTML/CSS/JS tanpa build step) |
| `vercel.json` | Konfigurasi deploy Vercel (menyajikan folder `dashboard/`) |

## Dashboard

Dashboard membaca `dashboard/data.json` yang diekspor oleh bagian terakhir notebook
(**Ekspor Data Dashboard**). Jalankan ulang notebook setiap kali data atau model berubah.

**Menjalankan secara lokal**

```bash
cd dashboard
python3 -m http.server 8000
# buka http://localhost:8000
```

**Deploy ke Vercel**

- Lewat GitHub: import repository ini di [vercel.com/new](https://vercel.com/new), biarkan Framework Preset
  `Other` dan Root Directory kosong, lalu Deploy. `vercel.json` sudah mengatur output ke folder `dashboard/`
  tanpa build command.
- Lewat CLI: jalankan `vercel --prod` dari root repository.
