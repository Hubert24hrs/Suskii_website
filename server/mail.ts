/**
 * Transactional email. Uses Resend's HTTPS API when RESEND_API_KEY is set.
 * Without a provider, development logs the message; production reports "not sent".
 */
import { isProduction, mailConfig } from './config.js';

export interface Mail {
    to: string;
    subject: string;
    text: string;
}

export function mailConfigured(): boolean {
    return mailConfig().resendKey !== '';
}

export async function sendMail(mail: Mail): Promise<boolean> {
    const { resendKey, from } = mailConfig();
    if (!resendKey) {
        if (!isProduction()) {
            console.info(`[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
            return true;
        }
        console.warn('[mail] RESEND_API_KEY is not set; email not sent');
        return false;
    }
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn('[mail] provider rejected message', res.status);
    return res.ok;
}
