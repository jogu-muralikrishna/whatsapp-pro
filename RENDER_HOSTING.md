# Deploying WhatsApp Pro Terminal on Render

This guide outlines how to host your WhatsApp control container and its stateful backend-frontend engine on **Render** (https://render.com) so that it behaves **exactly** like your Google AI Studio preview, with permanent connection logins and robust database synchronization intact.

---

## ⚡ The Modern Single-Service Architecture
Unlike standard single-page-apps that require separating your frontend and backend on different providers, we have optimized this repository of the WhatsApp Pro Terminal with a unified full-stack server architecture. Our `server.ts` handles:
1. **Frontend Serving (Vite SPA)**: Compiles static React files and hosts them securely under an Express distribution directory when built in production mode.
2. **Stateful Backend Core**: Continuously coordinates QR generation, Baileys socket hooks with WhatsApp, cron operations, local backups, and Firestore syncing.

This means you only need to run **one singular Render Web Service** to serve both your interactive dashboard frontend and your active WhatsApp socket workers!

---

## 💾 Section 1: The Critical Task of State & Login Persistence
Render containers use an **ephemeral storage disk** by default (which resets when your container restarts, daily or on redeployment). This would normally sign you out of WhatsApp and force you to scan your QR code again with every deploy.

To solve this, we have upgraded the codebase to support dynamic path mapping via an optional environment variable called `DATA_DIR`. By providing a small **Render Persistent Disk**, all of your:
- Connection authentication folders: `auth_info_baileys` (main) and `auth_info_friend` (friend profile)
- Local file databases: `pro_data.db.json` (conversations, backups, and metrics)
- Media uploads: `uploads/` (profile configurations and pictures)

will survive restarts, scale operations, or upgrades perfectly!

---

## 🛠️ Method A: Deploy Automatically via Render Blueprints (Recommended)
Render Blueprints allow you to provision and configure all services with a single commit.

1. **Push your code** to your personal GitHub repository.
2. Log into your **Render Dashboard** (https://dashboard.render.com).
3. Navigate to **Blueprints** -> **New Blueprint Instance**.
4. Link your repository. Render will automatically read the root `render.yaml` configuration and ask you to confirm:
   - Your **Gemini API Key** (Required for the dynamic AI assistants).
   - Your administrative console custom password.
5. Click **Apply**. Render will automatically provision:
   - A `Node` Web Service on the Starter plan.
   - A `1 GB` Persistent Volume (`whatsapp-data`) mounted at `/data`.
   - Your environment settings and automatic continuous integration (auto-build on push).

---

## ⚙️ Method B: Deploy Manually on Render Dashboard
If you prefer configuring the Web Service manually via Render's visual interface:

### 1. Create the Web Service
- Click **New +** -> **Web Service**.
- Select **Build and deploy from a Git repository**.
- Link this repository.

### 2. Configure Service Parameters
* **Name**: `whatsapp-pro-terminal`
* **Region**: Choose the closest physical region to you.
* **Branch**: `main` (or your current distribution branch)
* **Runtime**: `Node`
* **Build Command**: `npm install && npm run build`
* **Start Command**: `npm run start`
* **Instance Type**: Select **Starter** (Required to attach Render Persistent Disks. Highly recommended so you do not have to scan QR codes on every container sleep!).

### 3. Setup Persistent Disks (CRITICAL)
Before hitting deploy, scroll down and:
- Find the **Disks** tab or sections inside Advanced settings.
- Click **Add Disk**.
  - **Name**: `whatsapp-persistent-volume`
  - **Mount Path**: `/data`
  - **Size**: `1 GB` (This is more than enough for thousands of chat sessions and backups).

### 4. Provide Environment Variables
Under the **Environment** tab, click **Add Environment Variable** to add these essential entries:

| Variable Key | Standard Production Value | Purpose / Notes |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables compiled Vite static distribution and optimized Express speeds. |
| `PORT` | `3000` | Render's designated internal communication gateway. |
| `DATA_DIR` | `/data` | Tells the database & WhatsApp engines to save all state folders directly to your Persistent Disk. |
| `GEMINI_API_KEY` | `your_google_ai_studio_api_key` | Enables the smart interactive agent responders and translation core. |
| `ADMIN_EMAIL` | `admin@pro.com` | Override default credential with your preferred admin username. |
| `ADMIN_PASSWORD` | `YourAwesomePass123` | Seeds this password automatically on first startup. |
| `ADMIN_JWT_SECRET` | `generate-random-secret-string-here` | Sign and secure session authorization tokens of your Admin panel. |
| `WHATSAPP_PHONE_NUMBER` | `12065550100` | Fallback phone number parameter. |

Save the configuration and let Render build and release your service!

---

## 🏆 Double down on cloud protection (Optional)
If you are already running **Firebase (Firestore)** as a sync target (like the development system's cloud adapter):
1. Keep the **Firebase Auto-Backup & Sync Adapter** active inside the dashboard.
2. Firestore will seamlessly archive any local snapshots of threads, calls, and status backlogs. Even if you deploy without a persistent disk on Render, enabling Firestore sync will ensure no conversation log is ever lost.

---

## 📈 Verifying the Deployment
To ensure your deployment is working:
1. Open your assigned Render URL (e.g., `https://whatsapp-pro-terminal.onrender.com`).
2. You will be greeted with the same gorgeous, high-contrast, professional slate-colored dashboard.
3. Access the **Admin Control Panel** using your specified username and password keys.
4. Try linking your phone through the QR terminal page to verify the connection. Since you mounted the disk to `/data`, the container will safely remember the authenticated state, meaning you will not get signed out on subsequent application redeployments!
