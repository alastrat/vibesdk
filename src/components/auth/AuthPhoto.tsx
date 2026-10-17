import { cn } from '@/lib/utils';

export type PhotoView = 'register' | 'login';

interface Photo {
	image: string;
	/** Keeps the subject in view when the photo is cropped to its column. */
	position: string;
	title: string;
	text: string;
}

/** A team shipping orders beside signing up; someone checking in on the go beside signing in. */
const PHOTOS: Readonly<Record<PhotoView, Photo>> = {
	register: {
		image: '/marketing/auth-signup.webp',
		position: 'object-center',
		title: 'From first idea to first order.',
		text: 'Build your store with AI and launch it in minutes.',
	},
	login: {
		image: '/marketing/auth-signin.webp',
		position: 'object-[82%_center]',
		title: 'Your stores, wherever you are.',
		text: 'Sign in to pick up where you left off.',
	},
};

/** The view's photo filling its column, with a caption over a dark fade at the bottom. */
export function AuthPhoto({ view, className }: { view: PhotoView; className?: string }) {
	const photo = PHOTOS[view];
	return (
		<aside className={cn('relative overflow-hidden', className)}>
			<img src={photo.image} alt="" className={cn('absolute inset-0 size-full object-cover', photo.position)} />
			<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
			<div className="absolute inset-x-0 bottom-0 p-8 text-white">
				<p className="text-2xl leading-snug font-normal tracking-[-0.01em] text-balance">{photo.title}</p>
				<p className="mt-2 text-sm text-white/80">{photo.text}</p>
			</div>
		</aside>
	);
}
