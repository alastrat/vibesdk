/** CJ sandbox orders move 300 (paid) to 400, 500 (shipped), 600 (delivered); the sandbox can't skip a status. */

export type SandboxMove = { kind: 'status'; status: 400 | 500 | 600 } | { kind: 'track' };

export function sandboxMoves(action: 'ship' | 'deliver'): SandboxMove[] {
	return action === 'ship' ? [{ kind: 'status', status: 400 }, { kind: 'track' }, { kind: 'status', status: 500 }] : [{ kind: 'status', status: 600 }];
}
