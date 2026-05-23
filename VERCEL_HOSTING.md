# Hosting WhatsApp Pro Terminal on Vercel

This guide outlines how to host your application with **Vercel** and other deployment environments.

## The Architecture Checklist
The application consists of two parts:
1. **Frontend (Vite / React SPA)**: Stateful dashboards, real-time logging terminal, controls, and administrative console.
2. **Backend (Node.js / Express / WebSockets)**: Stateful connection to WhatsApp servers via Baileys, cron schedulers, local session triggers, and real-time active status management.

---

## 1. Hosting the Frontend on Vercel
Vercel is optimized for building and serving the static React frontend (Single Page Application).

We have created the `vercel.json` file in the root directory to handle:
- Compiling static production files into the `/dist` directory.
- Rewriting routing fallback rules so modern client-side navigation (`react-router` or state-managed tabs) works on refresh.

### To Deploy on Vercel:
1. Import your project repository into Vercel.
2. Select **Vite** as the framework template.
3. Keep the **Build Command** as `npm run build` or `vite build`.
4. Keep the **Output Directory** as `dist`.
5. Add your Environment Variables (such as `VITE_BACKEND_URL` if you host the backend separately).

---

## 2. Deploying the Backend Server (Stateful Node.js)
Because the backend uses stateful protocols like WebSockets (`ws`) and handles persistent engine sessions with WhatsApp, **Vercel's Serverless environment alone cannot host the background WhatsApp engine continuously**.

To run the stateful backend, we recommend hosting the backend on a companion stateful container service:
- **Render** (https://render.com)
- **Railway** (https://railway.app)
- **Google Cloud Run** (https://cloud.google.com/run)
- **DigitalOcean App Platform** (https://digitalocean.com)

### Steps to Link Vercel to Your Backend Server:
If you host the stateful backend server on Railway/Render (e.g., at `https://whatsapp-backend-prod.railway.app`), update your `vercel.json` file's `rewrites` destination to point directly to your backend URL:

```json
{
  "version": 2,
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-backend-prod.railway.app/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## 3. Environment Variables
Ensure the following variables are configured in both Vercel and your Server hosting environment:

```env
# Backend Keys
GEMINI_API_KEY=your_gemini_api_key_here

# Frontend Variables (For Vercel client bundle)
VITE_BACKEND_URL=https://your-backend-prod.railway.app
```
