import { useBilling } from '@/hooks/use-billing';
import { DEFAULT_SHOPPER_EMAIL_TEMPLATES } from '@/api-types';
import { PlanButton } from '@/components/billing/PlanButton';
import { INTL_LOCALE } from 'shared/i18n/locales';
import { getLocale, t, useI18n } from '@/lib/i18n';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { SHOPPER_EMAIL_LABELS, type RecentShopperEmail, type ShopperEmailKind, type ShopperEmailsData, type ShopperEmailTemplateView } from '@/api-types';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useSaveShopperEmail, useSaveShopperEmailSettings, useShopperEmails, useShopperEmailStores } from '@/hooks/use-shopper-emails';
import { StoreToolLauncher } from '../translations/store-tool-launcher';
import { STATUS_LABELS, statusVariant, templateOrigin } from './email-format';
import { TemplateEditor } from './template-editor';

/** Compatibility route: a seller explicitly chooses which store workspace to open. */
export default function ShopperEmailsPage() {
	useI18n();
	const stores = useShopperEmailStores();
	return (
		<StoreToolLauncher
			title={t('Emails')}
			description={t('Choose a store to manage its order emails.')}
			section="emails"
			stores={stores.data?.stores}
			loading={stores.isLoading}
			error={stores.error}
			retrying={stores.isFetching}
			onRetry={() => void stores.refetch()}
			emptyTitle={t('No stores yet')}
			emptyDescription={t('Publish a store to set up its emails.')}
		/>
	);
}

/** The workspace supplies its owned store; this panel never picks another store. */
export function StoreEmailsPanel({ appId }: { appId: string }) {
	return <StoreEmailsContent key={appId} appId={appId} />;
}

function StoreEmailsContent({ appId }: { appId: string }) {
	useI18n();
	const emails = useShopperEmails(appId);
	return (
		<div className="grid gap-6">
			{emails.data ? (
				<StoreEmails appId={appId} data={emails.data} />
			) : emails.isError ? (
				<Empty
					title={t("Couldn't load this store's emails")}
					description={emails.error.message}
					contents={<Button size="sm" variant="secondary" loading={emails.isFetching} disabled={emails.isFetching} onClick={() => void emails.refetch()}>{t('Retry')}</Button>}
				/>
			) : (
				<div className="flex justify-center py-16"><Loader /></div>
			)}
			<p className="text-sm text-kumo-subtle">{t("Estori sends order emails only. Cloudflare, which delivers them, doesn't allow marketing email such as newsletters or promotions.")}</p>
		</div>
	);
}

function StoreEmails({ appId, data }: { appId: string; data: ShopperEmailsData }) {
	const i18n = useI18n();
	const billing = useBilling();
	const canSend = billing.data?.enabled === false || billing.data?.limits.shopperEmails === true;
	const canCustomize = canSend && (billing.data?.enabled === false || billing.data?.limits.customShopperEmails === true);
	const [editing, setEditing] = useState<ShopperEmailKind | null>(null);
	const save = useSaveShopperEmail(appId);
	const templates = canCustomize ? data.templates : data.templates.map(template => ({ ...template, ...DEFAULT_SHOPPER_EMAIL_TEMPLATES[template.kind], edited: false }));
	const template = templates.find((candidate) => candidate.kind === editing);

	const toggle = (current: ShopperEmailTemplateView, enabled: boolean) => {
		const { kind, edited: _edited, ...fields } = current;
		save.mutate(
			{ kind, template: { ...fields, enabled } },
			{
				onSuccess: () => toast.success(enabled ? t("{value1} email on", { value1: t(SHOPPER_EMAIL_LABELS[kind].name) }) : t("{value1} email off", { value1: SHOPPER_EMAIL_LABELS[kind].name })),
				onError: (error) => toast.error(error.message),
			},
		);
	};

	return (
		<>
			{billing.data?.enabled && !canCustomize && (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-kumo-fill p-4 text-sm">
					<p>{!canSend ? t('Automatic shopper emails and store sender addresses come with Pro and Premium.') : t('Custom email wording and reply addresses come with Premium.')}</p>
					<PlanButton plan={canSend ? "premium" : "pro"} i18n={i18n} className="px-4 py-2 text-sm" />
				</div>
			)}
			{billing.isError && <p className="text-sm text-kumo-subtle">{billing.error.message}</p>}
			<ul className="grid gap-3 sm:grid-cols-3">
				{templates.map((template) => (
					<li key={template.kind} className="grid content-between gap-3 rounded-lg border border-kumo-line p-4 text-sm">
						<div className="grid gap-1">
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium text-kumo-default">{t(SHOPPER_EMAIL_LABELS[template.kind].name)}</span>
								<Switch
									checked={canSend && template.enabled}
									disabled={save.isPending || !canCustomize}
									onCheckedChange={(enabled) => toggle(template, enabled)}
									aria-label={t("Send the {value1} email", { value1: t(SHOPPER_EMAIL_LABELS[template.kind].name).toLowerCase() })}
								/>
							</div>
							<span className="text-kumo-subtle">{t(SHOPPER_EMAIL_LABELS[template.kind].when)}</span>
						</div>
						<div className="flex items-center justify-between gap-2">
							<Badge variant={template.edited ? 'outline' : 'secondary'}>{templateOrigin(template)}</Badge>
							<Button size="sm" variant="secondary" disabled={!canSend} onClick={() => setEditing(template.kind)}>{canCustomize ? t("Edit") : t("Preview and test")}</Button>
						</div>
					</li>
				))}
			</ul>

			{canSend && <p className="text-sm text-kumo-subtle">{t("Shoppers get these emails from {sender}, under your store's name.", { sender: data.senderEmail })}</p>}

			<ReplyToForm key={`${appId}:${canCustomize}:${canCustomize ? data.replyTo : ""}`} appId={appId} replyTo={canCustomize ? data.replyTo : null} sellerEmail={data.sellerEmail} disabled={!canCustomize} />

			<section className="grid gap-3">
				<h2 className="text-lg font-semibold text-kumo-strong">{t("Recent emails")}</h2>
				{data.recent.length > 0 ? (
					<>
						<RecentTable rows={data.recent} />
						<RecentCards rows={data.recent} />
					</>
				) : (
					<Empty title={t("No emails yet")} description={t("Emails your shoppers get from this store show up here.")} />
				)}
			</section>

			{canSend && template && <TemplateEditor key={`${template.kind}:${canCustomize}`} readOnly={!canCustomize} appId={appId} template={template} placeholders={data.placeholders[template.kind]} onClose={() => setEditing(null)} />}
		</>
	);
}

function ReplyToForm({ appId, replyTo, sellerEmail, disabled }: { appId: string; replyTo: string | null; sellerEmail: string | null; disabled: boolean }) {
	useI18n();
	const [value, setValue] = useState(replyTo ?? '');
	const settings = useSaveShopperEmailSettings(appId);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		settings.mutate(value.trim() || null, { onSuccess: () => toast.success(t("Saved where replies go")), onError: (error) => toast.error(error.message) });
	};

	return (
		<form className="grid max-w-md gap-2 text-sm" onSubmit={submit}>
			<label className="grid gap-1">
				<span className="font-medium text-kumo-default">{t("Replies go to")}</span>
				<Input type="email" disabled={disabled} value={value} maxLength={254} placeholder={sellerEmail ?? t("you@yourstore.com")} onChange={(event) => setValue(event.target.value)} />
			</label>
			<span className="text-kumo-subtle">{t('When a shopper replies to an email, it reaches this address. Leave it empty to use your account email{email}.', { email: sellerEmail ? ` (${sellerEmail})` : '' })}</span>
			<Button type="submit" size="sm" variant="secondary" className="w-fit" disabled={disabled || settings.isPending} loading={settings.isPending}>{t("Save")}</Button>
		</form>
	);
}

function StatusBadges({ email }: { email: RecentShopperEmail }) {
	useI18n();
	return (
		<span className="flex flex-wrap gap-1">
			<Badge variant={statusVariant(email.status)}>{t(STATUS_LABELS[email.status])}</Badge>
			{email.test && <Badge variant="outline">{t("Test")}</Badge>}
		</span>
	);
}

function RecentTable({ rows }: { rows: RecentShopperEmail[] }) {
	useI18n();
	return (
		<div className="hidden overflow-x-auto sm:block">
			<table className="w-full text-left text-sm">
				<caption className="sr-only">{t("Emails sent to shoppers, newest first")}</caption>
				<thead className="text-kumo-subtle">
					<tr>
						<th scope="col" className="py-2 pr-4 font-normal">{t("Email")}</th>
						<th scope="col" className="py-2 pr-4 font-normal">{t("Order")}</th>
						<th scope="col" className="py-2 pr-4 font-normal">{t("To")}</th>
						<th scope="col" className="py-2 pr-4 font-normal">{t("Status")}</th>
						<th scope="col" className="py-2 font-normal">{t("Date")}</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((email) => (
						<tr key={email.id} className="border-t border-kumo-line align-top text-kumo-default">
							<th scope="row" className="py-2.5 pr-4 font-normal">{SHOPPER_EMAIL_LABELS[email.kind].name}</th>
							<td className="py-2.5 pr-4">{email.orderNumber !== null ? `#${email.orderNumber}` : '-'}</td>
							<td className="py-2.5 pr-4 break-all">{email.recipient ?? '-'}</td>
							<td className="py-2.5 pr-4">
								<StatusBadges email={email} />
							</td>
							<td className="py-2.5">{new Date(email.sentAt ?? email.createdAt).toLocaleString(INTL_LOCALE[getLocale()])}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The same emails as cards, for phones. */
function RecentCards({ rows }: { rows: RecentShopperEmail[] }) {
	useI18n();
	return (
		<ul className="grid gap-3 sm:hidden">
			{rows.map((email) => (
				<li key={email.id} className="grid gap-1.5 rounded-lg border border-kumo-line p-3 text-sm">
					<div className="flex items-center justify-between gap-2">
						<span className="font-medium">{SHOPPER_EMAIL_LABELS[email.kind].name}</span>
						<span className="text-kumo-subtle">{email.orderNumber !== null ? t("Order #{value1}", { value1: email.orderNumber }) : ''}</span>
					</div>
					<span className="break-all text-kumo-subtle">
						{email.recipient ?? '-'} · {new Date(email.sentAt ?? email.createdAt).toLocaleDateString(INTL_LOCALE[getLocale()])}
					</span>
					<StatusBadges email={email} />
				</li>
			))}
		</ul>
	);
}
