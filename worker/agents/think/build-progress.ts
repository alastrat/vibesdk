/**
 * Live progress of a Think build, read from the AI SDK UI stream chunks the
 * host already receives from the ThinkAgent.
 */

type StringRole = 'key' | 'path' | 'content' | 'other';

const SIMPLE_ESCAPES: Record<string, string> = {
	'"': '"',
	'\\': '\\',
	'/': '/',
	b: '\b',
	f: '\f',
	n: '\n',
	r: '\r',
	t: '\t',
};

/**
 * Reads streamed tool-call arguments (partial JSON) one delta at a time. It
 * captures the top-level `path` string and counts the lines of the top-level
 * `content` string without keeping the arguments. Unexpected input stops the
 * scan; what was read before stays available.
 */
export class ToolInputScanner {
	private depth = 0;
	private expectKey = false;
	private key: string | undefined;
	private inString = false;
	private role: StringRole = 'other';
	private escaped = false;
	private hex: string | null = null;
	private text = '';
	private capturedPath: string | undefined;
	private contentStarted = false;
	private newlines = 0;
	private failed = false;

	get path(): string | undefined {
		return this.capturedPath;
	}

	/** Lines in `content` so far: newlines plus one, or 0 while it is empty. */
	get lines(): number {
		return this.contentStarted ? this.newlines + 1 : 0;
	}

	push(delta: string): void {
		for (const char of delta) {
			if (this.failed) return;
			if (this.inString) this.readStringChar(char);
			else this.readStructureChar(char);
		}
	}

	private readStringChar(char: string): void {
		if (this.hex !== null) {
			this.hex += char;
			if (this.hex.length < 4) return;
			const code = Number.parseInt(this.hex, 16);
			this.hex = null;
			if (Number.isNaN(code)) {
				this.failed = true;
				return;
			}
			this.appendChar(String.fromCharCode(code));
			return;
		}
		if (this.escaped) {
			this.escaped = false;
			if (char === 'u') {
				this.hex = '';
				return;
			}
			const decoded = SIMPLE_ESCAPES[char];
			if (decoded === undefined) {
				this.failed = true;
				return;
			}
			this.appendChar(decoded);
			return;
		}
		if (char === '\\') {
			this.escaped = true;
			return;
		}
		if (char === '"') {
			this.endString();
			return;
		}
		this.appendChar(char);
	}

	private appendChar(char: string): void {
		switch (this.role) {
			case 'key':
			case 'path':
				this.text += char;
				return;
			case 'content':
				this.contentStarted = true;
				if (char === '\n') this.newlines += 1;
				return;
			default:
				return;
		}
	}

	private endString(): void {
		this.inString = false;
		if (this.role === 'key') this.key = this.text;
		else if (this.role === 'path') this.capturedPath = this.text;
		this.text = '';
	}

	private readStructureChar(char: string): void {
		switch (char) {
			case '{':
				this.depth += 1;
				if (this.depth === 1) this.expectKey = true;
				return;
			case '[':
				if (this.depth === 0) {
					this.failed = true;
					return;
				}
				this.depth += 1;
				return;
			case '}':
			case ']':
				this.depth -= 1;
				if (this.depth < 0) this.failed = true;
				return;
			case ',':
				if (this.depth === 1) this.expectKey = true;
				return;
			case ':':
				if (this.depth === 1) this.expectKey = false;
				return;
			case '"':
				this.inString = true;
				this.text = '';
				this.role = this.roleForString();
				return;
			default:
				return;
		}
	}

	private roleForString(): StringRole {
		if (this.depth !== 1) return 'other';
		if (this.expectKey) return 'key';
		if (this.key === 'path') return 'path';
		if (this.key === 'content') return 'content';
		return 'other';
	}
}
