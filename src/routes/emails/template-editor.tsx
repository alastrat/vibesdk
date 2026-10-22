import { t, useI18n } from '@/lib/i18n';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@cloudflare/kumo';
import { SHOPPER_EMAIL_LABELS, SHOPPER_EMAIL_LIMITS, type ShopperEmailTemplateView } from '@/api-types';
import { ConfirmButton } from '@/components/confirm-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useResetShopperEmail, useSaveShopperEmail, useSendShopperEmailTest, useShopperEmailPreview } from '@/hooks/use-shopper-emails';
import { insertPlaceholder } from './email-format';

type Field = 'subject' | 'heading' | 'body';
const PREVIEW_DELAY_MS = 400;

/** Edits one email's subject, heading and message, with a live preview filled in with a sample order. */
export function TemplateEditor({ appId, template, placeholders, onClose, readOnly = false }: { readOnly?: boolean; appId: string; template: ShopperEmailTemplateView; placeholders: readonly string[]; onClose: () => void }) {
	useI18n();
	const label = SHOPPER_EMAIL_LABELS[template.kind];
	const [values, setValues] = useState<Record<Field, string>>({ subject: template.subject, heading: template.heading, body: template.body });
	const [focused, setFocused] = useState<Field>('body');
	const inputs = useRef<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>>({});
	const fields = useMemo(() => ({ subject: values.subject, heading: values.heading, body: values.body }), [values]);
	const preview = useShopperEmailPreview(appId, template.kind, useDebouncedValue(fields, PREVIEW_DELAY_MS));
	const save = useSaveShopperEmail(appId);
	const reset = useResetShopperEmail(appId);
	const test = useSendShopperEmailTest(appId);

	const change = (field: Field, value: string) => setValues((current) => ({ ...current, [field]: value }));
	const insert = (name: string) => {
		const element = inputs.current[focused];
		const text = values[focused];
		const next = insertPlaceholder(text, name, element?.selectionStart ?? text.length, element?.selectionEnd ?? text.length);
		change(focused, next.text);
		requestAnimationFrame(() => {
			element?.focus();
			element?.setSelectionRange(next.caret, next.caret);
		});
	};
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (readOnly) return;
		save.mutate(
			{ kind: template.kind, template: { enabled: template.enabled, ...fields } },
			{
				onSuccess: () => {
					toast.success(t("Email saved"));
					onClose();
				},
			},
		);
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle>{t('{name} email', { name: t(label.name) })}</DialogTitle>
					<DialogDescription>{t(label.when)} {readOnly && t("Preview and test these emails. Customize their wording with Premium.")}</DialogDescription>
				</DialogHeader>
				<div className="grid gap-6 md:grid-cols-2">
					<form className="grid content-start gap-3 text-sm" onSubmit={submit}>
						<fieldset disabled={readOnly} className="contents">
						<label className="grid gap-1">
							<span className="text-kumo-subtle">{t("Subject")}</span>
							<Input
								ref={(element) => void (inputs.current.subject = element)}
								value={values.subject}
								maxLength={SHOPPER_EMAIL_LIMITS.subject}
								onFocus={() => setFocused('subject')}
								onChange={(event) => change('subject', event.target.value)}
								required
							/>
						</label>
						<label className="grid gap-1">
							<span className="text-kumo-subtle">{t("Heading")}</span>
							<Input
								ref={(element) => void (inputs.current.heading = element)}
								value={values.heading}
								maxLength={SHOPPER_EMAIL_LIMITS.heading}
								onFocus={() => setFocused('heading')}
								onChange={(event) => change('heading', event.target.value)}
								required
							/>
						</label>
						<label className="grid gap-1">
							<span className="text-kumo-subtle">{t("Message")}</span>
							<Textarea
								ref={(element) => void (inputs.current.body = element)}
								value={values.body}
								rows={8}
								maxLength={SHOPPER_EMAIL_LIMITS.body}
								onFocus={() => setFocused('body')}
								onChange={(event) => change('body', event.target.value)}
							/>
							<span className="text-xs text-kumo-subtle">{t("A blank line starts a new paragraph. The order's items, totals and links always follow your message.")}</span>
						</label>
						<div className="grid gap-1.5">
							<span className="text-kumo-subtle">{t("Insert")}</span>
							<div className="flex flex-wrap gap-1.5">
								{placeholders.map((name) => (
									<button key={name} type="button" className="rounded-md border border-kumo-line px-2 py-0.5 font-mono text-xs text-kumo-default hover:bg-kumo-elevated" onClick={() => insert(name)}>
										{`{{${name}}}`}
									</button>
								))}
							</div>
						</div>
						</fieldset>
						{save.error && (
							<p role="alert" className="text-kumo-danger">
								{save.error.message}
							</p>
						)}
						<div className="flex flex-wrap gap-2">
							{!readOnly && <Button type="submit" size="sm" disabled={save.isPending} loading={save.isPending}>{t("Save")}</Button>}
							<Button
								type="button"
								size="sm"
								variant="secondary"
								disabled={test.isPending}
								loading={test.isPending}
								onClick={() =>
									test.mutate({ kind: template.kind, fields }, { onSuccess: (result) => toast.success(t("Test sent to {value1}", { value1: result.sentTo })), onError: (error) => toast.error(error.message) })
								}
							>{t("Send me a test")}</Button>
							{!readOnly && template.edited && (
								<ConfirmButton
									label={t("Reset to default")}
									title={t("Go back to Estori's default?")}
									description={t("Your subject, heading and message for this email are replaced with Estori's.")}
									pending={reset.isPending}
									variant="ghost"
									onConfirm={() =>
										reset.mutate(template.kind, {
											onSuccess: () => {
												toast.success(t("Back to Estori's default"));
												onClose();
											},
											onError: (error) => toast.error(error.message),
										})
									}
								/>
							)}
							<Button type="button" size="sm" variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
						</div>
					</form>
					<div className="grid content-start gap-2 text-sm">
						<span className="text-kumo-subtle">{t("Preview with a sample order")}</span>
						{preview.data ? (
							<>
								<p className="font-medium text-kumo-default">{preview.data.subject}</p>
								<iframe key={preview.dataUpdatedAt} title={t("Email preview")} sandbox="" srcDoc={preview.data.html} className="h-[480px] w-full rounded-md border border-kumo-line bg-white" />
							</>
						) : (
							<p className="text-kumo-subtle">{preview.error ? preview.error.message : t("Loading the preview")}</p>
						)}
						{preview.data && preview.error && <p className="text-kumo-danger">{preview.error.message}</p>}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
