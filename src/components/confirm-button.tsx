import { useState } from 'react';
import { Button } from '@cloudflare/kumo';
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

/** A button whose action can't be undone in one click: it asks first. */
export function ConfirmButton({
	label,
	title,
	description,
	pending,
	onConfirm,
	variant = 'secondary',
}: {
	label: string;
	title: string;
	description: string;
	pending: boolean;
	onConfirm: () => void;
	variant?: 'secondary' | 'ghost';
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant={variant} size="sm" onClick={() => setOpen(true)} disabled={pending} loading={pending}>
				{label}
			</Button>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{title}</AlertDialogTitle>
						<AlertDialogDescription>{description}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
