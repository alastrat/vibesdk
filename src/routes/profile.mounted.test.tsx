import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	act,
	type ButtonHTMLAttributes,
	type InputHTMLAttributes,
	type ReactNode,
	type TextareaHTMLAttributes,
} from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import {
	mountElement,
	silenceTestRendererDeprecation,
	textOf,
	unmountAll,
} from '@/test-support/mounted';
import Profile from './profile';

const save = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const user = vi.hoisted(() => ({ id: 'owner', email: 'ana@example.test', displayName: 'Ana', username: 'ana', bio: 'A shop owner', timezone: 'UTC', provider: 'email', emailVerified: true }));
vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({
		user,
	}),
}));
vi.mock('@/hooks/use-profile', () => ({
	useUpdateProfile: () => ({ mutateAsync: save, isPending: false }),
}));
vi.mock('@/hooks/use-stats', () => ({
	useUserStats: () => ({ stats: {}, loading: false }),
	useUserActivity: () => ({ activities: [], loading: false }),
}));
vi.mock('@/hooks/use-apps', () => ({
	useApps: () => ({
		apps: [
			{ id: 'store-one', title: 'Morning shop', visibility: 'private' },
		],
		loading: false,
	}),
}));
vi.mock('@/components/payments/PayoutsCard', () => ({
	PayoutsCard: () => <p>Payout status</p>,
}));
vi.mock('@/components/publishing/PaidListingsList', () => ({
	PaidListingsList: () => <p>Published paid listings</p>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/avatar', () => ({
	Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	AvatarFallback: ({ children }: { children: ReactNode }) => (
		<span>{children}</span>
	),
	AvatarImage: () => null,
}));
// Replace browser controls only; routing, editing state, handlers, and tab content are real.
vi.mock('@cloudflare/kumo', () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	Loader: () => <span>Loading</span>,
	Empty: ({ title, description, contents }: { title: ReactNode; description?: ReactNode; contents?: ReactNode }) => <div>{title}{description}{contents}</div>,
	Button: ({
		children,
		loading: _loading,
		icon: _icon,
		variant: _variant,
		size: _size,
		...props
	}: ButtonHTMLAttributes<HTMLButtonElement> & {
		loading?: boolean;
		icon?: ReactNode;
		variant?: string;
		size?: string;
	}) => <button {...props}>{children}</button>,
	Input: ({
		description: _description,
		...props
	}: InputHTMLAttributes<HTMLInputElement> & { description?: string }) => (
		<input {...props} />
	),
	InputArea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
		<textarea {...props} />
	),
	Tabs: ({
		tabs,
		value,
		onValueChange,
	}: {
		tabs: { value: string; label: string }[];
		value: string;
		onValueChange: (value: string) => void;
	}) => (
		<nav>
			{tabs.map((tab) => (
				<button
					key={tab.value}
					data-tab={tab.value}
					aria-pressed={tab.value === value}
					onClick={() => onValueChange(tab.value)}
				>
					{tab.label}
				</button>
			))}
		</nav>
	),
}));

function LocationControls() {
	const location = useLocation();
	const navigate = useNavigate();
	return (
		<>
			<output>{location.search}</output>
			<button data-action="back" onClick={() => navigate(-1)}>
				Back
			</button>
		</>
	);
}

beforeEach(() => {
	silenceTestRendererDeprecation();
	save.mockClear();
});
afterEach(async () => {
	await unmountAll();
	vi.restoreAllMocks();
});

describe('Profile workspace interactions', () => {
	it('keeps the Stripe destination, selected tab, and browser history together', async () => {
		const view = await mountElement(
			<MemoryRouter
				initialEntries={[
					'/profile?tab=paid&stripe=return&context=seller',
				]}
			>
				<Profile />
				<LocationControls />
			</MemoryRouter>,
		);
		expect(textOf(view)).toContain('Payout status');
		expect(textOf(view)).toContain('Published paid listings');
		expect(view.root.findByType('output').props.children).toBe(
			'?tab=paid&context=seller',
		);
		await act(async () =>
			view.root.findByProps({ 'data-tab': 'apps' }).props.onClick(),
		);
		expect(textOf(view)).toContain('Morning shop');
		expect(view.root.findByType('output').props.children).toBe(
			'?tab=apps&context=seller',
		);
		await act(async () =>
			view.root.findByProps({ 'data-action': 'back' }).props.onClick(),
		);
		expect(textOf(view)).toContain('Payout status');
	});

	it('saves all editable fields and resets a canceled draft', async () => {
		const view = await mountElement(
			<MemoryRouter initialEntries={['/profile']}>
				<Profile />
			</MemoryRouter>,
		);
		const click = async (label: string) => {
			const button = view.root
				.findAllByType('button')
				.find((item) => item.props.children === label);
			if (!button) throw new Error(`Button not found: ${label}`);
			await act(async () => button.props.onClick());
		};
		await click('Edit profile');
		for (const [id, value] of Object.entries({
			displayName: ' Ana Store ',
			username: ' new-ana ',
			bio: 'New description',
			timezone: ' America/Bogota ',
		})) {
			await act(async () =>
				view.root
					.findByProps({ id })
					.props.onChange({ target: { value } }),
			);
		}
		await click('Save changes');
		expect(save).toHaveBeenCalledWith({
			displayName: 'Ana Store',
			username: 'new-ana',
			bio: 'New description',
			timezone: 'America/Bogota',
		});
		await click('Edit profile');
		await act(async () =>
			view.root
				.findByProps({ id: 'displayName' })
				.props.onChange({ target: { value: 'Unsaved draft' } }),
		);
		await click('Cancel');
		await click('Edit profile');
		expect(view.root.findByProps({ id: 'displayName' }).props.value).toBe(
			'Ana',
		);
	});
});
