import { useEffect, useRef, useState } from 'react';
import { PREVIEW_IFRAME_SANDBOX } from '@/lib/preview-sandbox';

const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 390;
const FRAME_HEIGHT = 640;
const LOAD_TIMEOUT_MS = 15_000;

type Device = 'desktop' | 'phone';

interface DevicePreviewProps {
	title: string;
	previewUrl: string | null;
	screenshotUrl: string | null;
}

/** The live site in a desktop or phone frame; the screenshot stands in when the preview can't load. */
export function DevicePreview({ title, previewUrl, screenshotUrl }: DevicePreviewProps) {
	const [device, setDevice] = useState<Device>('desktop');
	const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>(previewUrl ? 'loading' : 'failed');
	const frameRef = useRef<HTMLDivElement>(null);
	const [frameWidth, setFrameWidth] = useState(0);

	useEffect(() => {
		const element = frameRef.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!previewUrl) return;
		setStatus('loading');
		const timer = window.setTimeout(
			() => setStatus((current) => (current === 'loading' ? 'failed' : current)),
			LOAD_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [previewUrl]);

	const scale = frameWidth > 0 ? Math.min(1, frameWidth / DESKTOP_WIDTH) : 1;
	const live = previewUrl !== null && status !== 'failed';

	return (
		<section className="grid gap-3">
			<div className="flex justify-center gap-1" role="group" aria-label="Preview size">
				{(['desktop', 'phone'] as const).map((option) => (
					<button
						key={option}
						type="button"
						aria-pressed={device === option}
						onClick={() => setDevice(option)}
						className={`rounded-lg px-3 py-1 text-sm ${device === option ? 'bg-kumo-elevated text-kumo-strong ring ring-kumo-line' : 'text-kumo-subtle'}`}
					>
						{option === 'desktop' ? 'Desktop' : 'Phone'}
					</button>
				))}
			</div>
			<div
				ref={frameRef}
				className="relative overflow-hidden rounded-xl bg-kumo-recessed ring ring-kumo-hairline"
				style={{ height: FRAME_HEIGHT }}
			>
				{live && device === 'desktop' && (
					<iframe
						title={`${title} preview`}
						src={previewUrl}
						sandbox={PREVIEW_IFRAME_SANDBOX}
						onLoad={() => setStatus('loaded')}
						className="border-0"
						style={{
							width: DESKTOP_WIDTH,
							height: FRAME_HEIGHT / scale,
							transform: `scale(${scale})`,
							transformOrigin: 'top left',
						}}
					/>
				)}
				{live && device === 'phone' && (
					<div className="flex h-full justify-center py-4">
						<iframe
							title={`${title} preview on a phone`}
							src={previewUrl}
							sandbox={PREVIEW_IFRAME_SANDBOX}
							onLoad={() => setStatus('loaded')}
							className="rounded-[28px] border-0 ring-4 ring-kumo-line"
							style={{ width: PHONE_WIDTH, height: FRAME_HEIGHT - 32 }}
						/>
					</div>
				)}
				{!live &&
					(screenshotUrl ? (
						<img src={screenshotUrl} alt={`${title} screenshot`} className="size-full object-cover object-top" />
					) : (
						<div className="flex h-full items-center justify-center text-sm text-kumo-subtle">Preview unavailable</div>
					))}
			</div>
		</section>
	);
}
