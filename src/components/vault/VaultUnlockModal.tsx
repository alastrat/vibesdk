import { t, useI18n } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { useVault } from '@/hooks/use-vault';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Fingerprint, KeyRound, AlertCircle, Loader2 } from 'lucide-react';

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	reason?: string;
}

type UnlockMethod = 'passkey' | 'password' | 'recovery';

type UnlockResult = { success: boolean; error?: string };

export function VaultUnlockModal({ open, onOpenChange, reason }: Props) {
	useI18n();
	const { unlockWithPassword, unlockWithPasskey, unlockWithRecoveryCode, resetVault, state } = useVault();
	const hasPasskey = state.unlockMethod === 'webauthn-prf';

	const [method, setMethod] = useState<UnlockMethod>(hasPasskey ? 'passkey' : 'password');
	const [password, setPassword] = useState('');
	const [recoveryCode, setRecoveryCode] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isUnlocking, setIsUnlocking] = useState(false);
	const [showResetConfirm, setShowResetConfirm] = useState(false);

	useEffect(() => {
		if (!open) return;
		setError(null);
		setPassword('');
		setRecoveryCode('');
		setMethod(hasPasskey ? 'passkey' : 'password');
	}, [hasPasskey, open]);

	const handleUnlock = async () => {
		setError(null);
		setIsUnlocking(true);

		try {
			let result: UnlockResult = { success: false, error: t("Unlock failed") };

			switch (method) {
				case 'passkey':
					result = await unlockWithPasskey();
					break;
				case 'password':
					if (!password) {
						setError(t("Please enter your password"));
						setIsUnlocking(false);
						return;
					}
					result = await unlockWithPassword(password);
					break;
				case 'recovery':
					if (!recoveryCode) {
						setError(t("Please enter a recovery code"));
						setIsUnlocking(false);
						return;
					}
					result = await unlockWithRecoveryCode(recoveryCode);
					break;
			}

			if (result.success) {
				onOpenChange(false);
				setPassword('');
				setRecoveryCode('');
			} else {
				setError(result.error ?? t("Unlock failed"));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t("Unlock failed"));
		} finally {
			setIsUnlocking(false);
		}
	};

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>{t("Unlock Vault")}</DialogTitle>
						<DialogDescription>
							{reason ?? t("Your secrets are encrypted. Unlock your vault to access them.")}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-4">
						<div className="flex gap-2">
							{hasPasskey && (
								<Button
									variant={method === 'passkey' ? 'default' : 'outline'}
									onClick={() => setMethod('passkey')}
									className="flex-1"
								>
									<Fingerprint className="h-4 w-4 mr-2" />{t("Passkey")}</Button>
							)}
							<Button
								variant={method === 'password' ? 'default' : 'outline'}
								onClick={() => setMethod('password')}
								className="flex-1"
							>
								<KeyRound className="h-4 w-4 mr-2" />{t("Password")}</Button>
						</div>

						{method === 'passkey' && (
							<div className="text-center py-4">
								<Fingerprint className="h-12 w-12 mx-auto text-primary mb-3" />
								<p className="text-sm text-muted-foreground">{t("Click unlock to authenticate with your passkey")}</p>
							</div>
						)}

						{method === 'password' && (
							<div className="space-y-2">
								<Label htmlFor="unlock-password">{t("Vault Password")}</Label>
								<Input
									id="unlock-password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
									placeholder={t("Enter your vault password")}
									autoFocus
								/>
							</div>
						)}

						{method === 'recovery' && (
							<div className="space-y-2">
								<Label htmlFor="recovery-code">{t("Recovery Code")}</Label>
								<Input
									id="recovery-code"
									value={recoveryCode}
									onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
									onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
									placeholder={t("XXXXX-XXXXX")}
									className="font-mono"
									autoFocus
								/>
							</div>
						)}

						{error && (
							<div className="flex items-center gap-2 text-sm text-destructive">
								<AlertCircle className="h-4 w-4" />
								{error}
							</div>
						)}

						{error?.includes('Vault configuration invalid') /* i18n-ignore */ && (
							<Button variant="destructive" onClick={() => setShowResetConfirm(true)} className="w-full">{t("Reset Vault")}</Button>
						)}

						<Button onClick={handleUnlock} disabled={isUnlocking} className="w-full">
							{isUnlocking ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("Unlocking...")}</>
							) : (
								t("Unlock")
							)}
						</Button>

						{method !== 'recovery' && (
							<button
								onClick={() => setMethod('recovery')}
								className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
							>{t("Use recovery code instead")}</button>
						)}
					</div>
				</DialogContent>
			</Dialog>

			<AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("Reset vault?")}</AlertDialogTitle>
						<AlertDialogDescription>{t("This deletes all vault secrets and configuration for this account.")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={async () => {
								setShowResetConfirm(false);
								const ok = await resetVault();
								if (ok) onOpenChange(false);
							}}
						>{t("Reset")}</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
