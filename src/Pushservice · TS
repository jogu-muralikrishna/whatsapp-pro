/**
 * pushService.ts
 *
 * Real browser push notifications (Web Push / VAPID) so a user gets notified
 * of a new WhatsApp message even when the app/tab is completely closed.
 *
 * Setup (one-time):
 *   1. Run:  node -e "console.log(require('web-push').generateVAPIDKeys())"
 *   2. Put the printed keys in your environment as:
 *        VAPID_PUBLIC_KEY=...
 *        VAPID_PRIVATE_KEY=...
 *      (Render → your service → Environment tab)
 *   3. Redeploy. If the keys are missing, push notifications are silently
 *      skipped (everything else keeps working normally).
 */

import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@pro.com';

let pushEnabled = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushEnabled = true;
  } catch (e: any) {
    console.error('[PushService] Failed to configure VAPID keys:', e.message);
  }
} else {
  console.warn('[PushService] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications disabled.');
}

export function isPushEnabled(): boolean {
  return pushEnabled;
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Send a push notification to every device a user has subscribed from.
 * Dead/expired subscriptions (410/404) are removed automatically.
 */
export async function notifyUser(
  subscriptions: PushSubscriptionRecord[],
  payload: { title: string; body: string; tag?: string; url?: string },
  onExpired: (endpoint: string) => void
): Promise<void> {
  if (!pushEnabled || !subscriptions || subscriptions.length === 0) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag || 'wp-message',
    url: payload.url || '/',
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub as any, body);
      } catch (e: any) {
        const statusCode = e?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is no longer valid (user uninstalled / cleared data)
          onExpired(sub.endpoint);
        } else {
          console.error('[PushService] Failed to send push:', e?.message || e);
        }
      }
    })
  );
}
