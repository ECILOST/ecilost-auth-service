import { ApiProperty } from '@nestjs/swagger';

export class JsonWebKeyDto {
  @ApiProperty({ description: 'Key type. Always `RSA`.', example: 'RSA' })
  kty: string;

  @ApiProperty({
    description:
      'Key identifier, the RFC 7638 thumbprint of the key. Access tokens carry it in ' +
      'their `kid` header so a verifier can pick the right key during a rotation.',
    example: 'nZS1p0S0gXQ0kQ5fQ3dG7yK9vX1cJ2mB4nR8tL6wA0E',
  })
  kid: string;

  @ApiProperty({ description: 'Signing algorithm. Always `RS256`.', example: 'RS256' })
  alg: string;

  @ApiProperty({ description: 'Key usage. Always `sig`.', example: 'sig' })
  use: string;

  @ApiProperty({ description: 'RSA modulus, base64url encoded.' })
  n: string;

  @ApiProperty({ description: 'RSA public exponent, base64url encoded.', example: 'AQAB' })
  e: string;
}

export class JwksResponseDto {
  @ApiProperty({
    type: [JsonWebKeyDto],
    description:
      'Public signing keys of this issuer. Only public material is ever published: the ' +
      'private key never leaves the process.',
  })
  keys: JsonWebKeyDto[];
}
