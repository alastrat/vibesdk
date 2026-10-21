import { INTL_LOCALE } from 'shared/i18n/locales';
import { getLocale, t, useI18n } from '@/lib/i18n';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { SHOPPER_EMAIL_LABELS, type RecentShopperEmail, type ShopperEmailKind, type ShopperEmailsData, type ShopperEmailTemplateView } from '@/api-types';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useSaveShopperEmail, useSaveShopperEmailSettings, useShopperEmails, useShopperEmailStores } from '@/hooks/use-shopper-emails';
import { storeLabel } from '../orders/order-format';
import { STATUS_LABELS, statusVariant, templateOrigin } from './email-format';
import { TemplateEditor } from './template-editor';

export default function ShopperEmailsPage() {
	useI18n();
	const stores = useShopperEmailStores();
	const [chosen, setChosen] = useState<string | null>(null);
	const appId = chosen ?? stores.data?.stores[0]?.appId ?? null;
	const emails = useShopperEmails(appId);

	return (
		<div className="size-full">
			<title>{pageTitle('Emails')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">{t("Emails")}</h1>
					<p className="text-kumo-subtle">{t("Estori emails your shoppers when they order, when you ship and when they're refunded. Edit what each email says, or turn it off.")}</p>
				</div>

				{stores.data ? (
					stores.data.stores.length === 0 ? (
						<Empty title={t("No stores yet")} description={t("Publish a store to set up its emails.")} />
					) : (
						<>
							{stores.data.stores.length > 1 && (
								<label className="flex w-fit items-center gap-2 text-sm text-kumo-subtle">{t("Store")}<select className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-sm text-kumo-default" value={appId ?? ''} onChange={(event) => setChosen(event.target.value)}>
										{stores.data.stores.map((option) => (
											<option key={option.appId} value={option.appId}>
												{storeLabel(option.title)}
											</option>
										))}
									</select>
								</label>
							)}
							{appId && emails.data ? (
								<StoreEmails key={appId} appId={appId} data={emails.data} />
							) : emails.isError ? (
								<Empty title={t("Couldn't load this store's emails")} description={emails.error.message} />
							) : (
								<div className="flex justify-center py-16">
									<Loader />
								</div>
							)}
						</>
					)
				) : stores.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : (
					<Empty title={t("Couldn't load your stores")} description={stores.error?.message} />
				)}

				<p className="text-sm text-kumo-subtle">{t("Estori sends order emails only. Cloudflare, which delivers them, doesn't allow marketing email such as newsletters or promotions.")}</p>
			</div>
		</div>
	);
}

function StoreEmails({ appId, data }: { appId: string; data: ShopperEmailsData }) {
	useI18n();
	const [editing, setEditing] = useState<ShopperEmailKind | null>(null);
	const save = useSaveShopperEmail(appId);
	const template = data.templates.find((candidate) => candidate.kind === editing);

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
			<ul className="grid gap-3 sm:grid-cols-3">
				{data.templates.map((template) => (
					<li key={template.kind} className="grid content-between gap-3 rounded-lg border border-kumo-line p-4 text-sm">
						<div className="grid gap-1">
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium text-kumo-default">{t(SHOPPER_EMAIL_LABELS[template.kind].name)}</span>
								<Switch
									checked={template.enabled}
									disabled={save.isPending}
									onCheckedChange={(enabled) => toggle(template, enabled)}
									aria-label={t("Send the {value1} email", { value1: t(SHOPPER_EMAIL_LABELS[template.kind].name).toLowerCase() })}
								/>
							</div>
							<span className="text-kumo-subtle">{t(SHOPPER_EMAIL_LABELS[template.kind].when)}</span>
						</div>
						<div className="flex items-center justify-between gap-2">
							<Badge variant={template.edited ? 'outline' : 'secondary'}>{templateOrigin(template)}</Badge>
							<Button size="sm" variant="secondary" onClick={() => setEditing(template.kind)}>{t("Edit")}</Button>
						</div>
					</li>
				))}
			</ul>

			<p className="text-sm text-kumo-subtle">{t("Shoppers get these emails from {sender}, under your store's name.", { sender: data.senderEmail })}</p>

			<ReplyToForm appId={appId} replyTo={data.replyTo} sellerEmail={data.sellerEmail} />

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

			{template && <TemplateEditor appId={appId} template={template} placeholders={data.placeholders[template.kind]} onClose={() => setEditing(null)} />}
		</>
	);
}

function ReplyToForm({ appId, replyTo, sellerEmail }: { appId: string; replyTo: string | null; sellerEmail: string | null }) {
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
				<Input type="email" value={value} maxLength={254} placeholder={sellerEmail ?? t("you@yourstore.com")} onChange={(event) => setValue(event.target.value)} />
			</label>
			<span className="text-kumo-subtle">{t('When a shopper replies to an email, it reaches this address. Leave it empty to use your account email{email}.', { email: sellerEmail ? ` (${sellerEmail})` : '' })}</span>
			<Button type="submit" size="sm" variant="secondary" className="w-fit" disabled={settings.isPending} loading={settings.isPending}>{t("Save")}</Button>
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
