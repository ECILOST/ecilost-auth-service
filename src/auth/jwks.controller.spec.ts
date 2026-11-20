import { describe, expect, it, vi } from 'vitest';
import { JwksController } from './jwks.controller.js';
import type { TokenService } from './tokens/token.service.js';

describe('JwksController', () => {
  it('returns the public keys provided by the token service', async () => {
    const jwks = { keys: [{ kty: 'RSA', kid: 'current-key', n: 'public-modulus', e: 'AQAB' }] };
    const publicJwks = vi.fn().mockResolvedValue(jwks);
    const controller = new JwksController({ publicJwks } as unknown as TokenService);

    await expect(controller.jwks()).resolves.toEqual(jwks);
    expect(publicJwks).toHaveBeenCalledOnce();
  });
});
