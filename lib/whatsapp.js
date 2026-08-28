/**
 * Shared WhatsApp Cloud API send helper.
 * Used by send-confirmation and send-reminders — never call the Graph API directly
 * from those routes; always go through this module so auth/normalization is in one place.
 *
 * Usage:
 *   import { sendWhatsAppTemplate } from './send.js';
 *   const { ok, messageId, error } = await sendWhatsAppTemplate(phone, templateName, language, variables);
 *
 * variables: array of { type: 'text', text: '...' } objects matching template component order.
 * For hello_world (no variables), pass [].
 */

/**
 * Normalize a phone number to E.164 format.
 * If the number already starts with +, clean it and return as-is.
 * If it starts with 0 (Belgian/Dutch local format), strip the leading 0 and
 * try Belgian (+32) first — caller should store numbers with country codes ideally.
 * Returns null if the number cannot be parsed.
 */
export function normalizePhone(raw) {
  if (!raw) return null;
  // Remove all non-digit characters except leading +
  let cleaned = String(raw).trim();
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return '+' + digits;
  }
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return null;
  // Belgian/Dutch local: starts with 04 (mobile BE), 0 (BE landline), 06 (NL mobile)
  if (digits.startsWith('0')) {
    const withoutLeadingZero = digits.slice(1);
    // Assume Belgian +32 by default
    return '+32' + withoutLeadingZero;
  }
  // Already looks like an international number without +
  if (digits.length >= 10) return '+' + digits;
  return null;
}

/**
 * Send a WhatsApp template message.
 * @param {string} phone - Raw phone number (will be normalized to E.164)
 * @param {string} templateName - Approved Meta template name
 * @param {string} language - Template language code, e.g. 'nl', 'en_US'
 * @param {Array}  variables - Array of body component parameter objects
 * @returns {{ ok: boolean, messageId: string|null, error: string|null, normalizedPhone: string|null }}
 */
export async function sendWhatsAppTemplate(phone, templateName, language, variables = []) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    return { ok: false, messageId: null, error: 'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured', normalizedPhone: null };
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { ok: false, messageId: null, error: `Cannot normalize phone number: "${phone}"`, normalizedPhone: null };
  }

  // Build the template components array.
  // hello_world has no body parameters; real templates may have body parameters.
  const components = [];
  if (variables && variables.length > 0) {
    components.push({
      type: 'body',
      parameters: variables.map(v => typeof v === 'string' ? { type: 'text', text: v } : v),
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: normalizedPhone.replace('+', ''), // Meta expects E.164 without leading +
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  try {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const errMsg = data?.error?.message || JSON.stringify(data);
      return { ok: false, messageId: null, error: errMsg, normalizedPhone };
    }

    const messageId = data?.messages?.[0]?.id || null;
    return { ok: true, messageId, error: null, normalizedPhone };
  } catch (err) {
    return { ok: false, messageId: null, error: err.message, normalizedPhone };
  }
}
