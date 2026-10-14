import type { OutgoingEmail } from './types';

const BUTTON_STYLE =
	'display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

interface EmailContent {
	to: string;
	subject: string;
	heading: string;
	body: string;
	buttonLabel: string;
	link: string;
	footer: string;
}

function renderEmail(content: EmailContent): OutgoingEmail {
	const link = escapeHtml(content.link);
	const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5;">
<div style="max-width:480px;margin:0 auto;">
<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(content.heading)}</h1>
<p style="margin:0 0 24px;">${escapeHtml(content.body)}</p>
<p style="margin:0 0 24px;"><a href="${link}" style="${BUTTON_STYLE}">${escapeHtml(content.buttonLabel)}</a></p>
<p style="margin:0 0 8px;font-size:14px;">Or paste this link into your browser:</p>
<p style="margin:0 0 24px;font-size:14px;word-break:break-all;"><a href="${link}">${link}</a></p>
<p style="margin:0;font-size:14px;color:#555555;">${escapeHtml(content.footer)}</p>
<p style="margin:16px 0 0;font-size:12px;color:#777777;">Sent to ${escapeHtml(content.to)} by Estori.</p>
</div>
</body>
</html>`;
	const text = [
		content.heading,
		'',
		content.body,
		'',
		`${content.buttonLabel}: ${content.link}`,
		'',
		content.footer,
		'',
		`Sent to ${content.to} by Estori.`,
	].join('\n');
	return { to: content.to, subject: content.subject, html, text };
}

export function passwordResetEmail(to: string, link: string): OutgoingEmail {
	return renderEmail({
		to,
		subject: 'Reset your Estori password',
		heading: 'Reset your password',
		body: 'We received a request to reset the password for your Estori account. Use the button below to choose a new one.',
		buttonLabel: 'Reset password',
		link,
		footer: "This link expires in 30 minutes. If you didn't ask to reset your password, ignore this email.",
	});
}

export function verifyEmailEmail(to: string, link: string): OutgoingEmail {
	return renderEmail({
		to,
		subject: 'Confirm your email for Estori',
		heading: 'Confirm your email',
		body: 'Confirm this address to finish setting up your Estori account.',
		buttonLabel: 'Confirm email',
		link,
		footer: "This link expires in 24 hours. If you didn't create an Estori account, ignore this email.",
	});
}
