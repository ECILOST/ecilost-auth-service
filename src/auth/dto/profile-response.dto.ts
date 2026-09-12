import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/enums.js';

export class ProfileResponseDto {
  @ApiProperty({
    description:
      'ECILOST identifier. The same value the other services store to refer to this ' +
      'person, and the `sub` claim of the access token.',
    format: 'uuid',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  userId: string;

  @ApiProperty({
    description:
      'Email address of the Google account. Verified: an account whose email Google has ' +
      'not confirmed cannot sign in.',
    example: 'estudiante@gmail.com',
  })
  email: string;

  @ApiProperty({
    description: 'Display name, taken from Google and refreshed on every sign-in.',
    example: 'Juan Tellez',
  })
  fullName: string;

  @ApiPropertyOptional({
    description:
      'Avatar published by Google, refreshed on every sign-in. Null when the account has ' +
      'no picture, or when the one Google sent was not an https URL. Treat it as a hint ' +
      'and render a fallback: Google may rotate or expire the address.',
    nullable: true,
    example: 'https://lh3.googleusercontent.com/a/default-user',
  })
  avatarUrl: string | null;

  @ApiPropertyOptional({
    description:
      'University code, typed by the person. Null until they fill it in, and null for ' +
      'anyone the university has not issued one to. It is **not** the identifier other ' +
      'services use: that one is `userId`.',
    nullable: true,
    example: 'A00123456',
  })
  institutionalCode: string | null;

  @ApiProperty({
    enum: Role,
    description: 'Role assigned when the account was first provisioned.',
    example: Role.STUDENT,
  })
  role: Role;
}
