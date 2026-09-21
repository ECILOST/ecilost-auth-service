import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { Role, UserStatus } from '../../generated/prisma/enums.js';

export class FindUserQueryDto {
  @ApiProperty({
    description:
      'Exact institutional email address. The lookup matches the whole address: it is ' +
      'meant to confirm somebody you already know of, not to browse the directory.',
    format: 'email',
    example: 'estudiante@escuelaing.edu.co',
  })
  // Se normaliza antes de validar, y otra vez en el caso de uso: los correos se guardan en
  // minusculas, asi que "Estudiante@..." tiene que encontrar a la misma persona.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'email debe ser una direccion de correo valida' })
  email: string;
}

/**
 * Lo minimo para identificar a alguien y poder operar sobre su cuenta desde otro servicio.
 *
 * No lleva el avatar ni el `googleSub`: lo primero es presentacion de la propia persona y
 * lo segundo es un secreto del proveedor de identidad. Lo que si lleva es `status`, porque
 * abonarle saldo a una cuenta inactiva es trabajo perdido y conviene verlo antes.
 */
export class UserLookupResponseDto {
  @ApiProperty({
    description:
      'The identifier every other service stores. This is what wallet, auction-core and ' +
      'engagement expect; they never store the email address.',
    format: 'uuid',
  })
  userId: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ description: 'Display name, as Google reports it.' })
  fullName: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({
    enum: UserStatus,
    description: 'A suspended account cannot sign in, so operating on it has no effect.',
  })
  status: UserStatus;
}
