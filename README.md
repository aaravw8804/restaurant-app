# 🍽 Ember & Oak — Restaurant App

Full-stack restaurant application.
**Backend**: Python + Flask · **Database**: PostgreSQL on Supabase · **Deployment**: Render (free tier) · **Frontend**: Vanilla HTML/CSS/JS

---

## 📁 Directory Structure

```
restaurant-app/
├── backend/
│   ├── app.py              # Flask API
│   ├── requirements.txt    # Python dependencies
│   ├── .env.example        # Environment variables template
│   └── render.yaml         # Render deployment config
├── database/
│   └── schema.sql          # Full PostgreSQL schema + seed data
└── frontend/
    ├── index.html          # Main page (menu, reservation, checkout)
    ├── css/
    │   └── style.css
    └── js/
        └── app.js          # API integration + cart logic
```

---

## 🛠 What to Install Locally

### Python (backend)
```bash
# Python 3.10+ required
python --version

# Install pip packages
cd backend
pip install -r requirements.txt
```

### Required tools
| Tool | Download |
|------|----------|
| Python 3.10+ | https://python.org |
| Git | https://git-scm.com |
| VS Code (recommended) | https://code.visualstudio.com |
| Live Server extension (VS Code) | For serving frontend locally |

---

## 🗄 Step 1 — Set up Supabase (Free PostgreSQL)

1. Go to **https://supabase.com** → Sign Up → Create a new project
2. Give it a name (e.g. `restaurant-db`), set a strong password, choose a region
3. Once ready, go to **SQL Editor** in the left sidebar
4. Open `database/schema.sql`, paste the entire contents, and click **Run**
5. Go to **Settings → Database** → copy the **Connection string (URI)**
   - It looks like: `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`
6. Save this — you'll need it as `DATABASE_URL`

---

## ⚙️ Step 2 — Configure the Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in:
```
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-REF].supabase.co:5432/postgres
SECRET_KEY=any_long_random_string_here
FLASK_ENV=development
STRIPE_SECRET_KEY=sk_test_...   # from https://stripe.com (optional for now)
FRONTEND_URL=http://localhost:5500
```

### Test locally:
```bash
python app.py
# API running at http://localhost:5000
```

Test it: `http://localhost:5000/api/health` → should return `{"status":"ok"}`

---

## 🚀 Step 3 — Deploy Backend on Render (Free)

1. Push your project to **GitHub**
2. Go to **https://render.com** → Sign Up → New → Web Service
3. Connect your GitHub repo
4. Select the `backend/` folder as root (or set **Root Directory** to `backend`)
5. Set:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`
   - **Environment**: Python
6. Add environment variables (same as your `.env`):
   - `DATABASE_URL`
   - `SECRET_KEY`
   - `STRIPE_SECRET_KEY`
   - `FRONTEND_URL` → set this to `*` initially, then lock it down later
7. Click **Create Web Service** — Render will build and deploy it
8. Your API URL will be something like: `https://restaurant-api-xxxx.onrender.com`

> ⚠️ Free Render instances **spin down after 15 min of inactivity** — first request may take ~30s to wake up.

---

## 🌐 Step 4 — Connect Frontend

Open `frontend/js/app.js` and update line 5:
```javascript
const API_BASE = "https://your-app.onrender.com"; // ← paste your Render URL here
```

### Serve the frontend:
- **VS Code**: Right-click `index.html` → Open with Live Server (port 5500)
- **Or**: Use any static hosting (Netlify, GitHub Pages, Vercel)

---

## 💳 Step 5 — Stripe Payments (Optional)

1. Sign up at https://stripe.com (free)
2. Dashboard → Developers → API Keys → copy **Secret key** (starts with `sk_test_`)
3. Add to your `.env` as `STRIPE_SECRET_KEY`
4. For webhooks (local testing): install Stripe CLI and run:
   ```bash
   stripe listen --forward-to localhost:5000/api/payments/webhook
   ```

---

## 📡 API Endpoints Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/menu` | Get all menu items |
| GET | `/api/menu/categories` | Get categories |
| POST | `/api/orders` | Create an order |
| GET | `/api/orders/:id` | Get order details |
| POST | `/api/reservations` | Create reservation |
| GET | `/api/reservations/check-availability` | Check table availability |
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login user |
| POST | `/api/payments/create-intent` | Create Stripe payment intent |

---

## 🧪 Quick Test (curl)

```bash
# Health check
curl https://your-app.onrender.com/api/health

# Get menu
curl https://your-app.onrender.com/api/menu

# Create reservation
curl -X POST https://your-app.onrender.com/api/reservations \
  -H "Content-Type: application/json" \
  -d '{"guest_name":"Jane","guest_email":"jane@test.com","party_size":2,"reserved_date":"2025-08-01","reserved_time":"19:30"}'
```

---

## 🆓 Free Tier Limits

| Service | Free Limit |
|---------|-----------|
| Supabase | 500MB DB, 50,000 rows, 2GB bandwidth |
| Render | 750 hrs/month, sleeps after 15 min idle |
| Stripe | No monthly fee; 1.4% + 20p per transaction |
