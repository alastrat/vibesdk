import { describe, expect, it } from 'vitest';
import { ImageType, uploadImageKey } from './images';

const CLIENT_ID = 'img-1760000000000-ab12cd34e';

describe('uploadImageKey', () => {
	it('keeps a client id and encodes the filename', () => {
		expect(uploadImageKey(ImageType.UPLOADS, CLIENT_ID, 'photo (2).png')).toBe(`uploads/${CLIENT_ID}/photo%20(2).png`);
	});

	it('keeps the app screenshot key', () => {
		const appId = '0b6c2f8e-3a4d-4f5e-9c1b-2d3e4f5a6b7c';
		expect(uploadImageKey(ImageType.SCREENSHOTS, appId, 'latest.png')).toBe(`screenshots/${appId}/latest.png`);
	});

	it.each(['../screenshots/app-1', 'a/b', 'a.b', '', 'img 1', 'x'.repeat(65)])(
		'replaces the unsafe id %j with a server id',
		(id) => {
			const key = uploadImageKey(ImageType.UPLOADS, id, 'photo.png');
			expect(key).toMatch(/^uploads\/[A-Za-z0-9_-]{1,64}\/photo\.png$/);
			expect(key.split('/')[1]).not.toBe(id);
		},
	);

	it.each(['', '.', '..'])('names the filename %j "image"', (filename) => {
		expect(uploadImageKey(ImageType.UPLOADS, CLIENT_ID, filename)).toBe(`uploads/${CLIENT_ID}/image`);
	});

	it('keeps a filename with slashes in one segment', () => {
		expect(uploadImageKey(ImageType.UPLOADS, CLIENT_ID, '../x.png')).toBe(`uploads/${CLIENT_ID}/..%2Fx.png`);
	});
});
