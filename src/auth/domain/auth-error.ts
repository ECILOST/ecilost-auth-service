/**
 * Motivos de rechazo que si se le pueden mostrar al usuario.
 *
 * Enumerar cuentas no es un riesgo aqui: no existe ningun endpoint previo a la
 * autenticacion donde probar correos. Cuando alguien llega al callback ya demostro su
 * identidad ante Google, asi que decirle "tu correo no esta verificado" o "cuenta
 * inactiva" no revela nada sobre terceros. Los fallos de protocolo, en cambio, se
 * agrupan bajo `invalid_request` y el detalle real queda solo en el log del servidor.
 */
export type AuthErrorCode =
  | 'invalid_request'
  | 'access_denied'
  | 'email_not_verified'
  | 'account_suspended'
  | 'server_error';

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_request: 'La solicitud de inicio de sesion no es valida o expiro.',
  access_denied: 'No se completo el inicio de sesion con Google.',
  email_not_verified: 'Tu correo de Google no esta verificado.',
  account_suspended: 'Tu cuenta esta inactiva. Comunicate con la universidad.',
  server_error: 'No fue posible completar el inicio de sesion.',
};

/** Error de dominio. El controlador lo traduce a un redirect o a un 401. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    /** Detalle tecnico: va al log, nunca a la respuesta. */
    readonly detail?: string,
  ) {
    super(AUTH_ERROR_MESSAGES[code]);
    this.name = 'AuthError';
  }
}
