import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { INSTITUTIONAL_CODE_PATTERN } from '../../users/users.service.js';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description:
      'University code. Between 4 and 20 characters: letters, digits and hyphens. ' +
      'Surrounding whitespace is trimmed. Send `null`, or an empty string, to clear it. ' +
      'Omit the field to leave it untouched.',
    nullable: true,
    example: 'A00123456',
  })
  @IsOptional()
  // Recortar ANTES de validar: si no, un valor con espacios alrededor choca contra el
  // patron y devuelve 400, aunque el codigo en si sea correcto.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  // null y la cadena vacia limpian el campo: un formulario manda lo segundo cuando el
  // usuario borra el texto. En ambos casos no hay formato que validar.
  @ValidateIf((_object, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(20)
  @Matches(INSTITUTIONAL_CODE_PATTERN, {
    message:
      'institutionalCode debe tener entre 4 y 20 caracteres: letras, digitos o guiones',
  })
  institutionalCode?: string | null;
}
