import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/enums.js';

export class AccessTokenResponseDto {
  @ApiProperty({
    description:
      'Short-lived RS256 JWT issued by this service. Send it to the other ECILOST ' +
      'microservices as `Authorization: Bearer <token>`. Keep it in memory: storing it ' +
      'in localStorage exposes it to any script running on the page. Its claims are ' +
      '`sub`, `role`, `iss`, `aud`, `iat`, `exp` and `jti`, and nothing else. Email and ' +
      'name are deliberately excluded to minimise the personal data crossing services.',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9.eyJzdWIiOiIuLi4ifQ.signature',
  })
  access_token: string;

  @ApiProperty({
    description: 'Always `Bearer`, per RFC 6750.',
    example: 'Bearer',
  })
  token_type: string;

  @ApiProperty({
    description:
      'Lifetime of the access token in seconds. Request a new one from this endpoint ' +
      'before it expires; the session cookie stays valid much longer.',
    example: 900,
  })
  expires_in: number;

  @ApiProperty({
    enum: Role,
    description:
      'ECILOST role of the authenticated user. `STUDENT` joins auction rooms and owns an ' +
      'ECICoin wallet. `STAFF` manages the catalogue and schedules rooms. The role is ' +
      'also carried inside the token; this field is a convenience for the client UI and ' +
      'must never be used to make an authorisation decision on the server side.',
    example: Role.STUDENT,
  })
  role: Role;
}
