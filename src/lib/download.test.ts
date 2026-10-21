import { describe, expect, it } from 'vitest';
import { downloadFailureMessage, filenameOfDisposition } from './download';

describe("a download's file name", () => {
	it("is the server's, from a quoted or a bare filename", () => {
		expect(filenameOfDisposition('attachment; filename="estori-invoice-0001.pdf"', 'invoice.pdf')).toBe('estori-invoice-0001.pdf');
		expect(filenameOfDisposition('attachment; filename=estori-invoice-0002.pdf', 'invoice.pdf')).toBe('estori-invoice-0002.pdf');
		expect(filenameOfDisposition('attachment; FILENAME="a.pdf"; size=12', 'invoice.pdf')).toBe('a.pdf');
	});

	it('is the fallback when the server names none', () => {
		expect(filenameOfDisposition(null, 'invoice.pdf')).toBe('invoice.pdf');
		expect(filenameOfDisposition('attachment', 'invoice.pdf')).toBe('invoice.pdf');
		expect(filenameOfDisposition('attachment; filename=""', 'invoice.pdf')).toBe('invoice.pdf');
	});

	it('never carries a path, so a header cannot save a file somewhere else', () => {
		expect(filenameOfDisposition('attachment; filename="../../etc/passwd"', 'invoice.pdf')).toBe('passwd');
		expect(filenameOfDisposition('attachment; filename="C:\\temp\\bill.pdf"', 'invoice.pdf')).toBe('bill.pdf');
	});
});

describe('a refused download', () => {
	const fallback = "Couldn't download the invoice. Try again in a moment.";
	const refused = (status: number, message: string) => Object.assign(new Error(message), { status });

	it("shows the server's own words", () => {
		expect(downloadFailureMessage(refused(404, "We couldn't find that invoice."), fallback)).toBe("We couldn't find that invoice.");
		expect(downloadFailureMessage(refused(502, 'Something went wrong with the payment service.'), fallback)).toBe('Something went wrong with the payment service.');
	});

	it('shows the fallback for a failure that has no words of its own', () => {
		// A request that never arrived, or an answer that was not the server's JSON, has status 0.
		expect(downloadFailureMessage(refused(0, 'Failed to fetch'), fallback)).toBe(fallback);
		expect(downloadFailureMessage(new Error("Unexpected token '<'"), fallback)).toBe(fallback);
		expect(downloadFailureMessage(refused(500, ''), fallback)).toBe(fallback);
		expect(downloadFailureMessage('boom', fallback)).toBe(fallback);
	});
});
